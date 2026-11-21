"use client";

import { useEffect, useRef, useState } from "react";
import { deleteDoc, listDocs, putDoc, type DocKind, type StoredDoc } from "@/lib/idb";
import { makeThumb } from "@/lib/pdf";

// The teacher's PDFs that ship with the app (from the repo's docs/ folder).
const BUILT_IN: { id: string; file: string; name: string; kind: DocKind }[] = [
  { id: "builtin-lecture-2", file: "/library/lecture-2-add-on-slides.pdf", name: "Lecture 2 Add-On (Slides)", kind: "slides" },
  { id: "builtin-lecture-4", file: "/library/lecture-4-add-on-slides.pdf", name: "Lecture 4 Add-On (Slides)", kind: "slides" },
];

async function seedBuiltIns(existing: StoredDoc[]) {
  for (const b of BUILT_IN) {
    if (existing.some((d) => d.id === b.id)) continue;
    try {
      const res = await fetch(b.file);
      if (!res.ok) continue;
      const data = await res.arrayBuffer();
      const { thumb, pages } = await makeThumb(data);
      await putDoc({ id: b.id, name: b.name, kind: b.kind, data, thumb, pages, addedAt: 1 });
    } catch {
      // skip a file that won't load
    }
  }
}

export default function Library({ onOpen }: { onOpen: (doc: StoredDoc) => void }) {
  const [docs, setDocs] = useState<StoredDoc[]>([]);
  const [filter, setFilter] = useState<"all" | DocKind>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const kindRef = useRef<DocKind>("worksheet");

  async function refresh() {
    try {
      const all = await listDocs();
      setDocs(all.sort((a, b) => b.addedAt - a.addedAt));
    } catch {
      setError("This browser blocked on-device storage. Turn off Private Browsing and try again.");
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await seedBuiltIns(await listDocs());
      } catch {
        // storage blocked; refresh() shows the message
      }
      refresh();
    })();
  }, []);

  function pick(kind: DocKind) {
    kindRef.current = kind;
    setError("");
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      setError("That isn't a PDF. Please choose a .pdf file.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setError("That PDF is over 30 MB. Please use a smaller file.");
      return;
    }
    setBusy(true);
    try {
      const data = await file.arrayBuffer();
      const { thumb, pages } = await makeThumb(data);
      await putDoc({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name.replace(/\.pdf$/i, ""),
        kind: kindRef.current,
        data,
        thumb,
        pages,
        addedAt: Date.now(),
      });
      await refresh();
    } catch {
      setError("Couldn't open that PDF. It may be damaged or password-protected.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: StoredDoc) {
    if (!window.confirm(`Remove "${doc.name}" and its notes from this iPad?`)) return;
    await deleteDoc(doc.id);
    refresh();
  }

  const shown = docs.filter((d) => filter === "all" || d.kind === filter);

  return (
    <div className="library">
      <header className="topbar">
        <div className="brand brand-logo">
          <svg width="28" height="28" viewBox="0 0 44 44" aria-hidden="true">
            <path d="M22 4 C30 14 34 20 34 27 A12 12 0 0 1 10 27 C10 20 14 14 22 4 Z" fill="none" stroke="#c2410c" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M22 20 C26 25 27 28 27 31 A5 5 0 0 1 17 31 C17 28 18 25 22 20 Z" fill="#c2410c" />
          </svg>
          <h1>Kindling</h1>
          <span>No minds left behind.</span>
        </div>
        <div className="controls">
          <button className="pill strong" onClick={() => pick("worksheet")} disabled={busy}>
            + Import worksheet
          </button>
          <button className="pill" onClick={() => pick("slides")} disabled={busy}>
            + Import slides
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={onFile} />
        </div>
      </header>

      <div className="lib-body">
        <div className="tabs" role="tablist">
          {(["all", "worksheet", "slides"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className="tab" onClick={() => setFilter(f)}>
              {f === "all" ? "All documents" : f === "worksheet" ? "Worksheets" : "Slides"}
            </button>
          ))}
        </div>
        {busy && <p className="empty">Opening your PDF…</p>}
        {error && <p className="status error">{error}</p>}
        {shown.length === 0 && !busy && (
          <p className="empty">
            No documents yet. Import your teacher&apos;s worksheet or slides (PDF) to start taking notes.{" "}
            <a href="/simple">Or try the quick demo page.</a>
          </p>
        )}
        <div className="grid">
          {shown.map((d) => (
            <div key={d.id} className="doc-card">
              <button className="doc-open" onClick={() => onOpen(d)} aria-label={`Open ${d.name}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.thumb} alt="" />
              </button>
              <div className="doc-meta">
                <b>{d.name}</b>
                <span>
                  {d.kind === "worksheet" ? "Worksheet" : "Slides"} · {d.pages} {d.pages === 1 ? "page" : "pages"}
                </span>
              </div>
              <button className="doc-remove" onClick={() => remove(d)} aria-label={`Remove ${d.name}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
