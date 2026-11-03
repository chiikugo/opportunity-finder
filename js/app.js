/* ==========================================================================
   app.js — the "glue": reads what you type / upload, runs the matcher,
   applies the filters, and draws the cards on the page.
   --------------------------------------------------------------------------
   MAP OF THIS FILE
     state ............ everything the page remembers (filters, saved list…)
     save/load ........ keeps that in your browser between visits
     runSearch() ...... the "Find opportunities" button
     renderPrograms() . tab 1: curated fellowships & programs
     renderLive() ..... tab 2: live remote jobs
     renderBoards() ... tab 3: more places to search
     renderFresh() .... tab 2: new finds collected by the daily scraper
     renderSaved() .... "My list": your saved items / application tracker
     (the Tailor resume tab lives in js/tailor-ui.js)
     card() ........... the HTML for one opportunity card

   I WANT TO…                                  → EDIT
     add/fix a fellowship                       → js/data/opportunities.js
     add a job site to "More places to search"  → js/data/boards.js
     make the matcher smarter                   → js/match.js (SKILLS, WEIGHTS)
     change colours / fonts                     → styles.css (top section)
     change default filters                     → DEFAULT_FILTERS below
     change the daily scraper's sources         → scripts/scrape.mjs
     change how resume tailoring works          → js/tailor.js
   ========================================================================== */

import { OPPORTUNITIES, LAST_CHECKED } from "./data/opportunities.js";
import { BOARDS } from "./data/boards.js";
import { buildProfile, scoreItem, timingOf } from "./match.js";
import { fetchLiveJobs, pickTerms } from "./live.js";
import { readResume } from "./resume.js";
import { initTailor, tailorFor, refreshTailorResume } from "./tailor-ui.js";

/* --------------------------------------------------------------------------
   Defaults — what the filters start as on a first visit.
   👉 Flip these to change the starting view.
   -------------------------------------------------------------------------- */
const DEFAULT_FILTERS = {
  fields: ["tech", "art", "fashion", "research"], // which areas to show
  kinds: [],                 // empty = every kind
  remoteFriendly: true,      // only remote + hybrid (you asked for mostly remote)
  includeUnpaid: true,       // show free art/fashion/research roles (tech unpaid is ALWAYS hidden)
  hideClosed: false,         // hide things whose next round is far away
  hideSenior: true,          // live jobs: hide senior / director titles
  sort: "match",             // "match" | "deadline"
};

// Statuses for your saved list. 👉 Rename or add stages here.
const STATUSES = ["Interested", "Preparing", "Applied", "Interviewing", "Offer", "Not for me"];

/* --------------------------------------------------------------------------
   state — the page's memory
   -------------------------------------------------------------------------- */
const state = {
  prompt: "",
  resumeText: "",
  resumeName: "",
  filters: { ...DEFAULT_FILTERS },
  tab: "programs",
  liveJobs: [],
  liveErrors: [],
  liveTerms: [],
  liveLoading: false,
  saved: {},                 // { id: { item, status, note, savedAt } }
  fresh: [],                 // new finds from data/fresh.json (daily scraper)
  freshUpdated: "",          // when the scraper last ran
  freshSources: [],          // [{ name, url, ok, count }]
  linkCheck: {},             // { curatedId: HTTP status } from the daily scraper
  hasRun: false,
};

/* --------------------------------------------------------------------------
   save / load — browser storage. Wrapped in try/catch: in a private window
   storage can be blocked, and the page should still work.
   -------------------------------------------------------------------------- */
const STORE_KEY = "opportunity-finder:v1";
function persist() {
  try {
    const { prompt, resumeText, resumeName, filters, tab, saved, hasRun } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify({ prompt, resumeText, resumeName, filters, tab, saved, hasRun }));
  } catch { /* storage blocked — fine */ }
}
function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    Object.assign(state, s, { filters: { ...DEFAULT_FILTERS, ...(s.filters || {}) } });
  } catch { /* ignore */ }
}

