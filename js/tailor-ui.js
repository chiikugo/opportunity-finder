/* ==========================================================================
   tailor-ui.js — the "Tailor resume" tab: the screens, buttons and
   downloads. All the thinking happens in tailor.js; this file just shows it.
   --------------------------------------------------------------------------
   THE FLOW ON SCREEN
     1. The job      → paste a posting (or click "Tailor resume" on any card)
     2. Your resume  → uses the resume from the top of the page
     3. Check        → keyword match score, keyword chips, ATS checklist
     4. Questions    → you answer; the tailored resume updates as you go
     5. Result       → edit freely, then copy / .docx / .txt / PDF

   Your answers about skills are remembered (the "skill bank"), so the next
   posting that asks for, say, Figma is pre-filled with what you said.

   I WANT TO…                                 → EDIT
     change the export fonts / margins          → makeDocx() and printPdf() below
     change what's remembered between visits    → persist() below
   ========================================================================== */

import {
  analyzeJob, parseResume, compareResume, matchScore, makeQuestions, buildResume,
  draftSummary, atsChecks, textToBlocks, STRONG_VERBS,
} from "./tailor.js";
import { loadScript } from "./resume.js";

const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
const STORE = "opportunity-finder:tailor";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* --------------------------------------------------------------------------
   Remembered state (this browser only)
   -------------------------------------------------------------------------- */
const t = {
  title: "", org: "", jobText: "", url: "",
  answers: {},          // { questionId: answer }
  reorder: true,        // put relevant bullets / skills first
  skillBank: {},        // { termKey: { has, detail } } — reused across postings
  analyzed: false,
};
let ctx = null;          // the current analysis (job, parsed, compared, questions)
let manualEdit = false;  // true once you type in the result box yourself
let deps = null;         // { getResume, setResume, getSaved, showTab }

