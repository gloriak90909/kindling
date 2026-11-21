"use client";

export type NoteResult =
  | {
      ok: true;
      isCorrect?: boolean | null;
      misconception?: string;
      needsReview?: boolean;
      transcription?: string;
      hint?: string;
      quote?: string;
      checks?: { name: string; passed: boolean; detail: string }[];
      steps?: string[] | null;
      problemText?: string | null;
      problemSource?: string | null;
      modelUsed?: string;
      asked?: string;
      offTopic?: boolean;
      unreadable?: boolean;
      message?: string;
    }
  | { ok: false; message: string };

const TAG_LABEL: Record<string, string> = {
  correct: "Correct",
  flipped_mole_ratio: "Flipped the mole ratio",
  mass_ratio: "Used a mass ratio instead of a mole ratio",
  ignored_mole_ratio: "Skipped the mole ratio",
  wrong_molar_mass: "Wrong molar mass",
  not_balanced: "Didn't balance the equation first",
  other_unclear: "Unclear, needs teacher review",
};

export default function MarginNote({
  result,
  loading,
  codename,
  spanish,
  onListen,
  onClose,
  children,
}: {
  result: NoteResult | null;
  loading: boolean;
  codename: string;
  spanish: boolean;
  onListen: (t: string) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <aside className="margin-note" aria-live="polite">
      <button className="note-close" onClick={onClose} aria-label="Close note">
        ×
      </button>
      {children}
      {loading && <p className="empty">Thinking…</p>}
      {result && result.ok && result.asked && (
        <div className="read">
          You asked: <b>{result.asked}</b>
        </div>
      )}
      {result && !result.ok && <span className="status error">{result.message}</span>}
      {result && result.ok && result.offTopic && <span className="status info">{result.message}</span>}
      {result && result.ok && result.unreadable && (
        <>
          <span className="status info">I couldn&apos;t read that</span>
          <p className="hint">Try writing a little bigger, then check again.</p>
        </>
      )}
      {result && result.ok && !result.offTopic && !result.unreadable && (
        <>
          <span className={`status ${result.isCorrect ? "correct" : result.isCorrect === false ? "notyet" : "info"}`}>
            {result.isCorrect
              ? "Correct! Nice work"
              : result.isCorrect === false
                ? "Not yet, let's look closer"
                : result.asked
                  ? "Kindling says"
                  : "Here's a hint"}
          </span>
          {result.transcription && (
            <div className="read">
              I read: <b>{result.transcription}</b>
            </div>
          )}
          <p className="hint">{result.hint}</p>
          {result.quote && (
            <div className="quote">
              <small>FROM YOUR TEACHER&apos;S MATERIAL</small>“{result.quote}”
            </div>
          )}
          <div className="badges">
            {result.checks?.map((c) => (
              <span key={c.name} className={`badge ${c.passed ? "pass" : "fail"}`} title={c.detail}>
                {c.passed ? "✓" : "!"} {c.name}
              </span>
            ))}
          </div>
          {result.hint && (
            <button className="secondary" onClick={() => onListen(result.hint!)}>
              {spanish ? "Escuchar" : "Listen"}
            </button>
          )}
          {result.problemText && (
            <div className="tag">
              Problem ({result.problemSource}): {result.problemText}
            </div>
          )}
          {!result.asked && (
            <div className="tag">
              Teacher sees: <b>{TAG_LABEL[result.misconception || "other_unclear"] ?? result.misconception}</b>
              {result.needsReview ? " · flagged for review" : ""} · {codename} · {result.modelUsed}
            </div>
          )}
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
  );
}
