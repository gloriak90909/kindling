import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LESSON, LESSON_TITLE, normalize, quoteIsInLesson } from "@/lib/lesson";
import { detectByRule, solveGramsToGrams, type Misconception, type Problem, type Solution } from "@/lib/chem";
import { givesAwayAnswer, looksSpanish, readingGrade } from "@/lib/checks";

export const maxDuration = 60;

const TAGS = [
  "correct",
  "flipped_mole_ratio",
  "mass_ratio",
  "ignored_mole_ratio",
  "wrong_molar_mass",
  "not_balanced",
  "other_unclear",
] as const;

const NoteSchema = z.object({
  legible: z.boolean(),
  transcription: z.string().max(600),
  problem_equation: z.string().nullable(),
  problem_given: z.string().nullable(),
  problem_grams: z.number().nullable(),
  problem_target: z.string().nullable(),
  final_answer_grams: z.number().nullable(),
  misconception: z.enum(TAGS),
  confidence: z.number().min(0).max(1),
  hint: z.string().min(1).max(800),
  lesson_quote: z.string().max(400),
  gave_away_answer: z.boolean(),
  off_topic: z.boolean(),
});

const TOOL = {
  name: "margin_note",
  description: "Read the student's page and write one margin note.",
  input_schema: {
    type: "object" as const,
    properties: {
      legible: { type: "boolean", description: "False if the student's handwriting can't be read." },
      transcription: { type: "string", description: "Exactly what the student handwrote, as plain text." },
      problem_equation: {
        type: ["string", "null"],
        description: "The balanced equation of the problem the student is working on, e.g. '2H2 + O2 -> 2H2O'. Null if none.",
      },
      problem_given: { type: ["string", "null"], description: "Formula of the substance whose mass is given, e.g. 'H2'." },
      problem_grams: { type: ["number", "null"], description: "The given mass in grams." },
      problem_target: { type: ["string", "null"], description: "Formula of the substance whose mass is asked for." },
      final_answer_grams: { type: ["number", "null"], description: "The student's final answer in grams, or null." },
      misconception: { type: "string", enum: [...TAGS] },
      confidence: { type: "number", description: "0 to 1: how sure you are about the misconception." },
      hint: { type: "string", description: "1 to 3 short sentences. One next step. Never state the final numeric answer." },
      lesson_quote: {
        type: "string",
        description: "One sentence copied word for word from the teacher's material that supports the hint.",
      },
      gave_away_answer: { type: "boolean" },
      off_topic: { type: "boolean", description: "True if the page has nothing to do with the teacher's material." },
    },
    required: [
      "legible",
      "transcription",
      "problem_equation",
      "problem_given",
      "problem_grams",
      "problem_target",
      "final_answer_grams",
      "misconception",
      "confidence",
      "hint",
      "lesson_quote",
      "gave_away_answer",
      "off_topic",
    ],
  },
};

const ProblemSchema = z.object({ equation: z.string(), given: z.string(), grams: z.number(), target: z.string() });

const BodySchema = z.object({
  image: z.string().max(6_000_000).optional(),
  typed: z.string().max(500).optional(),
  lessonText: z.string().max(20000).optional(),
  problem: ProblemSchema.optional(), // older /simple page
  fallbackProblem: ProblemSchema.nullable().optional(),
  supports: z.object({ simpler: z.boolean(), spanish: z.boolean() }),
});

const FALLBACK_HINT_EN =
  "Look at the coefficients in the balanced equation. They tell you the mole ratio. Which substance goes on top?";
const FALLBACK_HINT_ES =
  "Mira los coeficientes de la ecuación balanceada. Te dan la razón molar. ¿Qué sustancia va arriba?";

