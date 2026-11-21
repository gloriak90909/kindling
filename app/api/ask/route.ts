import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LESSON, LESSON_TITLE, normalize, quoteIsInLesson } from "@/lib/lesson";
import { looksSpanish, readingGrade } from "@/lib/checks";

export const maxDuration = 60;

const AnswerSchema = z.object({
  answer: z.string().min(1).max(900),
  lesson_quote: z.string().max(400),
  off_topic: z.boolean(),
  gave_away_answer: z.boolean(),
});

const TOOL = {
  name: "spoken_answer",
  description: "Answer the student's spoken question about the page.",
  input_schema: {
    type: "object" as const,
    properties: {
      answer: {
        type: "string",
        description: "1 to 4 short sentences, friendly, easy to hear read aloud. Guide; never give the final answer to a practice problem.",
      },
      lesson_quote: { type: "string", description: "One sentence copied word for word from the teacher's material." },
      off_topic: { type: "boolean", description: "True if the question has nothing to do with the teacher's material." },
      gave_away_answer: { type: "boolean", description: "True if your answer states the final answer to a practice problem." },
    },
    required: ["answer", "lesson_quote", "off_topic", "gave_away_answer"],
  },
};

const BodySchema = z.object({
  question: z.string().min(1).max(500),
  image: z.string().max(6_000_000).optional(),
  lessonText: z.string().max(20000).optional(),
  supports: z.object({ simpler: z.boolean(), spanish: z.boolean() }),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, message: "Ask a question first." }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, message: "Server is missing its AI key (ANTHROPIC_API_KEY)." }, { status: 500 });
  }

  const uploaded = (body.lessonText || "").trim();
  const hasUploadedText = uploaded.length >= 40;
  const material = hasUploadedText ? uploaded : [`${LESSON_TITLE}:`, ...LESSON].join("\n");

  const system = [
    "You are Kindling, a friendly tutor. A student is looking at a page of their teacher's worksheet or slides and asked you a question out loud.",
    "You may ONLY teach from the teacher's material below:",
    "<teacher_material>",
    material,
    "</teacher_material>",
    "Rules:",
    "- Answer in 1 to 4 short sentences that sound natural read aloud.",
    "- Guide with a hint or an explanation; never give the final answer to a practice problem.",
    "- lesson_quote must be copied word for word from one sentence in the teacher's material.",
    "- If the question has nothing to do with the material, set off_topic=true.",
    body.supports.spanish ? "- Answer in simple Spanish. Keep lesson_quote exactly as written in the material." : "- Answer in English.",
    body.supports.simpler ? "- Use very simple words and short sentences (about grade 6 reading level)." : "",
  ]
    .filter(Boolean)
    .join("\n");

  const content: { type: string; [k: string]: unknown }[] = [];
  const m = body.image?.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
  if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  content.push({ type: "text", text: `The student asked: "${body.question}"` });

  const client = new Anthropic({ timeout: 25000, maxRetries: 1 });
  const models = [process.env.MODEL_PRIMARY || "claude-sonnet-5-5", process.env.MODEL_FALLBACK || "claude-haiku-5-5"];
  let out: z.infer<typeof AnswerSchema> | null = null;
  let modelUsed = "";
  let lastError = "";
  for (const model of models) {
    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 800,
        system: system + "\n- Always respond by calling the spoken_answer tool.",
        tools: [TOOL],
        tool_choice: model.includes("haiku") ? { type: "tool", name: "spoken_answer" } : { type: "auto" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: [{ role: "user", content: content as any }],
      });
      const block = msg.content.find((b) => b.type === "tool_use");
      const parsed = AnswerSchema.safeParse(block && "input" in block ? block.input : null);
      if (parsed.success) {
        out = parsed.data;
        modelUsed = model;
        break;
      }
      lastError = "The AI's answer was not in the right format.";
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  if (!out) {
    return Response.json({ ok: false, message: `The tutor is busy right now. (${lastError.slice(0, 140)})` }, { status: 502 });
  }

  if (out.off_topic) {
    return Response.json({
      ok: true,
      offTopic: true,
      message: body.supports.spanish
        ? "Solo puedo ayudarte con el material de tu maestro(a)."
        : "I can only help with your teacher's material.",
      modelUsed,
    });
  }

  const checks: { name: string; passed: boolean; detail: string }[] = [];
  let answer = out.answer;
  let quote: string | null = out.lesson_quote;
  const quoteOk = hasUploadedText
    ? normalize(quote).split(" ").length >= 4 && normalize(uploaded).includes(normalize(quote))
    : quoteIsInLesson(quote);
  checks.push({
    name: "Quote is from the teacher's material",
    passed: quoteOk,
    detail: quoteOk ? "Found word for word" : "Not found, so the answer was blocked",
  });
  if (!quoteOk) {
    answer = body.supports.spanish ? "Pregúntale a tu maestro(a) sobre esto." : "Ask your teacher about this one.";
    quote = null;
  }
  checks.push({
    name: "Hint only, no answer",
    passed: !out.gave_away_answer,
    detail: out.gave_away_answer ? "Answer may give away a solution" : "No answer given away",
  });
  if (out.gave_away_answer && quoteOk) {
    answer = body.supports.spanish
      ? "Intenta el siguiente paso tú primero. Mira el ejemplo en la página."
      : "Try the next step yourself first. Look at the example on the page.";
  }
  if (body.supports.spanish) {
    const ok = looksSpanish(answer);
    checks.push({ name: "Spanish", passed: ok, detail: ok ? "Answer is in Spanish" : "Answer may not be in Spanish" });
  } else if (body.supports.simpler) {
    const grade = readingGrade(answer);
    checks.push({ name: "Simpler words", passed: grade <= 8, detail: `Reading level about grade ${Math.max(1, Math.round(grade))}` });
  }

  return Response.json({ ok: true, asked: body.question, hint: answer, quote, checks, modelUsed });
}
