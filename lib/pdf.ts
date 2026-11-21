// pdf.js, loaded only in the browser. Legacy build = works on older iPad Safari.

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
export type PdfDoc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

let cached: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  if (!cached) {
    cached = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return m;
    });
  }
  return cached;
}

export async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
}

export async function renderPageToDataUrl(pdf: PdfDoc, pageNum: number, width: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.8);
}

export async function makeThumb(data: ArrayBuffer): Promise<{ thumb: string; pages: number }> {
  const pdf = await openPdf(data);
  return { thumb: await renderPageToDataUrl(pdf, 1, 320), pages: pdf.numPages };
}

export async function extractText(pdf: PdfDoc): Promise<string> {
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    parts.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return parts.join("\n").replace(/[ \t]+/g, " ").trim();
}