function systemPrompt(material: string, supports: { simpler: boolean; spanish: boolean }, fallback?: Problem | null) {
  return [
    "You are Kindling, a tutor who writes short margin notes on a high school student's notes.",
    "The image shows a page of the teacher's worksheet or slides with the student's handwriting on top (colored ink).",
    "You may ONLY teach from the teacher's material below:",
    "<teacher_material>",
    material,
    "</teacher_material>",
    "",
    "Rules:",
    "- Find the problem the student's handwriting is working on. If it is a grams-to-grams stoichiometry problem, fill in problem_equation (balanced), problem_given, problem_grams and problem_target. Otherwise set them to null.",
    fallback
      ? `- If you can't find a problem on the page, the teacher's backup problem is: ${fallback.equation}; ${fallback.grams} g of ${fallback.given} -> ? g of ${fallback.target}.`
      : "",
    "- Read the student's work. If you can't read it, set legible=false.",
    "- Give a hint about the NEXT step only. Never write the final numeric answer.",
    "- lesson_quote must be copied word for word from one sentence in the teacher's material.",
    "- Pick the misconception from the list. Use 'correct' if the work and answer look right.",
    "- If the page has nothing to do with the teacher's material, set off_topic=true.",
    supports.spanish
      ? "- Write the hint in simple Spanish (short sentences). Keep lesson_quote exactly as written in the material."
      : "- Write the hint in English.",
    supports.simpler ? "- Use very simple words and short sentences (about grade 6 reading level)." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, message: "That request didn't look right. Try again." }, { status: 400 });
  }
  if (!body.image && !body.typed?.trim()) {
    return Response.json({ ok: false, message: "Write or type your answer first." }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, message: "Server is missing its AI key (ANTHROPIC_API_KEY)." }, { status: 500 });
  }

  const fallback = body.fallbackProblem ?? body.problem ?? null;
  const uploaded = (body.lessonText || "").trim();
  const hasUploadedText = uploaded.length >= 40;
  const material = hasUploadedText
    ? uploaded
    : [`${LESSON_TITLE}:`, ...LESSON].join("\n");

  const content: { type: string; [k: string]: unknown }[] = [];
  if (body.image) {
    const m = body.image.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
    if (!m) return Response.json({ ok: false, message: "The page image didn't upload correctly." }, { status: 400 });
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    content.push({ type: "text", text: "Here is the student's page. Write the margin note." });
  } else {
    content.push({ type: "text", text: `The student typed: ${body.typed}\nWrite the margin note.` });
  }

  const client = new Anthropic({ timeout: 25000, maxRetries: 1 });
  const models = [process.env.MODEL_PRIMARY || "claude-sonnet-5-5", process.env.MODEL_FALLBACK || "claude-haiku-5-5"];
  let note: z.infer<typeof NoteSchema> | null = null;
  let modelUsed = "";
  let lastError = "";
  for (const model of models) {
    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 1200,
        system: systemPrompt(material, body.supports, fallback) + "\n- Always respond by calling the margin_note tool.",
        tools: [TOOL],
        tool_choice: model.includes("haiku") ? { type: "tool", name: "margin_note" } : { type: "auto" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: [{ role: "user", content: content as any }],
      });
      const block = msg.content.find((b) => b.type === "tool_use");
      const parsed = NoteSchema.safeParse(block && "input" in block ? block.input : null);
      if (parsed.success) {
        note = parsed.data;
        modelUsed = model;
        break;
      }
      lastError = `Format: ${parsed.success ? "" : JSON.stringify(parsed.error.issues).slice(0, 300)}`;
      console.warn(`[tutor] ${model} format problem`, lastError);
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  if (!note) {
    return Response.json({ ok: false, message: `The tutor is busy right now. (${lastError.slice(0, 140)})` }, { status: 502 });
  }

  if (note.off_topic) {
    return Response.json({
      ok: true,
      offTopic: true,
      message: body.supports.spanish
        ? "Solo puedo ayudarte con el material de tu maestro(a)."
        : "I can only help with your teacher's material.",
      modelUsed,
    });
  }
  if (!note.legible) return Response.json({ ok: true, unreadable: true, transcription: note.transcription, modelUsed });

  // Code solves the problem: first the one the AI read off the page, then the teacher's backup.
  const aiProblem: Problem | null =
    note.problem_equation && note.problem_given && note.problem_target && note.problem_grams
      ? { equation: note.problem_equation, given: note.problem_given, grams: note.problem_grams, target: note.problem_target }
      : null;
  let solution: Solution | null = null;
  let problemUsed: Problem | null = null;
  let problemSource = "";
  for (const [p, src] of [
    [aiProblem, "read from the page"],
    [fallback, "teacher's backup"],
  ] as const) {
    if (!p) continue;
    try {
      const s = solveGramsToGrams(p);
      if (!s.balanced) continue;
      solution = s;
      problemUsed = p;
      problemSource = src;
      break;
    } catch {
      // try the next source
    }
  }

  const checks: { name: string; passed: boolean; detail: string }[] = [];
  let isCorrect: boolean | null = null;
  let tag: Misconception = note.misconception;
  let needsReview = false;

  if (solution) {
    const ruleTag = detectByRule(note.final_answer_grams, solution);
    isCorrect = ruleTag === "correct";
    tag = isCorrect ? "correct" : ruleTag ?? note.misconception;
    needsReview = !isCorrect && (ruleTag === null ? note.confidence < 0.7 : ruleTag !== note.misconception);
    checks.push({
      name: "Answer checked by code",
      passed: true,
      detail: isCorrect ? "Matches the computed answer" : "Doesn't match the computed answer",
    });
    checks.push({ name: "Equation balanced", passed: true, detail: "Atom counts match on both sides" });
  } else {
    needsReview = true;
    checks.push({ name: "Answer checked by code", passed: false, detail: "Couldn't find a grams-to-grams problem to check" });
  }

  let hint = note.hint;
  let quote: string | null = note.lesson_quote;
  const quoteOk = hasUploadedText
    ? normalize(quote).split(" ").length >= 4 && normalize(uploaded).includes(normalize(quote))
    : quoteIsInLesson(quote);
  checks.push({
    name: "Quote is from the teacher's material",
    passed: quoteOk,
    detail: quoteOk ? "Found word for word" : "Not found, so the hint was blocked",
  });
  if (!quoteOk) {
    hint = body.supports.spanish ? "Pregúntale a tu maestro(a) sobre esto." : "Ask your teacher about this one.";
    quote = null;
  }

  const gaveAway = isCorrect === false && solution !== null && (note.gave_away_answer || givesAwayAnswer(hint, solution.answer));
  checks.push({ name: "Hint only, no answer", passed: !gaveAway, detail: gaveAway ? "Replaced with a safe hint" : "No answer given away" });
  if (gaveAway) hint = body.supports.spanish ? FALLBACK_HINT_ES : FALLBACK_HINT_EN;

  if (body.supports.spanish) {
    const ok = looksSpanish(hint);
    checks.push({ name: "Spanish", passed: ok, detail: ok ? "Reply is in Spanish" : "Reply may not be in Spanish" });
  } else if (body.supports.simpler) {
    const grade = readingGrade(hint);
    checks.push({ name: "Simpler words", passed: grade <= 8, detail: `Reading level about grade ${Math.max(1, Math.round(grade))}` });
  }

  return Response.json({
    ok: true,
    isCorrect,
    misconception: tag,
    needsReview,
    transcription: note.transcription,
    hint,
    quote,
    checks,
    steps: isCorrect && solution ? solution.steps : null,
    problemText: problemUsed
      ? `${problemUsed.equation.replace("->", "→")}; ${problemUsed.grams} g ${problemUsed.given} → ? g ${problemUsed.target}`
      : null,
    problemSource: problemUsed ? problemSource : null,
    modelUsed,
    fallbackReason: modelUsed === models[0] ? undefined : lastError.slice(0, 300),
  });
}
