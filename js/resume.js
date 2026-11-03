/* ==========================================================================
   resume.js — reads the text out of a resume file IN YOUR BROWSER.
   --------------------------------------------------------------------------
   PRIVACY: the file never leaves your computer. It isn't uploaded anywhere;
   we just read the words so the matcher and the Tailor tab can use them.

   Supported files:
     .pdf   → read with PDF.js (Mozilla's PDF reader, loaded from cdnjs)
     .docx  → read with Mammoth (loaded from cdnjs)
     .txt / .md / anything else → read as plain text

   The helper libraries are only downloaded the first time you pick a file
   of that type, so the page stays fast otherwise.
   ========================================================================== */

// Exact library versions (pinned so an update can't break the page).
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

/** Add a <script> tag once and wait for it to load. (Also used by the Tailor tab.) */
const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error("Couldn't load a helper file — check your connection.")); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

/* PDFs don't store "lines" — just bits of text at x/y positions. We rebuild
   lines by starting a new one whenever the y position changes, and add a
   space when there's a horizontal gap between two bits on the same line.
   Keeping lines matters: the Tailor tab needs headings and bullets on
   their own lines. */
async function readPdf(file) {
  await loadScript(PDFJS);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "", lastY = null, lastEnd = null;
    for (const it of content.items) {
      const [, , , , x, y] = it.transform || [0, 0, 0, 0, 0, lastY];
      if (lastY !== null && Math.abs(y - lastY) > 2 && line.trim()) { text += line.trim() + "\n"; line = ""; lastEnd = null; }
      if (lastEnd !== null && x - lastEnd > 1.5 && !line.endsWith(" ") && !it.str.startsWith(" ")) line += " ";
      line += it.str;
      lastY = y;
      lastEnd = x + (it.width || 0);
      if (it.hasEOL) { if (line.trim()) text += line.trim() + "\n"; line = ""; lastEnd = null; }
    }
    if (line.trim()) text += line.trim() + "\n";
  }
  return text;
}

async function readDocx(file) {
  await loadScript(MAMMOTH);
  const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value.replace(/\n{2,}/g, "\n");
}

/** Main entry: give it a File (from the file picker), get back its text. */
export async function readResume(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return readPdf(file);
  if (name.endsWith(".docx")) return readDocx(file);
  if (name.endsWith(".doc")) throw new Error("Old .doc files can't be read — save it as PDF or .docx, or paste the text.");
  return file.text();
}