function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(t)); } catch { /* storage blocked — fine */ }
}
function restore() {
  try { Object.assign(t, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch { /* ignore */ }
}

/* ==========================================================================
   initTailor — builds the tab once and wires its buttons
   ========================================================================== */
export function initTailor(d) {
  deps = d;
  restore();
  $("#panel-tailor").innerHTML = `
  <div class="tailor">
    <p class="panel-note">Match your resume to one posting. It checks the posting's keywords against your resume,
      asks you about the gaps, and rebuilds a clean, ATS-friendly version. <b>It only adds what you confirm</b> —
      nothing is invented, and nothing leaves your browser.</p>

    <section class="t-step">
      <h3><span class="t-num">1</span> The job</h3>
      <div class="t-row">
        <input id="t-title" placeholder="Job title (e.g. Collections Assistant)" aria-label="Job title">
        <input id="t-org" placeholder="Organization" aria-label="Organization">
        <select id="t-saved" aria-label="Pick from My list"><option value="">Pick from My list…</option></select>
      </div>
      <textarea id="t-job" rows="8" placeholder="Paste the FULL job posting here — responsibilities, requirements, nice-to-haves. The more text, the better the match."></textarea>
      <p id="t-job-note" class="small muted"></p>
    </section>

    <section class="t-step">
      <h3><span class="t-num">2</span> Your resume</h3>
      <p id="t-resume-status" class="small"></p>
      <details class="paste">
        <summary>See or fix the resume text we read</summary>
        <p class="small muted">PDFs sometimes come out jumbled. Fix it here: put each section heading (EXPERIENCE, EDUCATION, SKILLS…) on its own line and start bullets with “•” or “-”.</p>
        <textarea id="t-resume" rows="12"></textarea>
      </details>
    </section>

    <button id="t-go" class="btn btn-big">Check my resume against this job</button>
    <div id="t-results"></div>
  </div>`;

  $("#t-title").value = t.title;
  $("#t-org").value = t.org;
  $("#t-job").value = t.jobText;
  const save = () => { t.title = $("#t-title").value; t.org = $("#t-org").value; t.jobText = $("#t-job").value; persist(); };
  ["#t-title", "#t-org", "#t-job"].forEach((s) => $(s).addEventListener("input", save));
  $("#t-saved").addEventListener("change", (e) => {
    const s = deps.getSaved()[e.target.value];
    if (s) tailorFor(s.item);
    e.target.value = "";
  });
  $("#t-resume").addEventListener("input", (e) => { deps.setResume(e.target.value); refreshTailorResume({ keepBox: true }); });
  $("#t-go").addEventListener("click", analyze);

  // One listener each for every question / result control (event delegation).
  $("#t-results").addEventListener("input", onAnswer);
  $("#t-results").addEventListener("change", onAnswer);
  $("#t-results").addEventListener("click", onClick);

  refreshTailorResume();
  if (t.analyzed && t.jobText.trim() && deps.getResume().text.trim()) analyze({ keepAnswers: true, quiet: true });
}

/** Fill the job box from an opportunity card and switch to this tab. */
export function tailorFor(item) {
  t.title = item.title || "";
  t.org = item.org || "";
  t.url = item.url || "";
  const parts = [item.fullText || item.blurb || ""];
  if (item.eligibility) parts.push(`Requirements\n${item.eligibility}`);
  if (item.tags?.length) parts.push(`Skills\n${item.tags.join(", ")}`);
  t.jobText = parts.filter(Boolean).join("\n\n");
  t.analyzed = false;
  t.answers = {};
  persist();
  $("#t-title").value = t.title;
  $("#t-org").value = t.org;
  $("#t-job").value = t.jobText;
  $("#t-results").innerHTML = "";
  $("#t-job-note").innerHTML = item.live && item.fullText
    ? `Loaded the posting text from ${esc(item.source)}. <a href="${esc(item.url)}" target="_blank" rel="noopener">Open the original</a> to check nothing's missing.`
    : `This is only a summary. For a real match, <a href="${esc(item.url)}" target="_blank" rel="noopener">open the official page</a> and paste the full posting above.`;
  deps.showTab("tailor");
  $("#t-job").scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Update the "Your resume" line (called when the resume changes). */
export function refreshTailorResume({ keepBox = false } = {}) {
  if (!deps || !$("#t-resume-status")) return;
  const { text, name } = deps.getResume();
  const saved = deps.getSaved();
  $("#t-saved").innerHTML = `<option value="">Pick from My list…</option>` +
    Object.entries(saved).map(([id, s]) => `<option value="${esc(id)}">${esc(s.item.title)} — ${esc(s.item.org || "")}</option>`).join("");
  if (!keepBox) $("#t-resume").value = text;
  if (!text.trim()) {
    $("#t-resume-status").innerHTML = `No resume yet. <button class="link" id="t-add-resume">Add it at the top of the page ↑</button> (PDF, Word or pasted text).`;
    $("#t-add-resume").addEventListener("click", () => document.querySelector("#ask").scrollIntoView({ behavior: "smooth" }));
    return;
  }
  const p = parseResume(text);
  const roles = p.sections.reduce((n, s) => n + s.entries.length, 0);
  const bullets = p.sections.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.bullets.length, 0), 0);
  $("#t-resume-status").innerHTML = `✓ Using <b>${esc(name || "your resume")}</b> — we found ${p.sections.length} section${p.sections.length === 1 ? "" : "s"}
    (${p.sections.map((s) => esc(s.title)).join(", ") || "none"}), ${roles} role${roles === 1 ? "" : "s"} and ${bullets} bullet${bullets === 1 ? "" : "s"}.
    ${p.sections.length < 2 ? `<span class="warn-inline">That looks off — open “See or fix the resume text” below.</span>` : ""}`;
}

/* ==========================================================================
   analyze — run the check and draw results + questions
   ========================================================================== */
function analyze({ keepAnswers = false, quiet = false } = {}) {
  const { text, name } = deps.getResume();
  t.title = $("#t-title").value; t.org = $("#t-org").value; t.jobText = $("#t-job").value;
  if (!t.jobText.trim()) { $("#t-results").innerHTML = `<p class="warn">Paste a job posting in step 1 first.</p>`; return; }
  if (!text.trim()) { $("#t-results").innerHTML = `<p class="warn">Add your resume first (top of the page, or “See or fix the resume text” in step 2).</p>`; return; }

  const job = analyzeJob(t.jobText, t.title, t.org);
  const parsed = parseResume(text);
  const compared = compareResume(job, text);
  const questions = makeQuestions(job, compared, parsed, text, t.skillBank);
  if (!keepAnswers) {
    t.answers = {};
    // pre-fill skills you already told us about on an earlier posting
    for (const q of questions) if (q.type === "missing" && q.remembered) t.answers[q.id] = { has: q.remembered.has, detail: q.remembered.detail || "", attachTo: "skills", fromBank: true };
  }
  ctx = { job, parsed, compared, questions, before: matchScore(compared), checks: atsChecks(text, parsed, { fromPdf: /\.pdf$/i.test(name || "") }) };
  manualEdit = false;
  t.analyzed = true;
  persist();
  renderResults();
  if (!quiet) $("#t-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ==========================================================================
   Drawing the results
   ========================================================================== */
function renderResults() {
  const { job, compared, questions, checks, before } = ctx;
  const groups = { have: [], swap: [], missing: [] };
  for (const k of compared) groups[k.status].push(k);
  const chip = (k) => `<span class="kw kw-${k.status}" title="${k.required ? "Requirement" : k.preferred ? "Nice to have" : "Mentioned"}">${esc(k.display)}${k.required ? "<sup>req</sup>" : ""}</span>`;
  const entries = ctx.parsed.sections.flatMap((s) => s.entries.map((e) => ({ id: e.id, label: (e.head[0] || s.title).slice(0, 70) })));

  $("#t-results").innerHTML = `
    <section class="t-step">
      <h3><span class="t-num">3</span> How you match right now</h3>
      <div class="score-row">
        ${meter("Keyword match", before, "before")}
        ${meter("After your answers", before, "after")}
      </div>
      ${compared.length ? `
      <div class="kw-groups">
        <div><span class="kw-label">✓ On your resume</span>${groups.have.map(chip).join("") || `<span class="muted small">none yet</span>`}</div>
        <div><span class="kw-label">⇄ Worded differently</span>${groups.swap.map(chip).join("") || `<span class="muted small">none</span>`}</div>
        <div><span class="kw-label">✗ Missing</span>${groups.missing.map(chip).join("") || `<span class="muted small">none — nice!</span>`}</div>
        ${job.repeated.length ? `<div><span class="kw-label">Words the posting repeats</span>${job.repeated.map((w) => `<span class="kw kw-plain">${esc(w)}</span>`).join("")}</div>` : ""}
      </div>` : `<p class="warn">We didn't recognise any skills or tools in this posting. Paste the full text (requirements especially), or add words to ATS_TERMS in js/tailor.js.</p>`}
      ${job.years ? `<p class="small muted">The posting mentions ${job.years}+ years. As a recent grad, count internships, research assistant work, freelance and big projects — list them under Experience with dates.</p>` : ""}
      <details class="checks" open>
        <summary>ATS format checklist</summary>
        <ul>${checks.map((c) => `<li class="check-${c.level}">${c.level === "good" ? "✓" : c.level === "warn" ? "!" : "✗"} ${esc(c.text)}</li>`).join("")}</ul>
      </details>
    </section>

    <section class="t-step">
      <h3><span class="t-num">4</span> A few questions <span class="muted small" id="t-progress"></span></h3>
      <p class="small muted">Skip anything that doesn't apply — unanswered questions change nothing. Answer honestly: interviews will ask about anything on your resume.</p>
      <div id="t-questions">${questions.map((q) => question(q, entries)).join("")}</div>
    </section>

    <section class="t-step">
      <h3><span class="t-num">5</span> Your tailored resume</h3>
      <label class="switch"><input type="checkbox" id="t-reorder" ${t.reorder ? "checked" : ""}> Put the most relevant bullets and skills first</label>
      <div id="t-changes"></div>
      <p id="t-manual" class="warn" hidden>You've edited the text by hand, so answers above no longer overwrite it.
        <button class="link" data-act="rebuild">Rebuild from my answers (discards hand edits)</button></p>
      <textarea id="t-out" rows="24" spellcheck="true" aria-label="Tailored resume"></textarea>
      <div class="t-actions">
        <button class="btn btn-small" data-act="docx">Download .docx</button>
        <button class="btn btn-small btn-ghost" data-act="pdf">Save as PDF</button>
        <button class="btn btn-small btn-ghost" data-act="txt">Download .txt</button>
        <button class="btn btn-small btn-ghost" data-act="copy">Copy text</button>
        <span id="t-copied" class="small muted"></span>
      </div>
      <p class="small muted">Tip: .docx or a text-based PDF from here are the safest for ATS. Avoid columns, tables, text boxes and icons.</p>
    </section>`;

  $("#t-out").addEventListener("input", () => { manualEdit = true; $("#t-manual").hidden = false; updateScore(); });
  updateOutput();
}

function meter(label, value, id) {
  return `<div class="meter"><div class="meter-top"><span>${label}</span><b id="t-score-${id}">${value}%</b></div>
    <div class="meter-bar"><span id="t-bar-${id}" style="width:${value}%"></span></div></div>`;
}

/** HTML for one question. Values come from saved answers so nothing is lost on reload. */
function question(q, entries) {
  const a = t.answers[q.id] || {};
  const head = `<div class="q" data-qid="${esc(q.id)}" data-type="${q.type}"><p class="q-prompt">${esc(q.prompt)}</p>`;
  if (q.type === "missing") {
    const radio = (v, l) => `<label class="radio"><input type="radio" name="${esc(q.id)}" value="${v}" ${a.has === v ? "checked" : ""}> ${l}</label>`;
    return `${head}
      <div class="q-choices">${radio("yes", "Yes")}${radio("some", "A little (class, personal project)")}${radio("no", "No")}</div>
      <div class="q-more" ${a.has === "yes" || a.has === "some" ? "" : "hidden"}>
        <input class="q-detail" value="${esc(a.detail || "")}" placeholder="Where or how? One line in your own words (optional) — e.g. “Used ${esc(q.display)} to …”">
        <select class="q-attach" aria-label="Where to add it">
          <option value="skills">Add to Skills only</option>
          ${entries.map((e) => `<option value="${esc(e.id)}" ${a.attachTo === e.id ? "selected" : ""}>Also add my line as a bullet under: ${esc(e.label)}</option>`).join("")}
        </select>
      </div>
      ${a.fromBank ? `<p class="small muted">Pre-filled from what you said on an earlier posting.</p>` : ""}
      ${a.has === "no" ? `<p class="small muted">Fair enough — it's left off. If it keeps coming up, it may be worth a short course or a small project.</p>` : ""}
    </div>`;
  }
  if (q.type === "swap") {
    const radio = (v, l) => `<label class="radio"><input type="radio" name="${esc(q.id)}" value="${v}" ${a.choice === v ? "checked" : ""}> ${l}</label>`;
    return `${head}<div class="q-choices">
      ${radio("both", `Use both: “${esc(q.display)} (${esc(q.foundAs)})”`)}
      ${radio("posting", `Use “${esc(q.display)}”`)}
      ${radio("keep", `Keep “${esc(q.foundAs)}”`)}</div></div>`;
  }
  if (q.type === "bullet") {
    const val = a.text ?? q.suggestion;
    return `${head}
      <p class="small muted">Under ${esc(q.where)} · Original: “${esc(q.original)}”</p>
      <textarea class="q-text" rows="2">${esc(val)}</textarea>
      <div class="verbs">${STRONG_VERBS.map((v) => `<button class="pill pill-small" data-verb="${v}">${v}</button>`).join("")}</div>
      <label class="switch small"><input type="checkbox" class="q-use" ${a.use ? "checked" : ""}> Use this version</label>
    </div>`;
  }
  if (q.type === "headline") {
    return `${head}<input class="q-text" value="${esc(a.text ?? q.suggestion)}">
      <label class="switch small"><input type="checkbox" class="q-use" ${a.use ? "checked" : ""}> Add this headline</label></div>`;
  }
  if (q.type === "summary") {
    const draft = a.text ?? draftSummary(ctx.job, ctx.compared, ctx.parsed, t.answers);
    return `${head}<textarea class="q-text" rows="3">${esc(draft)}</textarea>
      <div class="q-row"><label class="switch small"><input type="checkbox" class="q-use" ${a.use ? "checked" : ""}> Use this summary</label>
      <button class="link" data-act="redraft">Re-draft from my latest answers</button></div></div>`;
  }
  if (q.type === "contact") {
    return `${head}<input class="q-value" value="${esc(a.value || "")}" placeholder="${esc(q.placeholder)}"></div>`;
  }
  return "";
}

/* ==========================================================================
   Reacting to answers
   ========================================================================== */
function onAnswer(e) {
  if (e.target.id === "t-reorder") { t.reorder = e.target.checked; persist(); updateOutput(); return; }
  const box = e.target.closest(".q");
  if (!box) return;
  const id = box.dataset.qid;
  const type = box.dataset.type;
  const q = ctx.questions.find((x) => x.id === id);
  const a = { ...(t.answers[id] || {}) };
  delete a.fromBank;
  if (type === "missing") {
    a.has = box.querySelector("input[type=radio]:checked")?.value;
    a.detail = box.querySelector(".q-detail").value;
    a.attachTo = box.querySelector(".q-attach").value;
    box.querySelector(".q-more").hidden = !(a.has === "yes" || a.has === "some");
    if (a.has) t.skillBank[q.termKey] = { has: a.has, detail: a.detail };   // remember for next time
  } else if (type === "swap") {
    a.choice = box.querySelector("input[type=radio]:checked")?.value;
  } else if (type === "contact") {
    a.value = box.querySelector(".q-value").value;
  } else {
    a.text = box.querySelector(".q-text").value;
    // typing in the box means you want to use it
    if (e.target.classList.contains("q-text") && e.type === "input") box.querySelector(".q-use").checked = true;
    a.use = box.querySelector(".q-use").checked;
  }
  t.answers[id] = a;
  persist();
  updateOutput();
}

function onClick(e) {
  const verb = e.target.closest("[data-verb]");
  if (verb) {
    // Swap the first word of the bullet for the chosen verb.
    const box = verb.closest(".q");
    const ta = box.querySelector(".q-text");
    ta.value = verb.dataset.verb + " " + ta.value.replace(/^\S+\s*/, "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "redraft") {
    const box = e.target.closest(".q");
    box.querySelector(".q-text").value = draftSummary(ctx.job, ctx.compared, ctx.parsed, t.answers);
    box.querySelector(".q-text").dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (act === "rebuild") { manualEdit = false; $("#t-manual").hidden = true; updateOutput(); }
  if (act === "copy") copyText();
  if (act === "txt") download(new Blob([$("#t-out").value], { type: "text/plain" }), fileName("txt"));
  if (act === "docx") makeDocx(currentBlocks()).catch((err) => alert(err.message));
  if (act === "pdf") printPdf(currentBlocks());
}

/** Rebuild the tailored resume from answers (unless you've hand-edited it). */
function updateOutput() {
  if (!ctx) return;
  const answered = ctx.questions.filter((q) => {
    const a = t.answers[q.id];
    return a && (a.has || a.choice || a.use || (a.value && a.value.trim()));
  }).length;
  $("#t-progress").textContent = `· ${answered} of ${ctx.questions.length} answered`;
  const out = buildResume(ctx.parsed, ctx.job, ctx.compared, t.answers, { reorder: t.reorder });
  ctx.lastBlocks = out.blocks;
  $("#t-changes").innerHTML = out.changes.length
    ? `<details class="changes"><summary>${out.changes.length} change${out.changes.length > 1 ? "s" : ""} from your original</summary><ul>${out.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></details>`
    : `<p class="small muted">No changes yet — answer a question above and this updates instantly.</p>`;
  if (!manualEdit) $("#t-out").value = out.text;
  updateScore();
}

function updateScore() {
  const after = matchScore(compareResume(ctx.job, $("#t-out").value));
  $("#t-score-after").textContent = `${after}%`;
  $("#t-bar-after").style.width = `${after}%`;
}

function currentBlocks() {
  return manualEdit ? textToBlocks($("#t-out").value) : ctx.lastBlocks;
}

/* ==========================================================================
   Exports
   ========================================================================== */
function fileName(ext) {
  const name = (ctx.parsed.header[0] || "resume").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  const role = (t.title || "tailored").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${name}-${role}.${ext}`;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyText() {
  try { await navigator.clipboard.writeText($("#t-out").value); $("#t-copied").textContent = "Copied!"; }
  catch { $("#t-out").select(); document.execCommand("copy"); $("#t-copied").textContent = "Copied!"; }
  setTimeout(() => ($("#t-copied").textContent = ""), 2000);
}

/* A real .docx: a .zip of a few XML files. One column, Calibri, standard
   headings, plain "•" bullets — the format ATS systems read best.
   👉 Fonts / sizes: change FONT and the `size` numbers (half-points: 21 = 10.5pt). */
const FONT = "Calibri";
function makeDocx(blocks) {
  return loadScript(JSZIP).then(async () => {
    const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const p = (text, { bold = false, size = 21, center = false, bullet = false, before = 0, after = 40, rule = false } = {}) =>
      `<w:p><w:pPr>${rule ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="888888"/></w:pBdr>` : ""}` +
      `<w:spacing w:before="${before}" w:after="${after}"/>${bullet ? `<w:ind w:left="360" w:hanging="220"/>` : ""}${center ? `<w:jc w:val="center"/>` : ""}</w:pPr>` +
      `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr>` +
      `<w:t xml:space="preserve">${x(bullet ? "•\t" + text : text)}</w:t></w:r></w:p>`;
    const body = blocks.map((b) => {
      if (b.type === "name") return p(b.text, { bold: true, size: 32, center: true, after: 40 });
      if (b.type === "contact") return p(b.text, { size: 20, center: true, after: 20 });
      if (b.type === "headline") return p(b.text, { bold: true, size: 22, center: true, before: 60, after: 60 });
      if (b.type === "heading") return p(b.text, { bold: true, size: 22, before: 200, after: 60, rule: true });
      if (b.type === "entry") return p(b.text, { bold: true, before: 80, after: 20 });
      if (b.type === "bullet") return p(b.text, { bullet: true, after: 30 });
      return p(b.text);
    }).join("");
    const zip = new window.JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="864" w:right="1008" w:bottom="864" w:left="1008" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    download(blob, fileName("docx"));
  });
}

/* "Save as PDF": a plain, single-column page sent to the browser's print
   dialog (choose "Save as PDF" there). Text stays selectable = ATS-readable. */
function printPdf(blocks) {
  const x = (s) => esc(s);
  const html = blocks.map((b) => {
    if (b.type === "name") return `<h1>${x(b.text)}</h1>`;
    if (b.type === "contact") return `<p class="c">${x(b.text)}</p>`;
    if (b.type === "headline") return `<p class="hl">${x(b.text)}</p>`;
    if (b.type === "heading") return `<h2>${x(b.text)}</h2>`;
    if (b.type === "entry") return `<p class="e">${x(b.text)}</p>`;
    if (b.type === "bullet") return `<p class="b">• ${x(b.text)}</p>`;
    return `<p>${x(b.text)}</p>`;
  }).join("");
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(frame);
  frame.contentDocument.open();
  frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>${x(fileName("pdf").replace(/\.pdf$/, ""))}</title><style>
    @page { margin: 0.6in 0.7in; }
    body { font: 10.5pt/1.35 Calibri, Arial, sans-serif; color: #000; margin: 0; }
    h1 { font-size: 16pt; text-align: center; margin: 0 0 2pt; }
    .c { text-align: center; margin: 0 0 1pt; font-size: 10pt; }
    .hl { text-align: center; font-weight: bold; margin: 4pt 0; }
    h2 { font-size: 11pt; border-bottom: 1px solid #888; margin: 10pt 0 3pt; padding-bottom: 1pt; }
    p { margin: 0 0 2pt; } .e { font-weight: bold; margin-top: 5pt; } .b { padding-left: 14pt; text-indent: -9pt; }
  </style></head><body>${html}</body></html>`);
  frame.contentDocument.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 250);
}
