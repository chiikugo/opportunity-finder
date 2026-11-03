/* ==========================================================================
   scrape.mjs — the daily "new finds" collector. Keeps the site from going
   stale without anyone re-checking it by hand. No AI — just public feeds
   and keyword rules.
   --------------------------------------------------------------------------
   WHO RUNS IT?
   GitHub does, for free, every morning (see .github/workflows/refresh.yml).
   It reads the sources below, sorts out what's relevant, and saves the
   result to data/fresh.json. The website loads that file into the
   "New finds" tab. You can also run it yourself:   node scripts/scrape.mjs

   WHAT IT DOES, STEP BY STEP
   1. Downloads each source in SOURCES (RSS feeds + one open job list).
   2. Turns every listing into the same shape as the hand-picked list,
      guessing kind (fellowship / residency / grant / job…), fields (tech /
      art / fashion / research), pay, remote, and the deadline from the text.
   3. Throws out anything past its deadline or irrelevant to you.
   4. Merges with yesterday's file so things stay listed for a while (feeds
      only show their latest ~10–20 posts) and "New" badges are accurate.
   5. Checks that every hand-picked link still works, so dead links show up.

   I WANT TO…                                  → EDIT
     add a source                               → SOURCES (needs an RSS feed URL)
     keep listings around longer / shorter      → KEEP_DAYS
     change how deadlines are read              → findDeadline()
     change who the job list targets            → fetchSimplify()
   ========================================================================== */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildProfile } from "../js/match.js";
import { OPPORTUNITIES } from "../js/data/opportunities.js";

const OUT = new URL("../data/fresh.json", import.meta.url);
const KEEP_DAYS = 45;           // drop a listing this many days after we first saw it
const MAX_ITEMS = 250;          // cap the file size
// A polite, honest name for our requests (no personal info).
const UA = "OpenCall-opportunity-finder/1.0 (+https://github.com/chiikugo/opportunity-finder)";
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

/* --------------------------------------------------------------------------
   SOURCES — where new opportunities come from.
     name / site  shown on the page as the credit link
     url          the feed
     fields       fallback fields if the text doesn't make it obvious
     keep(item)   return false to skip a listing (filters per source)
   -------------------------------------------------------------------------- */
const SOURCES = [
  {
    name: "NYU ITP / IMA opportunities", site: "https://itp.nyu.edu/opportunities/",
    url: "https://itp.nyu.edu/opportunities/feed/", fields: ["art", "tech"],
    keep: () => true, // a curated art × tech list — keep everything
  },
  {
    name: "Hyperallergic opportunities", site: "https://hyperallergic.com/tag/opportunities/",
    url: "https://hyperallergic.com/tag/opportunities/feed/", fields: ["art"],
    keep: () => true,
  },
  {
    name: "AAPG artist opportunities", site: "https://www.aapgh.org/artist-opportunities",
    url: "https://www.aapgh.org/artist-opportunities?format=rss", fields: ["art"],
    // a Pittsburgh list that also posts national calls — keep the national-sounding ones
    keep: (it) => /fellowship|grant|residenc|award|prize|national|open call|foundation|museum|online|virtual|remote/i.test(it.title + " " + it.text),
  },
  {
    name: "Opportunity Desk", site: "https://opportunitydesk.org/",
    url: "https://opportunitydesk.org/feed/", fields: ["research"],
    // international site — keep things open to people in the US, in your fields
    keep: (it) => it.cats.some((c) => /america|united states|global|international|worldwide/i.test(c))
      && hasFields(it, ["art", "tech", "fashion", "research"], 2),
  },
  {
    name: "Surface Design Association", site: "https://www.surfacedesign.org/",
    url: "https://www.surfacedesign.org/feed/", fields: ["fashion", "art"],
    // textile & fiber art — keep calls, grants, residencies, exhibitions
    keep: (it) => /call|submission|grant|award|residenc|fellowship|deadline|apply|exhibition opportunit/i.test(it.title + " " + it.cats.join(" ")),
  },
  {
    name: "Fashionista", site: "https://fashionista.com/",
    url: "https://www.fashionista.com/.rss/full/", fields: ["fashion"],
    // fashion news — keep only posts announcing programs you can apply to
    keep: (it) => /fellowship|grant|award|prize|competition|scholarship|open call|accepting applications|applications? (are )?(now )?open|incubator|accelerator/i.test(it.title),
  },
  {
    name: "ProFellow", site: "https://www.profellow.com/",
    url: "https://www.profellow.com/feed/", fields: ["research"],
    // the blog mixes tips with fellowship round-ups — keep the round-ups
    keep: (it) => /fellowships?|grants?|residenc/i.test(it.title)
      && !/interview|tips|secrets|proverbs|how to|postdoc|ph\.?d|doctoral|mpa|mpp|tuition|graduate school|law school|medical/i.test(it.title),
  },
];

/* ==========================================================================
   Helpers
   ========================================================================== */
