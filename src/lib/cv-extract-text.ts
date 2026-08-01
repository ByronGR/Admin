// ── CV text extraction (PDF + Word) ──────────────────────────────────────────
// Pulls plain text out of an uploaded CV buffer. The buffer is never persisted —
// callers parse in memory and discard. Legacy .doc is not supported by mammoth.
//
// PDF: we use pdf.js (pdfjs-dist), NOT pdf-parse. Many designed résumés store
// glyphs positioned individually with NO space characters, so a naive extractor
// yields "ByronGiraldo". pdf.js exposes each text item's on-page x/y, letting us
// rebuild spaces (from horizontal gaps) and line breaks (from vertical jumps).
// Pure JS, so it runs in the Vercel serverless runtime (unlike poppler/pdftotext).

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export type CVFileKind = 'pdf' | 'docx';

export function detectKind(filename: string, mime?: string): CVFileKind | null {
  const name = filename.toLowerCase();
  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (
    name.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) return 'docx';
  return null;
}

interface PdfTextItem { str: string; width: number; height: number; transform: number[]; hasEOL: boolean; }

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Legacy build runs headless in Node (no DOM/canvas needed for text).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;

  const lines: string[] = [];
  const links = new Set<string>();
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      // Hyperlinks (e.g. a LinkedIn/portfolio link behind the word "LinkedIn")
      // live in link annotations, not the visible text — harvest their URLs.
      try {
        const annotations = await page.getAnnotations();
        for (const a of annotations as Array<{ url?: string }>) {
          if (a.url) links.add(a.url.replace(/[.,)]+$/, ''));
        }
      } catch { /* annotations are best-effort */ }
      const content = await page.getTextContent();
      let line = '';
      let lastY: number | null = null;
      let lastEndX = 0;
      let lastH = 10;
      for (const raw of content.items) {
        const it = raw as unknown as PdfTextItem;
        if (typeof it.str !== 'string') continue;
        const x = it.transform[4];
        const y = it.transform[5];
        const h = it.height || lastH;
        if (lastY !== null && Math.abs(y - lastY) > Math.max(2, h * 0.5)) {
          // Vertical jump → new line.
          lines.push(line.trimEnd());
          line = '';
          lastEndX = 0;
        } else if (line && x - lastEndX > h * 0.28) {
          // Horizontal gap wider than ~a space → insert one.
          line += ' ';
        }
        line += it.str;
        lastEndX = x + it.width;
        lastY = y;
        lastH = h;
        if (it.hasEOL) { lines.push(line.trimEnd()); line = ''; lastEndX = 0; }
      }
      if (line.trim()) lines.push(line.trimEnd());
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  // Append harvested hyperlink URLs so URL extraction can find links that were
  // only shown as anchor text (e.g. "LinkedIn"). Kept on their own lines.
  if (links.size) lines.push('', ...links);
  // Collapse runs of blank lines so the section parser sees a clean document.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function extractCVText(buffer: Buffer, kind: CVFileKind): Promise<string> {
  if (kind === 'pdf') return extractPdfText(buffer);
  // docx — mammoth returns raw text with layout collapsed to newlines.
  const mammoth = require('mammoth') as { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> };
  const { value } = await mammoth.extractRawText({ buffer });
  return value || '';
}
