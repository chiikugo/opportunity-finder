/* ==========================================================================
   app.js — the "glue": reads what you type / upload, runs the matcher,
   applies the filters, and draws the cards on the page.
   --------------------------------------------------------------------------
   THE STRICT RULE
   The page only shows listings that passed TODAY's checks by the daily
   scraper (scripts/scrape.mjs → data/fresh.json): a real application page
   that's live and open, no scam red flags, and no one calling the org a
   scam on Reddit / Hacker News. Closed, expired, "next round" or
   unverifiable = not shown. If today's file can't load, nothing is shown.

   MAP OF THIS FILE
     state ............ everything the page remembers (filters, saved list…)
     save/load ........ keeps that in your browser between visits
     loadVerified() ... reads data/fresh.json (today's verified listings)
     runSearch() ...... the "Find opportunities" button
     renderPrograms() . tab 1: hand-picked programs that are open today
     renderCalls() .... tab 2: open calls, fellowships & residencies
     renderJobs() ..... tab 3: remote jobs
     renderBoards() ... tab 4: more places to search (links, not listings)
     renderSaved() .... "My list": your saved items / application tracker
     (the Tailor resume tab lives in js/tailor-ui.js)
     card() ........... the HTML for one opportunity card

   I WANT TO…                                  → EDIT
     add/fix a hand-picked program              → js/data/opportunities.js
     add a job site to "More places to search"  → js/data/boards.js
     make the matcher smarter                   → js/match.js (SKILLS, WEIGHTS)
     change colours / fonts                     → styles.css (top section)
     change default filters                     → DEFAULT_FILTERS below
     change sources or strictness               → scripts/scrape.mjs, scripts/lib/verify.mjs
     change how resume tailoring works          → js/tailor.js
   ========================================================================== */

import { OPPORTUNITIES } from "./data/opportunities.js";
import { BOARDS } from "./data/boards.js";
import { buildProfile, scoreItem } from "./match.js";
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
  saved: {},                 // { id: { item, status, note, savedAt } }
  hasRun: false,
  // from data/fresh.json (today's verified listings)
  loaded: null,              // null = loading, true = ok, false = couldn't load
  updated: "",               // when the scraper last ran
  sources: [],               // [{ name, url, ok, count }]
  programStatus: {},         // { programId: { open, reason, listings, deadline } }
  calls: [],                 // verified open calls / fellowships / residencies
  jobs: [],                  // verified open remote jobs
  removed: { counts: {}, flagged: [] },
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
    const tab = ["fresh", "live"].includes(s.tab) ? "programs" : s.tab; // old tab names
    Object.assign(state, s, { tab, filters: { ...DEFAULT_FILTERS, ...(s.filters || {}) } });
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
  "part-time": "Part-time", volunteer: "Volunteer", job: "Job", contract: "Contract", call: "Open call",
};
const PAY_LABEL = { paid: "Paid", stipend: "Stipend / award", unpaid: "Unpaid", unknown: "Pay: see listing" };
const WHERE_LABEL = { remote: "Remote", hybrid: "Remote option", onsite: "On-site", unknown: "Location: see listing" };
// Listings count as "new" for this many days after the scraper first finds them.
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
   Today's verified listings (data/fresh.json, written by the daily scraper)
   ========================================================================== */