/* --------------------------------------------------------------------------
   Tiny DOM helpers
   -------------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
/** Make text safe to put inside HTML (stops "<" in a job title breaking the page). */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FIELD_LABEL = { tech: "Tech", art: "Art", fashion: "Fashion", research: "Research" };
const KIND_LABEL = {
  fellowship: "Fellowship", residency: "Residency", grant: "Grant", internship: "Internship",
  "part-time": "Part-time", volunteer: "Volunteer", job: "Job", contract: "Contract",
};
const PAY_LABEL = { paid: "Paid", stipend: "Stipend / award", unpaid: "Unpaid", unknown: "Pay: check" };
const WHERE_LABEL = { remote: "Remote", hybrid: "Remote option", onsite: "On-site", unknown: "Location: check" };
// Scraped items count as "new" for this many days after we first see them.
const NEW_DAYS = 7;

/* ==========================================================================
   The profile — recomputed whenever the prompt or resume changes
   ========================================================================== */
let profile = buildProfile("", "");
function refreshProfile({ applyAsked = true } = {}) {
  profile = buildProfile(state.resumeText, state.prompt);
  if (!applyAsked) return;
  // If your prompt names fields ("fashion research"), narrow the field
  // filter to those automatically. You can still click to change it.
  // Kinds ("fellowship", "grant"…) are NOT used as a hard filter — people
  // say "fellowship" loosely — they just push matching cards to the top.
  if (profile.asked.fields.length) state.filters.fields = [...profile.asked.fields];
  state.filters.kinds = profile.asked.kinds.includes("part-time") ? ["part-time"] : [];
}

/* ==========================================================================
   Filtering — the rules every card has to pass
   ========================================================================== */
function passes(item, timing) {
  const f = state.filters;
  // field: at least one of the item's fields is switched on
  if (!item.fields.some((x) => f.fields.includes(x))) return false;
  // kind. Live job posts are all "jobs", so the Type filter only touches
  // them when you picked Part-time (then: part-time + contract posts only).
  if (item.live) {
    if (f.kinds.includes("part-time") && item.kind !== "part-time" && item.kind !== "contract") return false;
  } else if (f.kinds.length && !f.kinds.includes(item.kind)) return false;
  // remote-friendly
  if (f.remoteFriendly && item.where === "onsite") return false;
  // YOUR RULE: tech must be paid. An unpaid item that is ONLY tech is never shown.
  const nonTech = item.fields.some((x) => x !== "tech");
  if (item.pay === "unpaid" && !nonTech) return false;
  // unpaid art / fashion / research — optional
  if (item.pay === "unpaid" && !f.includeUnpaid) return false;
  // far-off rounds
  if (f.hideClosed && timing && timing.state === "later") return false;
  return true;
}

/** Score + filter + sort a list. Returns [{ item, timing, score, reasons }]. */
function rank(list) {
  const out = [];
  for (const item of list) {
    const timing = item.live ? { state: "rolling", label: "Posted " + ago(item.date) }
      : item.fresh && !item.deadline ? { state: "unknown", label: "Found " + ago(item.firstSeen) }
      : timingOf(item);
    if (!passes(item, timing)) continue;
    const { score, reasons } = scoreItem(item, profile, timing);
    out.push({ item, timing, score, reasons });
  }
  if (state.filters.sort === "deadline") {
    const order = { open: 0, soon: 1, rolling: 2, unknown: 3, later: 4 };
    out.sort((a, b) => (order[a.timing.state] - order[b.timing.state]) || ((a.timing.days ?? 999) - (b.timing.days ?? 999)) || (b.score - a.score));
  } else {
    out.sort((a, b) => b.score - a.score);
  }
  return out;
}

function isNew(item) {
  return item.fresh && item.firstSeen && (Date.now() - new Date(item.firstSeen).getTime()) / 864e5 <= NEW_DAYS;
}