async function get(url, opts = {}) {
  try { return await getOnce(url, opts); }
  catch { return getOnce(url, { ...opts, timeout: (opts.timeout || 30000) * 1.5 }); } // one retry
}
async function getOnce(url, { json = false, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json ? res.json() : res.text();
  } finally { clearTimeout(timer); }
}

const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&[a-z]+;/gi, " ");
const strip = (html) => decode(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? m[1] : ""; };

/** Tiny RSS reader: returns [{ title, link, date, text, cats }]. */
function parseRss(xml) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    title: strip(tag(it, "title")).replace(/^(JOB|CALL|INTERN|RESIDENCY|FELLOWSHIP|GRANT):\s*/i, (m) => m), // keep ITP's prefix for kind-guessing
    link: strip(tag(it, "link")) || strip(tag(it, "guid")),
    date: new Date(strip(tag(it, "pubDate")) || Date.now()).toISOString(),
    text: strip(tag(it, "content:encoded") || tag(it, "description")).slice(0, 4000),
    cats: [...it.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map((m) => strip(m[1])),
  }));
}

/** Short stable id from a URL. */
function idOf(url) {
  let h = 5381;
  for (const c of url) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return "f-" + h.toString(36);
}

/* The site's skill list ties some general words to fashion (e.g. "marketing",
   "brand"). For scraped listings we only tag fashion when the text is
   clearly about fashion. 👉 Add words to FASHION_WORDS to loosen this. */
const FASHION_WORDS = /fashion|apparel|clothing|textile|garment|costume|styling|stylist|runway|sewing|knitwear|footwear|couture|menswear|womenswear|wardrobe/i;
function fieldsFor(text, fallback) {
  const mix = buildProfile(text, "").fieldMix;
  const f = Object.keys(mix).filter((k) => mix[k] > 0 && (k !== "fashion" || FASHION_WORDS.test(text)));
  return f.length ? f : fallback;
}

function hasFields(it, wanted, min = 1) {
  const mix = buildProfile(`${it.title} ${it.text}`, "").fieldMix;
  return wanted.reduce((s, f) => s + mix[f], 0) >= min;
}

/* --------------------------------------------------------------------------
   Guessing the details from the listing text
   -------------------------------------------------------------------------- */
