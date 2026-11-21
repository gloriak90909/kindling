"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_PROBLEM, LESSON, LESSON_TITLE } from "@/lib/lesson";

type Supports = { simpler: boolean; spanish: boolean; readAloud: boolean };

const PROFILES: Record<string, { label: string; supports: Supports }> = {
  Falcon: { label: "Falcon (simpler words + read aloud)", supports: { simpler: true, spanish: false, readAloud: true } },
  Otter: { label: "Otter (Español + read aloud)", supports: { simpler: false, spanish: true, readAloud: true } },
  Kestrel: { label: "Kestrel (no supports)", supports: { simpler: false, spanish: false, readAloud: false } },
};

const TAG_LABEL: Record<string, string> = {
  correct: "Correct",
  flipped_mole_ratio: "Flipped the mole ratio",
  mass_ratio: "Used a mass ratio instead of a mole ratio",
  ignored_mole_ratio: "Skipped the mole ratio",
  wrong_molar_mass: "Wrong molar mass",
  not_balanced: "Didn't balance the equation first",
  other_unclear: "Unclear, needs teacher review",
};

type Result =
  | {
      ok: true;
      isCorrect?: boolean;
      misconception?: string;
      needsReview?: boolean;
      transcription?: string;
      hint?: string;
      quote?: string;
      checks?: { name: string; passed: boolean; detail: string }[];
      steps?: string[] | null;
      modelUsed?: string;
      offTopic?: boolean;
      unreadable?: boolean;
      message?: string;
    }
  | { ok: false; message: string };

