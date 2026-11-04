/* ==========================================================================
   scrape.mjs — the daily collector + verifier. It decides EVERYTHING the
   site shows: only real, open, scam-checked listings make it through.
   --------------------------------------------------------------------------
   WHO RUNS IT?
   GitHub, for free, every morning (.github/workflows/refresh.yml). You can
   also run it yourself:   node scripts/scrape.mjs

   WHAT IT DOES
   A. Hand-picked programs (js/data/opportunities.js) — runs each one's
      `check` and marks it open/closed for TODAY. Closed = hidden.
   B. Calls & fellowships from news/opportunity feeds — keeps only posts
      that link to a real application page, then visits that page to
      confirm it's live and open (see scripts/lib/verify.mjs).
   C. Remote jobs from job APIs — keeps recent, relevant, non-senior roles
      open to US applicants.
   D. Scam screening for B + C — red-flag wording, pay-to-apply fees, your
      blocklist, and a Reddit / Hacker News cross-check of each org.
   E. Writes data/fresh.json (what the site shows) and data/reputation.json
      (cached scam-check answers, so each org is searched once a month).

   Every listing is re-verified every day. If a page closes, it disappears.

   I WANT TO…                                  → EDIT
     add a feed                                 → FEEDS
     add/remove a job source                    → fetchJobs()
     change which jobs count as relevant        → RELEVANT_ROLE / SENIOR
     block an org forever                       → data/blocklist.json
     change the strictness rules                → scripts/lib/verify.mjs
   ========================================================================== */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildProfile } from "../js/match.js";
import { OPPORTUNITIES } from "../js/data/opportunities.js";
import {
  UA, sleep, todayStr, decode, strip, fetchPage, getJSON, hostOf, isRoundup, findApplyLink,
  CLOSED, OPEN, findDeadline, scamFlags, chargesFee, checkReputation, orgName, checkProgram,
} from "./lib/verify.mjs";

const DATA = new URL("../data/", import.meta.url);
const KEEP_DAYS = 60;              // stop re-checking a call this long after we first saw it
const JOB_MAX_AGE_DAYS = 30;       // jobs older than this are probably filled
// Time we spend on Reddit/HN checks per run. The free archive is slow and
// asks us to slow down, so we pace ourselves and continue next run.
const REP_BUDGET_MIN = Number(process.env.REP_BUDGET_MIN || 30);
const REP_FRESH_DAYS = 30;         // re-check an org's reputation after this many days
const today = todayStr();
const log = (...a) => console.log(...a);

/* --------------------------------------------------------------------------
   FEEDS — sources of calls, fellowships, residencies and some jobs.
   fields: fallback fields; keep(post): quick first filter by title/text.
   -------------------------------------------------------------------------- */
const FEEDS = [
  { name: "NYU ITP / IMA opportunities", site: "https://itp.nyu.edu/opportunities/", url: "https://itp.nyu.edu/opportunities/feed/", fields: ["art", "tech"], keep: () => true },
  { name: "Hyperallergic opportunities", site: "https://hyperallergic.com/tag/opportunities/", url: "https://hyperallergic.com/tag/opportunities/feed/", fields: ["art"], keep: () => true },
  { name: "AAPG artist opportunities", site: "https://www.aapgh.org/artist-opportunities", url: "https://www.aapgh.org/artist-opportunities?format=rss", fields: ["art"],
    keep: (it) => /fellowship|grant|residenc|award|prize|national|open call|foundation|museum|online|virtual|remote/i.test(it.title + " " + it.text) },
  { name: "Opportunity Desk", site: "https://opportunitydesk.org/", url: "https://opportunitydesk.org/feed/", fields: ["research"],
    keep: (it) => it.cats.some((c) => /america|united states|global|international|worldwide/i.test(c)) && fieldScore(`${it.title} ${it.text}`) >= 2 },
  { name: "Surface Design Association", site: "https://www.surfacedesign.org/", url: "https://www.surfacedesign.org/feed/", fields: ["fashion", "art"],
    keep: (it) => /call|submission|grant|award|residenc|fellowship|deadline|apply/i.test(it.title + " " + it.cats.join(" ")) },
  { name: "Fashionista", site: "https://fashionista.com/", url: "https://www.fashionista.com/.rss/full/", fields: ["fashion"],
    keep: (it) => /fellowship|grant|award|prize|competition|open call|accepting applications|applications? (are )?(now )?open|incubator|accelerator/i.test(it.title) },
  { name: "ProFellow", site: "https://www.profellow.com/", url: "https://www.profellow.com/feed/", fields: ["research"], keep: () => true },
];

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? m[1] : ""; };
function parseRss(xml) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const html = decode(tag(it, "content:encoded") || tag(it, "description"));
    return {
      title: strip(tag(it, "title")),
      link: strip(tag(it, "link")) || strip(tag(it, "guid")),
      date: new Date(strip(tag(it, "pubDate")) || Date.now()).toISOString(),
      html, text: strip(html).slice(0, 5000),
      cats: [...it.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map((m) => strip(m[1])),
    };
  });
}
function idOf(url) {
  let h = 5381;
  for (const c of url) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return "f-" + h.toString(36);
}
const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;
function fieldScore(text) { const m = buildProfile(text, "").fieldMix; return m.tech + m.art + m.fashion + m.research; }