function guessKind(t) {
  if (/^INTERN:|\bintern(ship)?s?\b/i.test(t)) return "internship";
  if (/residenc/i.test(t)) return "residency";
  if (/fellowship/i.test(t)) return "fellowship";
  if (/\b(grants?|award|prize|fund(ing)?|commission)\b/i.test(t)) return "grant";
  if (/part[- ]time/i.test(t)) return "part-time";
  if (/volunteer/i.test(t)) return "volunteer";
  if (/^CALL:|open call|call for|submissions?/i.test(t)) return "call";
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

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
/** Find a deadline like "Due Sept. 30", "Deadline: November 15, 2026", "apply by 12/1/2026". */
function findDeadline(text, posted) {
  const near = /(due|deadline|apply by|applications? (?:close|are due|due)|submit by|closes?|until|through)\W{0,3}/i;
  const m1 = text.match(new RegExp(near.source + String.raw`(?:on\s+)?(?:[a-z]+day,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?`, "i"));
  const m2 = text.match(new RegExp(near.source + String.raw`(?:on\s+)?(\d{1,2})/(\d{1,2})(?:/(20)?(\d{2}))?`, "i"));
  let d = null;
  if (m1) {
    const mon = MONTHS[m1[2].toLowerCase().slice(0, m1[2].toLowerCase().startsWith("sept") ? 4 : 3)];
    d = new Date(Date.UTC(m1[4] ? +m1[4] : new Date(posted).getUTCFullYear(), mon, +m1[3]));
  } else if (m2) {
    d = new Date(Date.UTC(m2[5] ? 2000 + +m2[5] : new Date(posted).getUTCFullYear(), +m2[2] - 1, +m2[3]));
  }
  if (!d || isNaN(d)) return null;
  // no year written and the date is well before the post → it means next year
  if (d < new Date(new Date(posted).getTime() - 30 * 864e5)) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Turn one feed item into an opportunity in the site's shape. */
function toItem(it, src) {
  const all = `${it.title} ${it.cats.join(" ")} ${it.text}`;
  const prof = buildProfile(all, "");
  const kind = guessKind(`${it.title} ${it.cats.join(" ")}`);
  const fields = fieldsFor(all, src.fields);
  return {
    id: idOf(it.link),
    title: it.title.replace(/^(JOB|CALL|INTERN):\s*/i, "").replace(/\s*\((due|deadline)[^)]*\)\s*$/i, "").trim(),
    org: "",
    url: it.link,
    source: src.name, sourceUrl: src.site,
    kind, fields,
    pay: guessPay(all, kind),
    where: guessWhere(all),
    deadline: findDeadline(`${it.title} ${it.text}`, it.date),
    date: it.date,
    blurb: it.text.slice(0, 260).replace(/\s\S*$/, "") + (it.text.length > 260 ? "…" : ""),
    fullText: it.text.slice(0, 3000),
    tags: prof.skills.slice(0, 10).map((s) => s.word),
  };
}

/* --------------------------------------------------------------------------
   The one non-RSS source: SimplifyJobs' open list of new-grad roles.
   Kept to: active, REMOTE in the USA, posted in the last 30 days.
   These are full-time paid tech jobs — your "tech must be paid" rule holds.
   -------------------------------------------------------------------------- */
const SIMPLIFY = {
  name: "SimplifyJobs new-grad list", site: "https://github.com/SimplifyJobs/New-Grad-Positions",
  url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
};
async function fetchSimplify() {
  const list = await get(SIMPLIFY.url, { json: true, timeout: 60000 });
  const cutoff = Date.now() / 1000 - 30 * 86400;
  return list
    .filter((x) => x.active && x.is_visible !== false && x.date_posted > cutoff
      && (x.locations || []).some((l) => /remote/i.test(l) && /usa|us\b|united states|remote$/i.test(l)))
    .sort((a, b) => b.date_posted - a.date_posted)
    .slice(0, 40)
    .map((x) => {
      const prof = buildProfile(`${x.title} ${x.category || ""}`, "");
      const fields = fieldsFor(`${x.title} ${x.category || ""}`, ["tech"]);
      return {
        id: idOf(x.url), title: x.title, org: x.company_name, url: x.url,
        source: SIMPLIFY.name, sourceUrl: SIMPLIFY.site,
        kind: "job", fields, pay: "paid", where: "remote",
        whereNote: (x.locations || []).join(" · "), deadline: null,
        date: new Date(x.date_posted * 1000).toISOString(),
        blurb: `${x.category || "Tech"} role for new grads${x.degrees?.length ? ` · ${x.degrees.join(", ")}` : ""}.`,
        tags: prof.skills.slice(0, 8).map((s) => s.word),
      };
    });
}

/* --------------------------------------------------------------------------
   Link check for the hand-picked list — only a real "not found" counts,
   since many sites block automated visitors with 403s.
   -------------------------------------------------------------------------- */
async function checkLinks() {
  const out = {};
  await Promise.all(OPPORTUNITIES.map(async (o) => {
    try {
      const res = await fetch(o.url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
      out[o.id] = res.status;
    } catch { out[o.id] = 0; }
  }));
  return out;
}

/* ==========================================================================
   Main
   ========================================================================== */
const sources = [];
let found = [];
for (const src of SOURCES) {
  try {
    const items = parseRss(await get(src.url)).filter(src.keep).map((it) => toItem(it, src));
    found.push(...items);
    sources.push({ name: src.name, url: src.site, ok: true, count: items.length });
  } catch (err) {
    sources.push({ name: src.name, url: src.site, ok: false, count: 0, error: String(err.message || err) });
  }
}
try {
  const jobs = await fetchSimplify();
  found.push(...jobs);
  sources.push({ name: SIMPLIFY.name, url: SIMPLIFY.site, ok: true, count: jobs.length });
} catch (err) {
  sources.push({ name: SIMPLIFY.name, url: SIMPLIFY.site, ok: false, count: 0, error: String(err.message || err) });
}

// Merge with the previous file: keep "first seen" dates, keep recent listings
// that have scrolled off their feed, drop expired ones.
let previous = { items: [] };
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch { /* first run */ }
const prevById = new Map((previous.items || []).map((x) => [x.id, x]));
const nowIso = new Date().toISOString();
const byId = new Map();
for (const x of found) byId.set(x.id, { ...x, firstSeen: prevById.get(x.id)?.firstSeen || nowIso });
for (const x of previous.items || []) if (!byId.has(x.id)) byId.set(x.id, x);

const todayStr = today.toISOString().slice(0, 10);
const items = [...byId.values()]
  .filter((x) => !x.deadline || x.deadline >= todayStr)                                  // not expired
  .filter((x) => (Date.now() - new Date(x.firstSeen).getTime()) / 864e5 <= KEEP_DAYS)   // not too old
  .filter((x) => !(x.pay === "unpaid" && x.fields.every((f) => f === "tech")))         // tech must be paid
  .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || b.date.localeCompare(a.date))
  .slice(0, MAX_ITEMS);

const links = await checkLinks();
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({ updated: nowIso, sources, links, items }, null, 1) + "\n");

const newToday = items.filter((x) => x.firstSeen === nowIso).length;
console.log(`Saved ${items.length} listings (${newToday} new this run).`);
for (const s of sources) console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}: ${s.ok ? s.count : s.error}`);
const dead = Object.entries(links).filter(([, c]) => c === 404 || c === 410 || c === 0);
if (dead.length) console.log(`  Possibly dead hand-picked links: ${dead.map(([id, c]) => `${id} (${c || "no answer"})`).join(", ")}`);
