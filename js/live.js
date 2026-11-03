/* ==========================================================================
   live.js — pulls REAL, current remote job posts from free public job APIs
   (Remotive, Jobicy, RemoteOK) straight into your browser.
   --------------------------------------------------------------------------
   HOW IT WORKS
   1. We pick up to 3 search words from your profile (your top skills or
      the keywords in your prompt).
   2. We ask each job site for matching remote jobs.
   3. We tidy every post into the same shape as the curated opportunities
      (title, org, url, pay, where, kind, fields, tags…) so the same
      matcher and cards can show them.
   4. We drop roles that aren't open to US-based people and (by default)
      senior / director-level roles, since you're early-career.

   THE RULES OF THESE FREE APIS (please keep them!)
   - Every card must credit the source site and link to its original post.
     (The card footer does this: "via Remotive" etc.)
   - Don't hammer them: results are cached in your browser for CACHE_HOURS.

   👉 To add another feed: write a fetchX(term) function that returns an
      array of tidy jobs (see toJob below), and add it to FEEDS.
   ========================================================================== */

import { buildProfile } from "./match.js";

// How long to reuse results before asking the job sites again.
// Remotive asks for at most ~4 requests a day, so keep this ≥ 6.
const CACHE_HOURS = 6;

// Words in a job title that usually mean "not entry-level".
// 👉 Remove a word here if you want to see those roles too.
const SENIOR_WORDS = /\b(senior|sr\.?|lead|principal|staff|director|head of|vp|vice president|chief|manager ii|architect)\b/i;

// Location text that means US-based people can apply.
const US_OK = /(usa|united states|\bus\b|u\.s\.|americas|north america|worldwide|anywhere|global|remote)/i;

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */

/** Strip HTML tags from a job description and shorten it. */
function plain(html, max = 240) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  const t = (div.textContent || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).replace(/\s\S*$/, "") + "…" : t;
}

/** Full description as plain text WITH line breaks (the Tailor tab uses
    the lines to tell requirements from nice-to-haves). Capped at ~8,000 chars. */