/** Find any opportunity by id, wherever it came from. */
function findItem(id) {
  return OPPORTUNITIES.find((o) => o.id === id) || state.liveJobs.find((j) => j.id === id)
    || state.fresh.find((f) => f.id === id) || state.saved[id]?.item;
}

function ago(iso) {
  if (!iso) return "recently";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 864e5);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/* ==========================================================================
   card() — HTML for one opportunity
   ========================================================================== */
function card({ item, timing, reasons }, { showWhy = true } = {}) {
  const saved = !!state.saved[item.id];
  const payClass = item.pay === "unpaid" ? "tag-muted" : "tag-pay";
  return `
  <article class="card" data-id="${esc(item.id)}">
    <div class="card-top">
      <span class="timing timing-${timing.state}">${isNew(item) ? `<span class="new">New</span> ` : ""}${esc(timing.label)}</span>
      <button class="save ${saved ? "is-saved" : ""}" data-save="${esc(item.id)}" aria-pressed="${saved}"
        title="${saved ? "Remove from My list" : "Save to My list"}">${saved ? "★ Saved" : "☆ Save"}</button>
    </div>
    <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
    <p class="org">${esc(item.org || "")}${item.location && item.live ? ` · ${esc(item.location)}` : ""}</p>
    <div class="tags">
      <span class="tag ${payClass}">${esc(PAY_LABEL[item.pay] || "Paid")}</span>
      <span class="tag">${esc(WHERE_LABEL[item.where] || "Remote")}</span>
      <span class="tag">${esc(KIND_LABEL[item.kind] || item.kind)}</span>
      ${item.fields.map((f) => `<span class="tag tag-field tag-${f}">${FIELD_LABEL[f]}</span>`).join("")}
    </div>
    ${item.blurb ? `<p class="blurb">${esc(item.blurb)}</p>` : ""}
    <dl class="facts">
      ${item.payNote ? `<div><dt>Money</dt><dd>${esc(item.payNote)}</dd></div>` : ""}
      ${item.whereNote ? `<div><dt>Where</dt><dd>${esc(item.whereNote)}</dd></div>` : ""}
      ${item.eligibility ? `<div><dt>Who</dt><dd>${esc(item.eligibility)}</dd></div>` : ""}
      ${item.cycle ? `<div><dt>When</dt><dd>${esc(item.cycle)}</dd></div>` : ""}
    </dl>
    ${[0, 404, 410].includes(state.linkCheck[item.id]) && !item.live && !item.fresh
      ? `<p class="warn small">This link didn't load in today's automatic check — the program may have moved. Search for it by name.</p>` : ""}
    ${showWhy && reasons && reasons.length ? `<p class="why"><b>Why it fits:</b> ${esc(reasons.join(" · "))}</p>` : ""}
    <div class="card-foot">
      <span class="foot-btns">
        <a class="btn btn-small" href="${esc(item.url)}" target="_blank" rel="noopener">Open ${item.live || item.fresh ? "listing" : "official page"} ↗</a>
        <button class="btn btn-small btn-ghost" data-tailor="${esc(item.id)}" title="Match your resume to this">Tailor resume</button>
      </span>
      ${item.live || item.fresh ? `<span class="via">via <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">${esc(item.source)}</a></span>` : ""}
    </div>
  </article>`;
}

/* ==========================================================================
   Tab 1 — curated programs
   ========================================================================== */
function renderPrograms() {
  const ranked = rank(OPPORTUNITIES);
  const hidden = OPPORTUNITIES.length - ranked.length;
  $("#panel-programs").innerHTML = `
    <p class="panel-note">${ranked.length} hand-checked opportunit${ranked.length === 1 ? "y" : "ies"}${hidden ? ` · ${hidden} hidden by filters` : ""}.
      Deadlines change every year — always confirm on the official page.</p>
    <div class="grid">${ranked.map((r) => card(r, { showWhy: state.hasRun })).join("") || empty("Nothing passes these filters — try switching some back on.")}</div>`;
}

/* ==========================================================================
   Tab 2 — new finds (collected daily by scripts/scrape.mjs → data/fresh.json)
   ========================================================================== */
async function loadFresh() {
  try {
    const res = await fetch("data/fresh.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.fresh = (data.items || []).map((x) => ({ ...x, fresh: true }));
    state.freshUpdated = data.updated || "";
    state.freshSources = data.sources || [];
    state.linkCheck = data.links || {};
    renderPrograms();
  } catch { state.fresh = []; }
  renderFresh();
  updateCounts();
}

function renderFresh() {
  const el = $("#panel-fresh");
  if (!state.fresh.length) {
    el.innerHTML = empty("No new finds yet — the daily scraper fills this tab. Check back tomorrow.");
    return;
  }
  const ranked = rank(state.fresh);
  const newCount = ranked.filter((r) => isNew(r.item)).length;
  const when = state.freshUpdated ? new Date(state.freshUpdated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "recently";
  el.innerHTML = `
    <p class="panel-note">Collected automatically every day (last run ${esc(when)}). ${ranked.length} shown, <b>${newCount} new this week</b>.
      These aren't hand-checked — pay, location and eligibility are guessed from the listing, so read it before applying.</p>
    <div class="grid">${ranked.map((r) => card(r, { showWhy: state.hasRun })).join("") || empty("Nothing new passes these filters — try switching some back on.")}</div>
    <p class="credit">Sources: ${state.freshSources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.ok ? "" : " (didn't answer last run)"}`).join(", ")}.</p>`;
}