export default function Home() {
  const [codename, setCodename] = useState("Falcon");
  const [supports, setSupports] = useState<Supports>(PROFILES.Falcon.supports);
  const [problem, setProblem] = useState(DEFAULT_PROBLEM);
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (c.width === w && c.height === h) return;
      c.width = w;
      c.height = h;
      setHasInk(false);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const dpr = c.width / rect.width;
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr, dpr };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = { x: p.x, y: p.y };
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = point(e);
    const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    ctx.strokeStyle = "#1f3a93";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = (1.6 + pressure * 2.4) * p.dpr;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = { x: p.x, y: p.y };
    if (!hasInk) setHasInk(true);
  }

  function up() {
    drawing.current = false;
    last.current = null;
  }

  function clearPage() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    setResult(null);
  }

  function exportPng(): string {
    const c = canvasRef.current!;
    const scale = Math.min(1, 1024 / c.width);
    const out = document.createElement("canvas");
    out.width = Math.round(c.width * scale);
    out.height = Math.round(c.height * scale);
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = supports.spanish ? "es-MX" : "en-US";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  async function check() {
    if (!hasInk && !typed.trim()) {
      setResult({ ok: false, message: supports.spanish ? "Escribe tu respuesta primero." : "Write or type your answer first." });
      return;
    }
    setLoading(true);
    setResult(null);
    // Unlock speech on iPad: it must start inside a tap.
    if (supports.readAloud && "speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(" "));
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: hasInk ? exportPng() : undefined,
          typed: hasInk ? undefined : typed,
          problem,
          supports: { simpler: supports.simpler, spanish: supports.spanish },
        }),
      });
      const data = (await res.json()) as Result;
      setResult(data);
      if (data.ok && supports.readAloud) {
        const text = data.hint || data.message;
        if (text) speak(text);
      }
    } catch {
      setResult({ ok: false, message: "Couldn't reach the tutor. Check the Wi-Fi and try again." });
    } finally {
      setLoading(false);
    }
  }

  function pickProfile(name: string) {
    setCodename(name);
    setSupports(PROFILES[name].supports);
    setResult(null);
  }

  const toggle = (k: keyof Supports) => setSupports((s) => ({ ...s, [k]: !s[k] }));

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <h1>Kindling</h1>
          <span>No minds left behind.</span>
        </div>
        <div className="controls">
          <select className="pill" value={codename} onChange={(e) => pickProfile(e.target.value)} aria-label="Student codename">
            {Object.entries(PROFILES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <button className="pill" aria-pressed={supports.readAloud} onClick={() => toggle("readAloud")}>
            Read aloud
          </button>
          <button className="pill" aria-pressed={supports.simpler} onClick={() => toggle("simpler")}>
            Simpler words
          </button>
          <button className="pill" aria-pressed={supports.spanish} onClick={() => toggle("spanish")}>
            Español
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="card">
          <div className="lesson">
            <h2>Teacher&apos;s lesson: {LESSON_TITLE}</h2>
            <ol>
              {LESSON.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          <div className="problem">
            {problem.equation.replace("->", "→")}. How many grams of {problem.target} react with {problem.grams} g of{" "}
            {problem.given}?
          </div>

          <div className="page">
            {!hasInk && <div className="placeholder">Show your work here with the Apple Pencil…</div>}
            <canvas
              ref={canvasRef}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerLeave={up}
              aria-label="Writing area for your work"
            />
          </div>

          <div className="row">
            <button className="primary" onClick={check} disabled={loading}>
              {loading ? "Reading your work…" : "Check my work"}
            </button>
            <button className="secondary" onClick={clearPage}>
              Clear
            </button>
            <input
              className="typed"
              placeholder="…or type your answer (e.g. 63.5 g O2)"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Type your answer"
            />
          </div>

          <details className="setup">
            <summary>Teacher setup: change the problem (code recomputes the answer)</summary>
            <div className="setup-grid">
              <label>
                Balanced equation
                <input value={problem.equation} onChange={(e) => setProblem({ ...problem, equation: e.target.value })} />
              </label>
              <label>
                Given substance
                <input value={problem.given} onChange={(e) => setProblem({ ...problem, given: e.target.value })} />
              </label>
              <label>
                Given mass (g)
                <input
                  type="number"
                  step="0.1"
                  value={problem.grams}
                  onChange={(e) => setProblem({ ...problem, grams: parseFloat(e.target.value) || 0 })}
                />
              </label>
              <label>
                Wanted substance
                <input value={problem.target} onChange={(e) => setProblem({ ...problem, target: e.target.value })} />
              </label>
            </div>
          </details>
        </section>

        <aside className="card note" aria-live="polite">
          {!result && !loading && (
            <p className="empty">
              Your margin note appears here. Write your work on the page, then tap <b>Check my work</b>.
            </p>
          )}
          {loading && <p className="empty">Reading your work…</p>}
          {result && !result.ok && <span className="status error">{result.message}</span>}
          {result && result.ok && result.offTopic && <span className="status info">{result.message}</span>}
          {result && result.ok && result.unreadable && (
            <>
              <span className="status info">I couldn&apos;t read that</span>
              <p className="hint">Try writing bigger, or type your answer in the box.</p>
            </>
          )}
          {result && result.ok && !result.offTopic && !result.unreadable && (
            <>
              <span className={`status ${result.isCorrect ? "correct" : "notyet"}`}>
                {result.isCorrect ? "Correct! Nice work" : "Not yet, let's look closer"}
              </span>
              <div className="read">
                I read: <b>{result.transcription}</b>
              </div>
              <p className="hint">{result.hint}</p>
              <div className="quote">
                <small>FROM YOUR TEACHER&apos;S LESSON</small>“{result.quote}”
              </div>
              <div className="badges">
                {result.checks?.map((c) => (
                  <span key={c.name} className={`badge ${c.passed ? "pass" : "fail"}`} title={c.detail}>
                    {c.passed ? "✓" : "!"} {c.name}
                  </span>
                ))}
              </div>
              {result.hint && (
                <button className="secondary" onClick={() => speak(result.hint!)}>
                  {supports.spanish ? "Escuchar" : "Listen"}
                </button>
              )}
              <div className="tag">
                Teacher sees: <b>{TAG_LABEL[result.misconception || "other_unclear"]}</b>
                {result.needsReview ? " · flagged for teacher review" : ""} · {codename} · model {result.modelUsed}
              </div>
              {result.steps && (
                <ol className="steps">
                  {result.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
            </>
          )}
        </aside>
      </main>

      <footer>
        <b>Live:</b> Claude reads your handwriting and writes the hint; code computes the real answer, checks the equation is
        balanced, verifies the quote is in the teacher&apos;s lesson, and blocks hints that give away the answer.{" "}
        <b>Not built yet:</b> PDF upload, teacher dashboard, live sync, voice chat. Students are fictional codenames; no real
        names are sent to the AI.
      </footer>
    </>
  );
}
