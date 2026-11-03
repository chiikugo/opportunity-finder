/* ==========================================================================
   resume.js — reads the text out of a resume file IN YOUR BROWSER.
   --------------------------------------------------------------------------
   PRIVACY: the file never leaves your computer. It isn't uploaded anywhere;
   we just read the words so the matcher can find your skills.

   Supported files:
     .pdf   → read with PDF.js (Mozilla's PDF reader, loaded from cdnjs)
     .docx  → read with Mammoth (loaded from cdnjs)
     .txt / .md / anything else → read as plain text

   The two helper libraries are only downloaded the first time you pick
   a file of that type, so the page stays fast otherwise.
   ========================================================================== */

// Exact library versions (pinned so an update can't break the page).
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

/** Add a <script> tag once and wait for it to load. */
const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load the file reader — check your connection."));
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

async function readPdf(file) {
  await loadScript(PDFJS);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return text;
}

async function readDocx(file) {
  await loadScript(MAMMOTH);
  const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

/** Main entry: give it a File (from the file picker), get back its text. */
export async function readResume(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return readPdf(file);
  if (name.endsWith(".docx")) return readDocx(file);
  if (name.endsWith(".doc")) throw new Error("Old .doc files can't be read — save it as PDF or .docx, or paste the text.");
  return file.text();
}