/* ==========================================================================
   Tab 3 — live jobs
   ========================================================================== */
async function loadLive() {
  state.liveTerms = pickTerms(profile, state.filters.fields);
  state.liveLoading = true;
  renderLive();
  const { jobs, errors } = await fetchLiveJobs(state.liveTerms, { hideSenior: state.filters.hideSenior });
  state.liveJobs = jobs;
  state.liveErrors = errors;
  state.liveLoading = false;
  renderLive();
  updateCounts();
}

function renderLive() {
  const el = $("#panel-live");
  if (state.liveLoading) {
    el.innerHTML = `<p class="panel-note">Searching Remotive, Jobicy and RemoteOK for “${esc(state.liveTerms.join("”, “"))}”…</p><div class="loading"></div>`;
    return;
  }
  if (!state.liveJobs.length && !state.liveErrors.length) {
    el.innerHTML = empty(`Press <b>Find opportunities</b> to pull live remote jobs.`);
    return;
  }
  const ranked = rank(state.liveJobs);
  const partTime = ranked.filter((r) => r.item.kind === "part-time" || r.item.kind === "contract" || r.item.kind === "internship");
  el.innerHTML = `
    <p class="panel-note">Live remote jobs open to US-based applicants, searched for
      <b>“${esc(state.liveTerms.join("”, “"))}”</b>. ${ranked.length} shown${partTime.length ? `, ${partTime.length} part-time / contract / internship` : ""}.
      All are paid. Change the words in the box above to search for something else.</p>
    ${state.liveErrors.length ? `<p class="warn">Some feeds didn't answer: ${esc(state.liveErrors.join("; "))}. Results from the others are below.</p>` : ""}
    <div class="grid">${ranked.map((r) => card(r)).join("") || empty("No live jobs passed the filters. Try different keywords or switch on more fields.")}</div>
    <p class="credit">Job data from <a href="https://remotive.com" target="_blank" rel="noopener">Remotive</a>,
      <a href="https://jobicy.com" target="_blank" rel="noopener">Jobicy</a> and
      <a href="https://remoteok.com" target="_blank" rel="noopener">Remote OK</a>. Remotive posts appear 24h after publishing.</p>`;
}

/* ==========================================================================
   Tab 4 — more places to search
   ========================================================================== */
function renderBoards() {
  // Build a search phrase from your prompt keywords or top skills.
  const words = profile.asked.keywords.length ? profile.asked.keywords.slice(0, 3)
    : profile.skills.slice(0, 2).map((s) => s.word);
  const q = encodeURIComponent(words.join(" ") || state.filters.fields.join(" "));
  const boards = BOARDS.filter((b) => b.fields.some((f) => state.filters.fields.includes(f)));
  $("#panel-boards").innerHTML = `
    <p class="panel-note">These sites don't share their listings, so each button opens a search on the site itself${words.length ? ` for <b>“${esc(words.join(" "))}”</b>` : ""}.</p>
    <div class="grid grid-boards">${boards.map((b) => `
      <article class="card board">
        <h3>${esc(b.name)}</h3>
        <p class="blurb">${esc(b.what)}</p>
        <div class="tags">${b.fields.map((f) => `<span class="tag tag-field tag-${f}">${FIELD_LABEL[f]}</span>`).join("")}</div>
        <div class="card-foot"><a class="btn btn-small" href="${esc(b.search(q))}" target="_blank" rel="noopener">Search ↗</a></div>
      </article>`).join("")}</div>`;
}

/* ==========================================================================
   Tab 4 — My list (tracker)
   ========================================================================== */
function renderSaved() {
  const rows = Object.entries(state.saved).sort((a, b) => b[1].savedAt - a[1].savedAt);
  if (!rows.length) {
    $("#panel-saved").innerHTML = empty("Click <b>☆ Save</b> on anything to start your list. It stays in this browser.");
    return;
  }
  $("#panel-saved").innerHTML = `
    <div class="saved-actions">
      <p class="panel-note">${rows.length} saved. Saved in this browser only — export a copy to keep it safe.</p>
      <button class="btn btn-small btn-ghost" id="export">Download as spreadsheet (CSV)</button>
    </div>
    <div class="saved-list">${rows.map(([id, s]) => {
      const t = s.item.live ? { label: "Live job" } : timingOf(s.item);
      return `
      <div class="saved-row" data-id="${esc(id)}">
        <div class="saved-main">
          <a href="${esc(s.item.url)}" target="_blank" rel="noopener"><b>${esc(s.item.title)}</b></a>
          <span class="org">${esc(s.item.org || "")} · ${esc(t.label)}</span>
        </div>
        <select data-status="${esc(id)}" aria-label="Status">${STATUSES.map((st) => `<option ${st === s.status ? "selected" : ""}>${st}</option>`).join("")}</select>
        <input data-note="${esc(id)}" value="${esc(s.note || "")}" placeholder="Notes (e.g. ask Prof. X for a reference)" aria-label="Notes">
        <button class="link" data-tailor="${esc(id)}">Tailor</button>
        <button class="icon-btn" data-remove="${esc(id)}" title="Remove" aria-label="Remove">✕</button>
      </div>`;
    }).join("")}</div>`;
}

function exportCsv() {
  const head = ["Title", "Organization", "Status", "Notes", "Pay", "Where", "Kind", "Deadline", "Link"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = Object.values(state.saved).map(({ item, status, note }) =>
    [item.title, item.org, status, note, item.payNote || item.pay, item.where, item.kind, item.deadline || item.cycle || "", item.url].map(cell).join(","));
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-opportunities.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ==========================================================================
   Profile chips — shows what the matcher understood
   ========================================================================== */
function renderProfile() {
  const el = $("#profile");
  if (!state.hasRun) { el.hidden = true; return; }
  el.hidden = false;
  const a = profile.asked;
  const asked = [
    ...a.fields.map((f) => FIELD_LABEL[f]),
    ...a.kinds.map((k) => KIND_LABEL[k]),
    a.remote && "Remote", a.paid && "Paid",
  ].filter(Boolean);
  const skills = profile.skills.slice(0, 14);
  el.innerHTML = `
    ${asked.length ? `<div class="chips-row"><span class="chips-label">You asked for</span>${asked.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : ""}
    ${skills.length ? `<div class="chips-row"><span class="chips-label">Skills we found</span>${skills.map((s) => `<span class="chip chip-${s.field}">${esc(s.word)}</span>`).join("")}</div>`
      : `<div class="chips-row"><span class="chips-label">Skills we found</span><span class="muted">None yet — add a resume or a few skills in the box for sharper matches.</span></div>`}
    ${a.keywords.length ? `<div class="chips-row"><span class="chips-label">Search words</span>${a.keywords.map((k) => `<span class="chip chip-plain">${esc(k)}</span>`).join("")}</div>` : ""}`;
}

/* ==========================================================================
   Filters bar — keep the controls in sync with state
   ========================================================================== */
function syncFilters() {
  const f = state.filters;
  $$("[data-field]").forEach((b) => b.setAttribute("aria-pressed", f.fields.includes(b.dataset.field)));
  $$("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.kind === "" ? f.kinds.length === 0 : f.kinds.includes(b.dataset.kind)));
  $("#f-remote").checked = f.remoteFriendly;
  $("#f-unpaid").checked = f.includeUnpaid;
  $("#f-closed").checked = f.hideClosed;
  $("#f-senior").checked = f.hideSenior;
  $("#f-sort").value = f.sort;
}

function updateCounts() {
  $("#count-programs").textContent = rank(OPPORTUNITIES).length;
  $("#count-live").textContent = state.liveJobs.length ? rank(state.liveJobs).length : "";
  $("#count-saved").textContent = Object.keys(state.saved).length || "";
  const freshNew = state.fresh.filter(isNew).length;
  $("#count-fresh").textContent = freshNew ? `${freshNew} new` : state.fresh.length || "";
}

function renderAll() {
  syncFilters();
  renderProfile();
  renderPrograms();
  renderLive();
  renderBoards();
  renderFresh();
  renderSaved();
  updateCounts();
  showTab(state.tab);
  persist();
}

function showTab(name) {
  state.tab = name;
  if (name === "tailor") refreshTailorResume();
  $$("[role=tab]").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === name));
  $$(".panel").forEach((p) => (p.hidden = p.id !== `panel-${name}`));
}

