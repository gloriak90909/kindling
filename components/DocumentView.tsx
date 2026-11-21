"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getInk, putInk, type StoredDoc } from "@/lib/idb";
import { extractText, openPdf, renderPageToDataUrl, type PdfDoc } from "@/lib/pdf";
import { DEFAULT_PROBLEM } from "@/lib/lesson";
import MarginNote, { type NoteResult } from "@/components/MarginNote";
import { speakText, stopSpeech, unlockSpeech } from "@/lib/speech";

type Tool = "pen" | "marker" | "eraser";
type Supports = { simpler: boolean; spanish: boolean; readAloud: boolean };

const PROFILES: Record<string, Supports> = {
  Falcon: { simpler: true, spanish: false, readAloud: true },
  Otter: { simpler: false, spanish: true, readAloud: true },
  Kestrel: { simpler: false, spanish: false, readAloud: false },
};
const COLORS = ["#1f3a93", "#1e1e1e", "#b3261e"];

export default function DocumentView({ doc, onBack }: { doc: StoredDoc; onBack: () => void }) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [lessonText, setLessonText] = useState("");
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [codename, setCodename] = useState("Falcon");
  const [supports, setSupports] = useState<Supports>(PROFILES.Falcon);
  const [result, setResult] = useState<NoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [problem, setProblem] = useState(DEFAULT_PROBLEM);
  const [useFallback, setUseFallback] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [question, setQuestion] = useState("");
  const [micMsg, setMicMsg] = useState("");
  const [speechMsg, setSpeechMsg] = useState("");
  const questionRef = useRef("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageCanvas = useRef<HTMLCanvasElement | null>(null);
  const inkCanvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const penSeen = useRef(false);
  const renderTask = useRef<{ cancel: () => void } | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  // Open the PDF, pull its text (for the quote check) and make page thumbnails.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const opened = await openPdf(doc.data);
        if (!alive) return;
        setPdf(opened);
        extractText(opened).then((t) => alive && setLessonText(t)).catch(() => {});
        const list: string[] = [];
        for (let i = 1; i <= opened.numPages; i++) {
          list.push(await renderPageToDataUrl(opened, i, 160));
          if (!alive) return;
          setThumbs([...list]);
        }
      } catch {
        if (alive) setLoadError("Couldn't open this PDF.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [doc]);

  useEffect(() => {
    const onResize = () => setRenderTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Render the current page and load its saved ink.
  useEffect(() => {
    if (!pdf || !stageRef.current || !pageCanvas.current || !inkCanvas.current) return;
    let alive = true;
    (async () => {
      const page = await pdf.getPage(pageNum);
      const base = page.getViewport({ scale: 1 });
      const cssWidth = Math.min(stageRef.current!.clientWidth - 56, 1100);
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const pc = pageCanvas.current!;
      const ic = inkCanvas.current!;
      pc.width = ic.width = Math.round(viewport.width);
      pc.height = ic.height = Math.round(viewport.height);
      pc.style.width = ic.style.width = `${cssWidth}px`;
      pc.style.height = ic.style.height = `${Math.round(viewport.height / dpr)}px`;
      renderTask.current?.cancel();
      const task = page.render({ canvas: pc, viewport });
      renderTask.current = task;
      try {
        await task.promise;
      } catch {
        return;
      }
      if (!alive) return;
      const saved = await getInk(`${doc.id}:${pageNum}`).catch(() => undefined);
      const ctx = ic.getContext("2d")!;
      ctx.clearRect(0, 0, ic.width, ic.height);
      if (saved && alive) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, ic.width, ic.height);
        img.src = saved;
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdf, pageNum, doc.id, renderTick]);

  const saveInk = useCallback(() => {
    const ic = inkCanvas.current;
    if (ic) putInk(`${doc.id}:${pageNum}`, ic.toDataURL("image/png")).catch(() => {});
  }, [doc.id, pageNum]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = inkCanvas.current!;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "pen") penSeen.current = true;
    if (penSeen.current && e.pointerType === "touch") return; // palm rejection once a Pencil is used
    e.preventDefault();
    inkCanvas.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    last.current = { x: p.x, y: p.y };
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = inkCanvas.current!.getContext("2d")!;
    const p = pos(e);
    const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = 22 * p.k;
    } else if (tool === "marker") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(255, 214, 0, 0.22)";
      ctx.lineWidth = 16 * p.k;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
      ctx.lineWidth = (1.4 + pressure * 2.2) * p.k;
    }
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    last.current = { x: p.x, y: p.y };
  }

  function up() {
    if (drawing.current) saveInk();
    drawing.current = false;
    last.current = null;
  }

  function clearPage() {
    const ic = inkCanvas.current;
    if (!ic) return;
    ic.getContext("2d")!.clearRect(0, 0, ic.width, ic.height);
    saveInk();
  }

  function snapshot(): string {
    const pc = pageCanvas.current!;
    const ic = inkCanvas.current!;
    const scale = Math.min(1, 1400 / Math.max(pc.width, pc.height));
    const out = document.createElement("canvas");
    out.width = Math.round(pc.width * scale);
    out.height = Math.round(pc.height * scale);
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(pc, 0, 0, out.width, out.height);
    ctx.drawImage(ic, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.85);
  }

  function inkIsEmpty(): boolean {
    const ic = inkCanvas.current!;
    const small = document.createElement("canvas");
    small.width = 120;
    small.height = Math.max(1, Math.round((ic.height / ic.width) * 120));
    const ctx = small.getContext("2d")!;
    ctx.drawImage(ic, 0, 0, small.width, small.height);
    const px = ctx.getImageData(0, 0, small.width, small.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 20) return false;
    return true;
  }

  function speak(text: string) {
    setSpeechMsg("");
    speakText(text, supports.spanish ? "es-MX" : "en-US", (s) => {
      if (s === "speaking") setSpeechMsg(supports.spanish ? "Leyendo en voz alta…" : "Reading aloud…");
      if (s === "done") setSpeechMsg("");
      if (s === "error")
        setSpeechMsg(
          supports.spanish
            ? "El navegador bloqueó la voz. Toca «Escuchar»."
            : "The browser blocked the voice. Tap Listen to hear it."
        );
    });
  }

  function openAsk() {
    setAskOpen(true);
    setNoteOpen(true);
    setResult(null);
    startListening();
  }

  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setMicMsg("Voice isn't available here. Tap the mic on the keyboard to dictate, or type your question.");
      return;
    }
    stopSpeech();
    const rec = new SR();
    rec.lang = supports.spanish ? "es-MX" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      questionRef.current = t;
      setQuestion(t);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      setListening(false);
      setMicMsg(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "The microphone is blocked. Allow it in Safari, or type your question."
          : "I didn't catch that. Tap the mic and try again, or type."
      );
    };
    rec.onend = () => {
      setListening(false);
      const q = questionRef.current.trim();
      if (q) ask(q);
    };
    recRef.current = rec;
    questionRef.current = "";
    setQuestion("");
    setMicMsg("");
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setMicMsg("Couldn't start the microphone. Type your question instead.");
    }
  }

  function stopListening() {
    recRef.current?.stop();
  }

  async function ask(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q.trim(),
          image: pageCanvas.current && pageCanvas.current.width > 0 ? snapshot() : undefined,
          lessonText: lessonText.slice(0, 15000),
          supports: { simpler: supports.simpler, spanish: supports.spanish },
        }),
      });
      const data = (await res.json()) as NoteResult;
      setResult(data);
      if (data.ok && supports.readAloud) {
        const t = data.hint || data.message;
        if (t) speak(t);
      }
    } catch {
      setResult({ ok: false, message: "Couldn't reach the tutor. Check the Wi-Fi and try again." });
    } finally {
      setLoading(false);
    }
  }

  async function check() {
    setAskOpen(false);
    setNoteOpen(true);
    if (inkIsEmpty()) {
      setResult({ ok: false, message: supports.spanish ? "Escribe tu trabajo en la página primero." : "Write your work on the page first." });
      return;
    }
    setLoading(true);
    setResult(null);
    if (supports.readAloud) unlockSpeech();
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: snapshot(),
          lessonText: lessonText.slice(0, 15000),
          fallbackProblem: useFallback ? problem : null,
          supports: { simpler: supports.simpler, spanish: supports.spanish },
        }),
      });
      const data = (await res.json()) as NoteResult;
      setResult(data);
      if (data.ok && supports.readAloud) {
        const t = data.hint || data.message;
        if (t) speak(t);
      }
    } catch {
      setResult({ ok: false, message: "Couldn't reach the tutor. Check the Wi-Fi and try again." });
    } finally {
      setLoading(false);
    }
  }

  const toggle = (k: keyof Supports) => setSupports((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div className="doc-shell">
      <header className="toolbar">
        <div className="tb-group">
          <button className="tb-btn" onClick={onBack} aria-label="Back to documents">
            ‹ Documents
          </button>
          <span className="doc-title">{doc.name}</span>
        </div>
        <div className="tb-group">
          <button className="tb-btn" aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>
            Pen
          </button>
          {COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              aria-label={`Pen color ${c}`}
              aria-pressed={tool === "pen" && color === c}
              style={{ background: c }}
              onClick={() => {
                setTool("pen");
                setColor(c);
              }}
            />
          ))}
          <button className="tb-btn" aria-pressed={tool === "marker"} onClick={() => setTool("marker")}>
            Highlighter
          </button>
          <button className="tb-btn" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>
            Eraser
          </button>
          <button className="tb-btn" onClick={clearPage}>
            Clear page
          </button>
        </div>
        <div className="tb-group">
          <select
            className="tb-btn"
            value={codename}
            aria-label="Student codename"
            onChange={(e) => {
              setCodename(e.target.value);
              setSupports(PROFILES[e.target.value]);
            }}
          >
            {Object.keys(PROFILES).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button
            className="tb-btn"
            aria-pressed={supports.readAloud}
            onClick={() => {
              unlockSpeech();
              toggle("readAloud");
            }}
          >
            Read aloud
          </button>
          <button className="tb-btn" aria-pressed={supports.simpler} onClick={() => toggle("simpler")}>
            Simpler
          </button>
          <button className="tb-btn" aria-pressed={supports.spanish} onClick={() => toggle("spanish")}>
            Español
          </button>
          <button className="tb-btn" onClick={() => setSetupOpen((v) => !v)} aria-expanded={setupOpen}>
            Teacher setup
          </button>
          <button className="ask-btn" onClick={openAsk} disabled={loading || listening}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="22" />
            </svg>
            {listening ? "Listening…" : "Ask"}
          </button>
          <button className="check-btn" onClick={check} disabled={loading}>
            {loading ? "Reading…" : "Check my work"}
          </button>
        </div>
      </header>

      {setupOpen && (
        <div className="setup-bar">
          <label>
            <input type="checkbox" checked={useFallback} onChange={(e) => setUseFallback(e.target.checked)} /> Backup problem if
            the AI can&apos;t read one:
          </label>
          <input aria-label="Balanced equation" value={problem.equation} onChange={(e) => setProblem({ ...problem, equation: e.target.value })} />
          <input aria-label="Given substance" value={problem.given} onChange={(e) => setProblem({ ...problem, given: e.target.value })} />
          <input
            aria-label="Given mass in grams"
            type="number"
            step="0.1"
            value={problem.grams}
            onChange={(e) => setProblem({ ...problem, grams: parseFloat(e.target.value) || 0 })}
          />
          <input aria-label="Wanted substance" value={problem.target} onChange={(e) => setProblem({ ...problem, target: e.target.value })} />
        </div>
      )}

      <div className="doc-body">
        <nav className="thumbs" aria-label="Pages">
          {Array.from({ length: pdf?.numPages ?? doc.pages }, (_, i) => i + 1).map((n) => (
            <button key={n} className="thumb" aria-current={n === pageNum ? "page" : undefined} onClick={() => setPageNum(n)}>
              {thumbs[n - 1] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[n - 1]} alt={`Page ${n}`} />
              ) : (
                <span className="thumb-blank" />
              )}
              <span>{n}</span>
            </button>
          ))}
        </nav>

        <div className="stage" ref={stageRef}>
          {loadError && <p className="status error">{loadError}</p>}
          {!pdf && !loadError && <p className="empty">Opening…</p>}
          <div className="sheet">
            <canvas ref={pageCanvas} className="page-canvas" />
            <canvas
              ref={inkCanvas}
              className="ink-canvas"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerLeave={up}
              aria-label={`Page ${pageNum}: write your notes here`}
            />
          </div>
        </div>

        {noteOpen && (
          <MarginNote
            result={result}
            loading={loading}
            codename={codename}
            spanish={supports.spanish}
            onListen={speak}
            onClose={() => {
              stopListening();
              setNoteOpen(false);
              setAskOpen(false);
            }}
          >
            {askOpen && (
              <div className="ask-box">
                <button
                  className={`mic-big ${listening ? "on" : ""}`}
                  onClick={listening ? stopListening : startListening}
                  aria-label={listening ? "Stop listening" : "Tap to talk"}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="17" x2="12" y2="22" />
                  </svg>
                  {listening ? (supports.spanish ? "Escuchando… toca para parar" : "Listening… tap to stop") : supports.spanish ? "Toca para hablar" : "Tap to talk"}
                </button>
                <form
                  className="ask-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask(question);
                  }}
                >
                  <input
                    value={question}
                    onChange={(e) => {
                      questionRef.current = e.target.value;
                      setQuestion(e.target.value);
                    }}
                    placeholder={supports.spanish ? "O escribe tu pregunta…" : "Or type your question…"}
                    aria-label="Your question"
                  />
                  <button type="submit" disabled={loading || !question.trim()}>
                    {supports.spanish ? "Preguntar" : "Ask"}
                  </button>
                </form>
                {micMsg && <p className="mic-msg">{micMsg}</p>}
              </div>
            )}
            {speechMsg && <p className="mic-msg">{speechMsg}</p>}
          </MarginNote>
        )}
      </div>
    </div>
  );
}