/* Fashion only when the text is clearly about fashion (the site's skill list
   ties a few general words like "marketing" to fashion). */
const FASHION_WORDS = /fashion|apparel|clothing|textile|garment|costume|styling|stylist|runway|sewing|knitwear|footwear|couture|menswear|womenswear|wardrobe/i;
function fieldsFor(text, fallback) {
  const mix = buildProfile(text, "").fieldMix;
  const f = Object.keys(mix).filter((k) => mix[k] > 0 && (k !== "fashion" || FASHION_WORDS.test(text)));
  return f.length ? f : fallback;
}
function guessKind(t) {
  if (/^INTERN:|\bintern(ship)?s?\b/i.test(t)) return "internship";
  if (/residenc/i.test(t)) return "residency";
  if (/fellowship/i.test(t)) return "fellowship";
  if (/\b(grants?|award|prize|fund(ing)?|commission)\b/i.test(t)) return "grant";
  if (/part[- ]time/i.test(t)) return "part-time";
  if (/volunteer/i.test(t)) return "volunteer";
  if (/^JOB:|\b(hiring|position|assistant|coordinator|associate|manager|designer|engineer|developer)\b/i.test(t)) return "job";
  return "call";
}
function guessPay(t, kind) {
  if (/\bunpaid\b|\bvolunteer\b|no compensation/i.test(t)) return "unpaid";
  if (/\$\s?\d|€\s?\d|£\s?\d|\bstipend|honorari|\bpaid\b|salary|compensat|per hour|\/hr|fully funded|funding of|award of|grants? of/i.test(t)) {
    return ["fellowship", "residency", "grant", "call"].includes(kind) ? "stipend" : "paid";
  }
  return kind === "grant" ? "stipend" : "unknown";
}
function guessWhere(t) {
  if (/\bhybrid\b/i.test(t)) return "hybrid";
  if (/\bremote\b|\bonline\b|\bvirtual\b|work from home|from anywhere/i.test(t)) return "remote";
  return "unknown";
}

/* ==========================================================================
   B. Calls from feeds → candidates (verified later)
   ========================================================================== */
async function fetchFeeds(sources, drop) {
  const out = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const posts = parseRss(await res.text()).filter(feed.keep);
      let n = 0;
      for (const it of posts) {
        if (isRoundup(it.title)) { drop(it, "news round-up, not a listing"); continue; }
        const apply = findApplyLink(it.html, hostOf(feed.site));
        if (!apply) { drop(it, "no link to an actual application"); continue; }
        const kind = guessKind(`${it.title} ${it.cats.join(" ")}`);
        const all = `${it.title} ${it.cats.join(" ")} ${it.text}`;
        out.push({
          id: idOf(apply),
          title: it.title.replace(/^(JOB|CALL|INTERN):\s*/i, "").replace(/\s*\((due|deadline)[^)]*\)\s*$/i, "").trim(),
          org: "", url: apply,
          source: feed.name, sourceUrl: feed.site,
          kind, fields: fieldsFor(all, feed.fields),
          pay: guessPay(all, kind), where: guessWhere(all),
          deadline: findDeadline(`${it.title} ${it.text}`, it.date),
          date: it.date,
          blurb: it.text.slice(0, 260).replace(/\s\S*$/, "") + (it.text.length > 260 ? "…" : ""),
          fullText: it.text.slice(0, 3000),
          tags: buildProfile(all, "").skills.slice(0, 10).map((s) => s.word),
          rep: "call",
        });
        n++;
      }
      sources.push({ name: feed.name, url: feed.site, ok: true, count: n });
    } catch (err) {
      sources.push({ name: feed.name, url: feed.site, ok: false, count: 0, error: String(err.message || err) });
    }
  }
  return out;
}