function empty(html) { return `<div class="empty">${html}</div>`; }

/* ==========================================================================
   runSearch — the big button
   ========================================================================== */
async function runSearch() {
  state.prompt = $("#prompt").value.trim();
  state.hasRun = true;
  refreshProfile();
  renderAll();
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  await loadLive();
  persist();
}

/* ==========================================================================
   Wire up all the buttons (runs once when the page loads)
   ========================================================================== */
function wire() {
  // Prompt + big button
  $("#prompt").value = state.prompt;
  $("#go").addEventListener("click", runSearch);
  $("#prompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runSearch();
  });
  $$("[data-example]").forEach((b) => b.addEventListener("click", () => {
    $("#prompt").value = b.dataset.example;
    runSearch();
  }));

  // Resume: file picker, drag & drop, or paste
  const showResume = () => {
    $("#resume-status").innerHTML = state.resumeText
      ? `✓ Using <b>${esc(state.resumeName || "pasted text")}</b> (${state.resumeText.split(/\s+/).length} words) · <button class="link" id="resume-clear">remove</button>`
      : "Stays on your computer — nothing is uploaded.";
    const clear = $("#resume-clear");
    if (clear) clear.addEventListener("click", () => { state.resumeText = ""; state.resumeName = ""; $("#resume-paste").value = ""; showResume(); persist(); });
  };
  const takeFile = async (file) => {
    if (!file) return;
    $("#resume-status").textContent = `Reading ${file.name}…`;
    try {
      state.resumeText = await readResume(file);
      state.resumeName = file.name;
      if (!state.resumeText.trim()) throw new Error("No text found — if it's a scanned image PDF, paste the text instead.");
    } catch (err) {
      state.resumeText = "";
      $("#resume-status").innerHTML = `<span class="warn-inline">${esc(err.message)}</span>`;
      return;
    }
    showResume();
    persist();
    refreshTailorResume();
  };
  $("#resume-file").addEventListener("change", (e) => takeFile(e.target.files[0]));
  const drop = $("#dropzone");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => takeFile(e.dataTransfer.files[0]));
  $("#resume-paste").addEventListener("input", (e) => {
    state.resumeText = e.target.value;
    state.resumeName = e.target.value ? "pasted text" : "";
    showResume();
    persist();
    refreshTailorResume();
  });
  showResume();

  // Filters
  $$("[data-field]").forEach((b) => b.addEventListener("click", () => {
    const f = state.filters.fields, v = b.dataset.field;
    state.filters.fields = f.includes(v) ? (f.length > 1 ? f.filter((x) => x !== v) : f) : [...f, v];
    renderAll();
  }));
  $$("[data-kind]").forEach((b) => b.addEventListener("click", () => {
    const k = state.filters.kinds, v = b.dataset.kind;
    state.filters.kinds = v === "" ? [] : k.includes(v) ? k.filter((x) => x !== v) : [...k, v];
    renderAll();
  }));
  $("#f-remote").addEventListener("change", (e) => { state.filters.remoteFriendly = e.target.checked; renderAll(); });
  $("#f-unpaid").addEventListener("change", (e) => { state.filters.includeUnpaid = e.target.checked; renderAll(); });
  $("#f-closed").addEventListener("change", (e) => { state.filters.hideClosed = e.target.checked; renderAll(); });
  $("#f-senior").addEventListener("change", (e) => { state.filters.hideSenior = e.target.checked; persist(); if (state.hasRun) loadLive(); });
  $("#f-sort").addEventListener("change", (e) => { state.filters.sort = e.target.value; renderAll(); });
  $("#f-reset").addEventListener("click", () => { state.filters = { ...DEFAULT_FILTERS }; renderAll(); });

  // Tabs
  $$("[role=tab]").forEach((t) => t.addEventListener("click", () => { showTab(t.dataset.tab); persist(); }));

  // Save buttons + tracker (one listener for the whole page — "event delegation")
  document.addEventListener("click", (e) => {
    const saveBtn = e.target.closest("[data-save]");
    if (saveBtn) {
      const id = saveBtn.dataset.save;
      if (state.saved[id]) delete state.saved[id];
      else {
        const item = findItem(id);
        if (item) state.saved[id] = { item, status: STATUSES[0], note: "", savedAt: Date.now() };
      }
      renderAll();
      return;
    }
    const tb = e.target.closest("[data-tailor]");
    if (tb) { const item = findItem(tb.dataset.tailor); if (item) tailorFor(item); return; }
    const rm = e.target.closest("[data-remove]");
    if (rm) { delete state.saved[rm.dataset.remove]; renderAll(); return; }
    if (e.target.id === "export") exportCsv();
  });
  document.addEventListener("change", (e) => {
    const id = e.target.dataset.status;
    if (id && state.saved[id]) { state.saved[id].status = e.target.value; persist(); }
  });
  document.addEventListener("input", (e) => {
    const id = e.target.dataset.note;
    if (id && state.saved[id]) { state.saved[id].note = e.target.value; persist(); }
  });

  $("#last-checked").textContent = new Date(LAST_CHECKED + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/* --------------------------------------------------------------------------
   Start!
   -------------------------------------------------------------------------- */
restore();
// On page load, keep the filters you left on last time (don't re-apply the prompt).
refreshProfile({ applyAsked: false });
wire();
initTailor({
  getResume: () => ({ text: state.resumeText, name: state.resumeName }),
  setResume: (text) => { state.resumeText = text; if (!state.resumeName) state.resumeName = "edited text"; persist(); },
  getSaved: () => state.saved,
  showTab: (name) => { showTab(name); persist(); },
});
renderAll();
loadFresh();
if (state.hasRun) loadLive();