async function loadVerified() {
  try {
    const res = await fetch("data/fresh.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.updated = data.updated || "";
    state.sources = data.sources || [];
    state.programStatus = data.programs || {};
    state.removed = data.removed || { counts: {}, flagged: [] };
    const items = (data.items || []).map((x) => ({ ...x, scraped: true }));
    state.calls = items.filter((x) => x.rep === "call");
    state.jobs = items.filter((x) => x.rep === "job");
    state.loaded = true;
  } catch {
    state.loaded = false;
  }
  renderAll();
}

/** The hand-picked programs that are open TODAY, pointed at their live listing. */
function openPrograms() {
  return OPPORTUNITIES.filter((p) => state.programStatus[p.id]?.open).map((p) => {
    const st = state.programStatus[p.id];
    return {
      ...p,
      url: st.listings?.[0]?.url || p.url,
      listings: st.listings || [],
      deadline: st.deadline || p.deadline,
      verifyNote: st.reason,
    };
  });
}

/** Is this saved item still open today? */
function stillOpen(id) {
  return !!state.programStatus[id]?.open || state.calls.some((c) => c.id === id) || state.jobs.some((j) => j.id === id);
}

/* ==========================================================================
   Filtering — the rules every card has to pass
   ========================================================================== */
function passes(item) {
  const f = state.filters;
  // field: at least one of the item's fields is switched on
  if (!item.fields.some((x) => f.fields.includes(x))) return false;
  // kind. Jobs are all "jobs", so the Type filter only touches them when you
  // picked Part-time (then: part-time + contract posts only).
  if (item.rep === "job") {
    if (f.kinds.includes("part-time") && item.kind !== "part-time" && item.kind !== "contract") return false;
  } else if (f.kinds.length && !f.kinds.includes(item.kind)) return false;
  // remote-friendly
  if (f.remoteFriendly && item.where === "onsite") return false;
  // YOUR RULE: tech must be paid. An unpaid item that is ONLY tech is never shown.
  if (item.pay === "unpaid" && item.fields.every((x) => x === "tech")) return false;
  // unpaid art / fashion / research — optional
  if (item.pay === "unpaid" && !f.includeUnpaid) return false;
  return true;
}

/** Everything shown is open today, so timing is just "how long you have". */
function timingOf(item) {
  if (item.rep === "job") return { state: "rolling", label: "Hiring · posted " + ago(item.date) };
  if (item.deadline) {
    const days = Math.ceil((new Date(item.deadline + "T23:59:00") - new Date(new Date().toDateString())) / 864e5);
    return { state: "open", label: days <= 0 ? "Closes today" : `Open · closes in ${days} day${days === 1 ? "" : "s"}`, days };
  }
  if (item.rolling) return { state: "rolling", label: "Open · apply any time" };
  return { state: "open", label: "Open now" };
}

/** Score + filter + sort a list. Returns [{ item, timing, score, reasons }]. */
function rank(list) {
  const out = [];
  for (const item of list) {
    if (!passes(item)) continue;
    const timing = timingOf(item);
    const { score, reasons } = scoreItem(item, profile, timing);
    out.push({ item, timing, score, reasons });
  }
  if (state.filters.sort === "deadline") out.sort((a, b) => ((a.timing.days ?? 999) - (b.timing.days ?? 999)) || (b.score - a.score));
  else out.sort((a, b) => b.score - a.score);
  return out;
}

function isNew(item) {
  return item.scraped && item.firstSeen && (Date.now() - new Date(item.firstSeen).getTime()) / 864e5 <= NEW_DAYS;
}

/** Find any opportunity by id, wherever it came from. */
function findItem(id) {
  return openPrograms().find((o) => o.id === id) || state.calls.find((c) => c.id === id)
    || state.jobs.find((j) => j.id === id) || state.saved[id]?.item;
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
  const checks = [item.verifyNote, item.repNote].filter(Boolean);
  return `
  <article class="card" data-id="${esc(item.id)}">
    <div class="card-top">
      <span class="timing timing-${timing.state}">${isNew(item) ? `<span class="new">New</span> ` : ""}${esc(timing.label)}</span>
      <button class="save ${saved ? "is-saved" : ""}" data-save="${esc(item.id)}" aria-pressed="${saved}"
        title="${saved ? "Remove from My list" : "Save to My list"}">${saved ? "★ Saved" : "☆ Save"}</button>
    </div>
    <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
    <p class="org">${esc(item.org || "")}</p>
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
      ${item.deadline ? `<div><dt>Deadline</dt><dd>${esc(new Date(item.deadline + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}</dd></div>` : ""}
    </dl>
    ${item.listings && item.listings.length > 1 ? `<div class="listings"><b>Open listings:</b>${item.listings.map((l) =>
      `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}${l.location ? ` <span class="muted">· ${esc(l.location)}</span>` : ""}</a>`).join("")}</div>` : ""}
    ${checks.length ? `<p class="verified" title="Checked by the daily scraper">✓ Checked today: ${esc(checks.join(" · "))}</p>` : ""}
    ${showWhy && reasons && reasons.length ? `<p class="why"><b>Why it fits:</b> ${esc(reasons.join(" · "))}</p>` : ""}
    <div class="card-foot">
      <span class="foot-btns">
        <a class="btn btn-small" href="${esc(item.url)}" target="_blank" rel="noopener">Apply / view listing ↗</a>
        <button class="btn btn-small btn-ghost" data-tailor="${esc(item.id)}" title="Match your resume to this">Tailor resume</button>
      </span>
      ${item.scraped ? `<span class="via">via <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">${esc(item.source)}</a></span>` : ""}
    </div>
  </article>`;
}

/** Shared top note + empty / failed states for the three listing tabs. */
function listingPanel(ranked, { what, emptyMsg, extra = "", how = "live application page, no scam red flags, no scam reports" }) {
  if (state.loaded === null) return `<div class="loading"></div>`;
  if (state.loaded === false) return empty("Couldn't load today's verified listings, so nothing is shown (we never show unchecked listings). Try refreshing the page.");
  const when = state.updated ? new Date(state.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "recently";
  return `
    <p class="panel-note">${ranked.length} ${what}, all verified open on ${esc(when)} — ${how}.${extra}</p>
    <div class="grid">${ranked.map((r) => card(r, { showWhy: state.hasRun })).join("") || empty(emptyMsg)}</div>`;
}

/** "What we filtered out today" — so nothing disappears silently. */
function removedNote() {
  const c = state.removed.counts || {};
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (!total) return "";
  const rows = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([why, n]) => `<li>${n} × ${esc(why)}</li>`).join("");
  const flagged = (state.removed.flagged || []).slice(0, 15)
    .map((f) => `<li><b>${esc(f.title)}</b>${f.org ? ` (${esc(f.org)})` : ""} — ${esc(f.why)}</li>`).join("");
  return `<details class="removed"><summary>What today's check filtered out (${total})</summary>
    <ul>${rows}</ul>${flagged ? `<p class="small"><b>Flagged as scams or pay-to-apply:</b></p><ul>${flagged}</ul>` : ""}</details>`;
}

/* ==========================================================================
   Tab 1 — hand-picked programs (only the ones open today)
   ========================================================================== */
function renderPrograms() {
  const ranked = rank(openPrograms());
  const closed = OPPORTUNITIES.length - openPrograms().length;
  $("#panel-programs").innerHTML = listingPanel(ranked, {
    what: "hand-picked programs open right now",
    how: "each checked on its official site or jobs board",
    emptyMsg: "None of the hand-picked programs are open today and pass these filters. Check Open calls and Remote jobs.",
    extra: closed ? ` ${closed} other hand-picked programs are closed or can't be verified today, so they're hidden until they open.` : "",
  });
}

/* ==========================================================================
   Tab 2 — open calls, fellowships & residencies (scraped + verified daily)
   ========================================================================== */
function renderCalls() {
  $("#panel-calls").innerHTML = listingPanel(rank(state.calls), {
    what: "open calls, fellowships, grants and residencies",
    emptyMsg: "Nothing open passes these filters right now — try switching some back on.",
  }) + (state.loaded ? removedNote() + sourcesNote() : "");
}

/* ==========================================================================
   Tab 3 — remote jobs (scraped + verified daily)
   ========================================================================== */
function renderJobs() {
  const ranked = rank(state.jobs);
  const pt = ranked.filter((r) => ["part-time", "contract", "internship"].includes(r.item.kind)).length;
  $("#panel-jobs").innerHTML = listingPanel(ranked, {
    what: "remote jobs open to US applicants",
    emptyMsg: "No jobs pass these filters right now — try switching some fields back on.",
    extra: pt ? ` ${pt} are part-time, contract or internships (use Type → Part-time).` : "",
  }) + (state.loaded ? sourcesNote() : "");
}

function sourcesNote() {
  return `<p class="credit">Sources: ${state.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.ok ? "" : " (didn't answer last run)"}`).join(", ")}.
    Scam cross-check: Reddit via <a href="https://arctic-shift.photon-reddit.com/" target="_blank" rel="noopener">Arctic Shift</a> and Hacker News search.</p>`;
}

/* ==========================================================================
   Tab 4 — more places to search (links, not listings)
   ========================================================================== */
function renderBoards() {
  // Build a search phrase from your prompt keywords or top skills.
  const words = profile.asked.keywords.length ? profile.asked.keywords.slice(0, 3)
    : profile.skills.slice(0, 2).map((s) => s.word);
  const q = encodeURIComponent(words.join(" ") || state.filters.fields.join(" "));
  const boards = BOARDS.filter((b) => b.fields.some((f) => state.filters.fields.includes(f)));
  $("#panel-boards").innerHTML = `
    <p class="panel-note">These are search links, not listings — we can't verify what these sites show, so check each posting yourself.
      Each button opens a search on the site${words.length ? ` for <b>“${esc(words.join(" "))}”</b>` : ""}.</p>
    <div class="grid grid-boards">${boards.map((b) => `
      <article class="card board">
        <h3>${esc(b.name)}</h3>
        <p class="blurb">${esc(b.what)}</p>
        <div class="tags">${b.fields.map((f) => `<span class="tag tag-field tag-${f}">${FIELD_LABEL[f]}</span>`).join("")}</div>
        <div class="card-foot"><a class="btn btn-small" href="${esc(b.search(q))}" target="_blank" rel="noopener">Search ↗</a></div>
      </article>`).join("")}</div>`;
}

/* ==========================================================================
   My list (tracker)
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
      const open = state.loaded ? stillOpen(id) : true;
      return `
      <div class="saved-row ${open ? "" : "is-closed"}" data-id="${esc(id)}">
        <div class="saved-main">
          <a href="${esc(s.item.url)}" target="_blank" rel="noopener"><b>${esc(s.item.title)}</b></a>
          <span class="org">${esc(s.item.org || "")} · ${open ? "Open today" : "<b>No longer open</b> (closed or failed today's check)"}</span>
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
    [item.title, item.org, status, note, item.payNote || item.pay, item.where, item.kind, item.deadline || "", item.url].map(cell).join(","));
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
  $("#f-sort").value = f.sort;
}

function updateCounts() {
  const n = (list) => (state.loaded ? rank(list).length : "");
  $("#count-programs").textContent = n(openPrograms());
  $("#count-calls").textContent = n(state.calls);
  $("#count-jobs").textContent = n(state.jobs);
  $("#count-saved").textContent = Object.keys(state.saved).length || "";
}

function renderAll() {
  syncFilters();
  renderProfile();
  renderPrograms();
  renderCalls();
  renderJobs();
  renderBoards();
  renderSaved();
  updateCounts();
  showTab(state.tab);
  persist();
}

function showTab(name) {
  if (!$(`#panel-${name}`)) name = "programs";
  state.tab = name;
  if (name === "tailor") refreshTailorResume();
  $$("[role=tab]").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === name));
  $$(".panel").forEach((p) => (p.hidden = p.id !== `panel-${name}`));
}

function empty(html) { return `<div class="empty">${html}</div>`; }

/* ==========================================================================
   runSearch — the big button
   ========================================================================== */
function runSearch() {
  state.prompt = $("#prompt").value.trim();
  state.hasRun = true;
  refreshProfile();
  renderAll();
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
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
loadVerified();