/** Visit a call's application page and decide: open (returns null), or why not. */
async function verifyCall(item) {
  const page = await fetchPage(item.url);
  if (page.status === 0 || page.status === 404 || page.status === 410 || page.status >= 500) return `application page is dead (${page.status || "no answer"})`;
  const blocked = page.status === 401 || page.status === 403 || page.status === 429;
  const text = page.text;
  if (!blocked && CLOSED.test(text)) return "application page says it's closed";
  const deadline = item.deadline || (!blocked && findDeadline(text, item.date)) || null;
  if (deadline && deadline < today) return `deadline passed (${deadline})`;
  item.deadline = deadline;
  if (blocked) {
    // the site blocks robots: only keep it with a future deadline from a recent post
    if (deadline && daysSince(item.date) <= 30) { item.verifyNote = "site blocks automated checks — open per its posted deadline"; return null; }
    return "page blocks automated checks and has no future deadline we can confirm";
  }
  if (deadline) { item.verifyNote = `application page is live; open until ${deadline}`; return null; }
  if (OPEN.test(text) && daysSince(item.date) <= 45) { item.verifyNote = "application page is live and says it's open"; return null; }
  return "no sign on the page that it's open";
}

/* ==========================================================================
   C. Remote jobs from job APIs (+ SimplifyJobs' new-grad list)
   ========================================================================== */
// Roles that fit tech / art / fashion / research. 👉 Add words to widen.
const RELEVANT_ROLE = /(design|designer|ux|ui\b|illustrat|artist|\bart\b|creative|content|writer|writing|editor|editorial|copy|research|curat|museum|archiv|librar|fashion|textile|apparel|stylist|photograph|video|motion|animation|3d|developer|engineer|software|frontend|front-end|full[- ]stack|data|analyst|product|social media|community|education|teach|tutor|instructor|program (coordinator|assistant))/i;
// Titles that usually aren't entry level. 👉 Remove words to see more.
const SENIOR = /\b(senior|sr\.?|lead|principal|staff|director|head of|vp|vice president|chief|architect|manager ii|iii|iv)\b/i;
const US_OK = /(usa|united states|\bus\b|u\.s\.|americas|north america|worldwide|anywhere|global)/i;