function plainLines(html) {
  const withBreaks = String(html || "").replace(/<\s*(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n").replace(/<\s*li[^>]*>/gi, "\n• ");
  const div = document.createElement("div");
  div.innerHTML = withBreaks;
  return (div.textContent || "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, 8000);
}

/** Read/write the browser cache. Wrapped in try/catch because private
    windows can block storage — the app still works, just without caching. */
function cacheGet(key) {
  try {
    const raw = localStorage.getItem("of-live2:" + key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    return Date.now() - at < CACHE_HOURS * 3600e3 ? data : null;
  } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem("of-live2:" + key, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
}

/** fetch() with a timeout so one slow site doesn't freeze everything. */
async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/** Build one tidy job object — the same shape the cards expect. */
function toJob({ id, title, org, url, source, sourceUrl, blurb, fullText, tags, type, location, salary, date }) {
  const typeText = String(type || "").toLowerCase();
  const kind = /part/.test(typeText) ? "part-time"
    : /intern/.test(typeText) ? "internship"
    : /contract|freelance/.test(typeText) ? "contract"
    : "job";
  // Guess which of your four fields this job belongs to by running the
  // same skill-finder over its title + tags + description.
  const mix = buildProfile(`${title} ${(tags || []).join(" ")} ${blurb}`, "").fieldMix;
  const fields = Object.keys(mix).filter((f) => mix[f] > 0);
  return {
    id: `${source}-${id}`, title, org, url, source, sourceUrl,
    blurb, fullText: fullText || "", tags: (tags || []).map((t) => String(t).toLowerCase()).slice(0, 12),
    kind, jobType: type || "", location: location || "Remote",
    payNote: salary || "", pay: "paid", where: "remote",
    fields: fields.length ? fields : ["tech"], date: date || "",
    live: true,
  };
}

/* --------------------------------------------------------------------------
   The feeds. Each takes one search term and returns tidy jobs.
   -------------------------------------------------------------------------- */

async function fetchRemotive(term) {
  const data = await getJSON(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=40`);
  return (data.jobs || [])
    .filter((j) => US_OK.test(j.candidate_required_location || "worldwide"))
    .map((j) => toJob({
      id: j.id, title: j.title, org: j.company_name, url: j.url,
      source: "Remotive", sourceUrl: "https://remotive.com",
      blurb: plain(j.description), fullText: plainLines(j.description), tags: j.tags, type: (j.job_type || "").replace("_", "-"),
      location: j.candidate_required_location, salary: j.salary, date: j.publication_date,
    }));
}

async function fetchJobicy(term) {
  const tag = encodeURIComponent(term);
  const data = await getJSON(`https://jobicy.com/api/v2/remote-jobs?count=40&geo=usa&tag=${tag}`);
  return (data.jobs || []).map((j) => toJob({
    id: j.id, title: j.jobTitle, org: j.companyName, url: j.url,
    source: "Jobicy", sourceUrl: "https://jobicy.com",
    blurb: plain(j.jobExcerpt || j.jobDescription), fullText: plainLines(j.jobDescription),
    tags: [].concat(j.jobIndustry || []),
    type: [].concat(j.jobType || []).join(", "),
    location: j.jobGeo,
    salary: j.annualSalaryMin ? `$${Number(j.annualSalaryMin).toLocaleString()}–$${Number(j.annualSalaryMax || j.annualSalaryMin).toLocaleString()} / yr` : "",
    date: j.pubDate,
  }));
}

// RemoteOK has no search box; we grab its ~100 latest posts once and let
// the matcher sort them. `term` is only used to pick a tag.
async function fetchRemoteOK(term) {
  const data = await getJSON(`https://remoteok.com/api?tag=${encodeURIComponent(term.split(" ")[0])}`);
  return (Array.isArray(data) ? data.slice(1) : []) // first item is the legal notice
    .filter((j) => j.position && US_OK.test(j.location || "worldwide"))
    .map((j) => toJob({
      id: j.id, title: j.position, org: j.company, url: j.url,
      source: "RemoteOK", sourceUrl: "https://remoteok.com",
      blurb: plain(j.description), fullText: plainLines(j.description), tags: j.tags,
      type: /part[- ]?time/i.test(`${j.position} ${(j.tags || []).join(" ")}`) ? "part-time" : "",
      location: j.location,
      salary: j.salary_min ? `$${Number(j.salary_min).toLocaleString()}–$${Number(j.salary_max || j.salary_min).toLocaleString()} / yr` : "",
      date: j.date,
    }));
}

const FEEDS = [
  { name: "Remotive", run: fetchRemotive },
  { name: "Jobicy", run: fetchJobicy },
  { name: "RemoteOK", run: fetchRemoteOK },
];

/* ==========================================================================
   pickTerms — choose up to 3 search words from your profile.
   Prompt keywords win; otherwise your strongest resume skills; otherwise
   a sensible default for the fields you picked.
   ========================================================================== */
const DEFAULT_TERMS = { tech: "developer", art: "design", fashion: "fashion", research: "research" };

// Resume skills that make good job-board searches. Niche ones (e.g. "p5.js")
// return almost nothing, so they're skipped for live search but still
// used for matching. 👉 Add a skill here to let it drive live searches.
const SEARCHABLE = new Set([
  "python", "javascript", "react", "web development", "data", "ux", "figma", "ai", "machine learning",
  "design", "illustration", "photography", "video", "3d", "writing", "teaching", "social media",
  "fashion", "fashion design", "styling", "merchandising", "textiles", "research", "user research",
  "curatorial", "museum", "product", "games", "sql",
]);

export function pickTerms(profile, activeFields) {
  const terms = [];
  for (const k of profile.asked.keywords) if (terms.length < 2) terms.push(k);
  for (const s of profile.skills) {
    if (terms.length >= 3) break;
    if (!terms.includes(s.word) && SEARCHABLE.has(s.word)) terms.push(s.word);
  }
  for (const f of activeFields) {
    if (terms.length >= 3) break;
    if (!terms.includes(DEFAULT_TERMS[f])) terms.push(DEFAULT_TERMS[f]);
  }
  return terms.slice(0, 3);
}

/* ==========================================================================
   fetchLiveJobs — the main entry point used by app.js.
   Returns { jobs, errors } — errors lists any feeds that failed, so the
   page can say "RemoteOK didn't answer" instead of silently showing less.
   ========================================================================== */
export async function fetchLiveJobs(terms, { hideSenior = true } = {}) {
  const errors = [];
  const tasks = [];
  for (const feed of FEEDS) {
    for (const term of terms) {
      // RemoteOK returns the same latest-100 list for most tags — one call is enough.
      if (feed.name === "RemoteOK" && term !== terms[0]) continue;
      const key = `${feed.name}:${term}`;
      const cached = cacheGet(key);
      if (cached) { tasks.push(Promise.resolve(cached)); continue; }
      tasks.push(
        feed.run(term)
          .then((jobs) => { cacheSet(key, jobs); return jobs; })
          .catch((err) => { errors.push(`${feed.name} (“${term}”): ${err.message || err}`); return []; })
      );
    }
  }
  const all = (await Promise.all(tasks)).flat();

  // de-duplicate (same title + company from two feeds)
  const seen = new Set();
  const jobs = all.filter((j) => {
    const k = `${j.title}|${j.org}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return !(hideSenior && SENIOR_WORDS.test(j.title));
  });
  return { jobs, errors };
}