const htmlLines = (html) => decode(String(html || "").replace(/<\s*(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n").replace(/<\s*li[^>]*>/gi, "\n• "))
  .replace(/<[^>]+>/g, " ").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
const money = (min, max) => (min ? `$${Number(min).toLocaleString()}–$${Number(max || min).toLocaleString()} / yr` : "");

function jobItem(o) {
  const all = `${o.title} ${(o.tags || []).join(" ")} ${o.text || ""}`;
  return {
    id: idOf(o.url), title: o.title, org: o.org, url: o.url,
    source: o.source, sourceUrl: o.sourceUrl,
    kind: /part[- ]?time/i.test(o.type || "") ? "part-time" : /intern/i.test(o.type || "") ? "internship" : /contract|freelance/i.test(o.type || "") ? "contract" : "job",
    jobType: o.type || "", fields: fieldsFor(all, ["tech"]), pay: "paid", where: "remote",
    whereNote: o.location || "Remote", payNote: o.salary || "", deadline: null, date: o.date,
    blurb: (o.text || "").slice(0, 240).replace(/\s\S*$/, "") + ((o.text || "").length > 240 ? "…" : ""),
    fullText: (o.lines || o.text || "").slice(0, 8000),
    tags: buildProfile(all, "").skills.slice(0, 10).map((s) => s.word),
    rep: "job", simplify: !!o.simplify,
  };
}

async function fetchJobs(sources, drop) {
  const raw = [];
  const run = async (name, site, fn) => {
    try { const list = await fn(); raw.push(...list); sources.push({ name, url: site, ok: true, count: list.length }); }
    catch (err) { sources.push({ name, url: site, ok: false, count: 0, error: String(err.message || err) }); }
  };
  // Remotive: ONE request for everything (they ask for only a few requests a day)
  await run("Remotive", "https://remotive.com", async () => (await getJSON("https://remotive.com/api/remote-jobs")).jobs
    .filter((j) => US_OK.test(j.candidate_required_location || "worldwide"))
    .map((j) => ({ title: j.title, org: j.company_name, url: j.url, source: "Remotive", sourceUrl: "https://remotive.com",
      tags: j.tags, type: (j.job_type || "").replace("_", "-"), location: j.candidate_required_location, salary: j.salary,
      date: j.publication_date, text: strip(j.description), lines: htmlLines(j.description) })));
  await run("Jobicy", "https://jobicy.com", async () => (await getJSON("https://jobicy.com/api/v2/remote-jobs?count=100&geo=usa")).jobs
    .map((j) => ({ title: j.jobTitle, org: j.companyName, url: j.url, source: "Jobicy", sourceUrl: "https://jobicy.com",
      tags: [].concat(j.jobIndustry || []), type: [].concat(j.jobType || []).join(", "), location: j.jobGeo,
      salary: money(j.annualSalaryMin, j.annualSalaryMax), date: j.pubDate,
      text: strip(j.jobDescription || j.jobExcerpt), lines: htmlLines(j.jobDescription) })));
  await run("Remote OK", "https://remoteok.com", async () => (await getJSON("https://remoteok.com/api")).slice(1)
    .filter((j) => j.position && US_OK.test(j.location || "worldwide"))
    .map((j) => ({ title: j.position, org: j.company, url: j.url, source: "Remote OK", sourceUrl: "https://remoteok.com",
      tags: j.tags, type: /part[- ]?time/i.test(`${j.position} ${(j.tags || []).join(" ")}`) ? "part-time" : "", location: j.location,
      salary: money(j.salary_min, j.salary_max), date: j.date, text: strip(j.description), lines: htmlLines(j.description) })));
  await run("SimplifyJobs new-grad list", "https://github.com/SimplifyJobs/New-Grad-Positions", async () =>
    (await getJSON("https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json", 90000))
      .filter((x) => x.active && x.is_visible !== false && (x.locations || []).some((l) => /remote/i.test(l) && /usa|us\b|united states|remote$/i.test(l)))
      .map((x) => ({ title: x.title, org: x.company_name, url: x.url, source: "SimplifyJobs new-grad list",
        sourceUrl: "https://github.com/SimplifyJobs/New-Grad-Positions", tags: [x.category || ""], type: "",
        location: (x.locations || []).join(" · "), date: new Date(x.date_posted * 1000).toISOString(),
        text: `${x.category || "Tech"} role for new grads.`, simplify: true })));

  const out = [];
  for (const j of raw) {
    if (!j.title || !j.org || !j.url) { drop(j, "missing company or link"); continue; }
    if (daysSince(j.date) > JOB_MAX_AGE_DAYS) continue;                         // old — probably filled
    if (SENIOR.test(j.title)) continue;                                         // not entry level
    if (!RELEVANT_ROLE.test(`${j.title} ${(j.tags || []).join(" ")}`)) continue; // not your fields
    out.push(jobItem(j));
  }
  return out;
}

/* ==========================================================================
   MAIN
   ========================================================================== */
await mkdir(DATA, { recursive: true });
const readJSON = async (name, fallback) => { try { return JSON.parse(await readFile(new URL(name, DATA), "utf8")); } catch { return fallback; } };
const previous = await readJSON("fresh.json", {});
const reputation = await readJSON("reputation.json", {});
const blocklist = ((await readJSON("blocklist.json", { orgs: [] })).orgs || []).map((s) => String(s).toLowerCase());
const seen = previous.seen || {};
const sources = [];
const counts = {};            // why things were removed → how many
const flagged = [];           // scam / fee / blocklist removals, listed on the site
const drop = (item, why) => {
  const k = why.split(" (")[0].split(":")[0];
  counts[k] = (counts[k] || 0) + 1;
  if (/scam|fee|blocklist/i.test(why)) flagged.push({ title: item.title, org: item.org || "", why });
};

// ---- A. hand-picked programs
log("Checking hand-picked programs…");
const programs = {};
for (const p of OPPORTUNITIES) {
  programs[p.id] = { ...(await checkProgram(p)), checked: new Date().toISOString() };
  log(`  ${programs[p.id].open ? "OPEN  " : "hidden"} ${p.id}: ${programs[p.id].reason}`);
}

// ---- B + C. collect candidates
log("Collecting calls and jobs…");
const uniq = (arr) => [...new Map(arr.map((x) => [x.id, x])).values()];
let calls = await fetchFeeds(sources, drop);
// calls from earlier runs that scrolled off their feed get re-verified too
for (const old of previous.items || []) {
  if (old.rep === "call" && !calls.some((c) => c.id === old.id) && daysSince(seen[old.id] || old.date) <= KEEP_DAYS) calls.push(old);
}
const jobs = await fetchJobs(sources, drop);
let candidates = [...uniq(calls), ...uniq(jobs)];

// ---- D1. wording checks (no network needed)
candidates = candidates.filter((it) => {
  const text = `${it.title} ${it.fullText || it.blurb || ""}`;
  const flags = scamFlags(text);
  if (flags.length) { drop(it, `scam red flags: ${flags.join(", ")}`); return false; }
  if (it.rep === "call" && chargesFee(text)) { drop(it, "charges an application / entry fee"); return false; }
  if (it.pay === "unpaid" && it.fields.every((f) => f === "tech")) { drop(it, "unpaid tech"); return false; }
  const name = (orgName(it) || "").toLowerCase();
  if (blocklist.some((b) => (name && name.includes(b)) || hostOf(it.url).includes(b))) { drop(it, "on your blocklist"); return false; }
  return true;
});

// ---- B2. visit every application page: alive? open? closed?
log(`Verifying ${candidates.length} listings…`);
const verified = [];
for (const it of candidates) {
  delete it.verifyNote;
  if (it.rep === "call") {
    const why = await verifyCall(it);
    if (why) { drop(it, why); continue; }
  } else if (it.simplify) {
    // company job boards: a filled job usually 404s or says so
    const page = await fetchPage(it.url, { timeout: 20000 });
    if (page.status === 404 || page.status === 410 || (page.status === 200 && CLOSED.test(page.text))) { drop(it, "job page says it's closed"); continue; }
    it.verifyNote = "listed as active and the posting page is live";
  } else {
    it.verifyNote = `posted ${Math.max(0, Math.round(daysSince(it.date)))} day(s) ago and still listed as active`;
  }
  it.checked = new Date().toISOString();
  verified.push(it);
}

// ---- D2. reputation (Reddit + Hacker News), cached
log("Cross-checking organizations on Reddit / Hacker News…");
const repDeadline = Date.now() + REP_BUDGET_MIN * 60e3;
// check the listings that best fit you first: art / fashion / research, then newest
const fit = (it) => (it.fields.some((f) => f !== "tech") ? 1 : 0);
verified.sort((a, b) => fit(b) - fit(a) || String(b.date).localeCompare(String(a.date)));
const items = [];
const triedThisRun = new Set();   // ask about each org once per run
for (const it of verified) {
  const name = orgName(it);
  if (!name) { drop(it, "no organization name to cross-check"); continue; }
  const key = name.toLowerCase();
  let rep = reputation[key];
  const stale = !rep || rep.verdict === "pending" || daysSince(rep.checked) > (rep.verdict === "reported" ? 90 : REP_FRESH_DAYS);
  if (stale && Date.now() < repDeadline && !triedThisRun.has(key)) {
    triedThisRun.add(key);
    rep = reputation[key] = await checkReputation(name, it.rep === "job" ? ["Scams", "recruitinghell"] : ["Scams", "artbusiness"]);
    log(`  ${rep.verdict.padEnd(8)} ${name}${rep.reports.length ? ` (${rep.reports.length} report${rep.reports.length > 1 ? "s" : ""})` : ""}`);
    if (rep.throttled) await sleep(60000); // the archive asked us to slow down
  }
  if (!rep || rep.verdict === "pending") { drop(it, "scam cross-check not finished yet (retried tomorrow)"); continue; }
  if (rep.verdict === "reported") { drop(it, `called a scam on Reddit / Hacker News (${rep.reports.length} posts)`); continue; }
  it.repNote = `no posts calling “${name}” a scam on Reddit (r/Scams, r/${it.rep === "job" ? "recruitinghell" : "artbusiness"}) or Hacker News (checked ${rep.checked.slice(0, 10)})`;
  items.push(it);
}

// ---- E. save
const nowIso = new Date().toISOString();
for (const it of items) { seen[it.id] = seen[it.id] || nowIso; it.firstSeen = seen[it.id]; delete it.simplify; }
for (const id of Object.keys(seen)) if (daysSince(seen[id]) > 120) delete seen[id];
items.sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || String(b.date).localeCompare(String(a.date)));

await writeFile(new URL("fresh.json", DATA), JSON.stringify({
  updated: nowIso, sources, programs,
  removed: { counts, flagged: flagged.slice(0, 40) },   // shown on the site under "What we filtered out"
  items, seen,
}, null, 1) + "\n");
await writeFile(new URL("reputation.json", DATA), JSON.stringify(reputation, null, 1) + "\n");

const openPrograms = Object.values(programs).filter((p) => p.open).length;
log(`\nShowing ${openPrograms} open programs, ${items.filter((i) => i.rep === "call").length} calls, ${items.filter((i) => i.rep === "job").length} jobs.`);
for (const s of sources) log(`  ${s.ok ? "✓" : "✗"} ${s.name}: ${s.ok ? s.count : s.error}`);
log("Removed:", JSON.stringify(counts, null, 1));
