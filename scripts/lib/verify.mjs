/* ==========================================================================
   verify.mjs — the strict checks every listing must pass before it's shown.
   Used by scripts/scrape.mjs. No AI — rules you can read and change.
   --------------------------------------------------------------------------
   A LISTING ONLY GOES ON THE SITE IF ALL OF THESE PASS
     1. It IS a listing      — links to a specific application / job page
                               (not a news round-up or a generic homepage)
     2. The page is alive    — loads today; 404 / dead = out
     3. It's open            — no "applications closed / position filled"
                               wording, and any deadline is today or later
     4. It's not a scam      — no scam red flags in the text (pay-to-apply
                               fees, Telegram interviews, check-cashing…)
     5. Nobody calls it one  — the org isn't called a scam on Reddit
                               (r/Scams + a field subreddit) or Hacker News

   I WANT TO…                                     → EDIT
     add a scam red flag                           → SCAM_FLAGS
     allow / block fee-charging art calls          → FEE_FLAGS / NO_FEE
     change what counts as "closed" or "open"      → CLOSED / OPEN
     change how many Reddit reports = a scam       → REPORTS_TO_BLOCK
     never show a certain org                      → data/blocklist.json
   ========================================================================== */

// Same polite, honest name for every request (no personal info). We never
// pretend to be a browser: a site that blocks robots is treated as
// "can't verify", and its listing stays hidden.
export const UA = "OpenCall-opportunity-finder/1.0 (+https://github.com/chiikugo/opportunity-finder)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const todayStr = () => new Date().toISOString().slice(0, 10);

/* --------------------------------------------------------------------------
   Text helpers
   -------------------------------------------------------------------------- */
export const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&[a-z]+;/gi, " ");
export const strip = (html) => decode(String(html || "").replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " "))
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/* --------------------------------------------------------------------------
   Fetching a page (with a timeout, one retry, and the final URL)
   -------------------------------------------------------------------------- */
export async function fetchPage(url, { timeout = 25000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
        redirect: "follow", signal: AbortSignal.timeout(timeout),
      });
      const html = res.ok ? (await res.text()).slice(0, 600000) : "";
      return { status: res.status, finalUrl: res.url, html, text: strip(html).slice(0, 40000) };
    } catch (err) {
      if (attempt === 1) return { status: 0, finalUrl: url, html: "", text: "", error: String(err.message || err) };
      await sleep(2000);
    }
  }
}
export async function getJSON(url, timeout = 60000) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* --------------------------------------------------------------------------
   1. Is it a listing? — round-ups and articles are not.
   -------------------------------------------------------------------------- */
const ROUNDUP = /^opportunities in\b|\bround-?up\b|\blist of\b|\b\d+\s+(\w+\s+){0,3}(fellowships|grants|opportunities|residencies|scholarships)\b|\bfellowships (for|in|with)\b|\bscholarships\b|\bhow to\b|\btips\b|\binterview with\b/i;
export const isRoundup = (title) => ROUNDUP.test(title);

// Links inside a news/aggregator post that are NOT the real listing.
const NOT_LISTING_HOSTS = /(facebook|instagram|twitter|x\.com|threads\.net|linkedin\.com\/(share|sharing)|youtube|youtu\.be|tiktok|pinterest|reddit|bsky|mastodon|feedburner|wp\.me|gravatar|wikipedia|google\.com\/maps|goo\.gl\/maps|bit\.ly|linktr\.ee|patreon|substack\.com\/subscribe|mailchimp|list-manage)/i;

/** From a post's HTML, find the link to the actual opportunity (or null). */
export function findApplyLink(html, sourceHost) {
  const links = [...String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([, href, inner]) => ({ href: decode(href).trim(), text: strip(inner) }))
    .filter(({ href }) => /^https?:\/\//i.test(href) && !NOT_LISTING_HOSTS.test(href)
      && !/\.(jpe?g|png|gif|webp|pdf|mp4)(\?|$)/i.test(href)
      && !hostOf(href).endsWith(sourceHost));
  const preferred = links.find((l) => /apply|application|submit|submission|open call|call for|guidelines|details|more info|learn more|register|official|website|here|nominate/i.test(l.text));
  return (preferred || links[0])?.href || null;
}
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/* --------------------------------------------------------------------------
   2 + 3. Alive and open?
   -------------------------------------------------------------------------- */
// Wording that means it's over. 👉 Add phrases if closed things slip through.
export const CLOSED = /(applications? (are|is|have|has) (now )?closed|(submissions?|nominations?|registration|the call|this call|portal) (are |is |has |have )?(now )?closed|no longer (accepting|available|open|active)|(this |the )?(position|job|role|opportunity|vacancy|posting) (has been|is|was) (filled|closed|removed)|(job|posting|position) (is )?no longer available|deadline has (now )?passed|not (currently )?accepting (applications|submissions|nominations)|we are not (currently )?hiring|this job has expired|job (has )?expired)/i;
// Wording that means you can apply today.
export const OPEN = /(apply now|apply today|apply here|apply online|apply by|start (your|an) application|submit (your |an )?(application|proposal|work)|applications? (are |is )?(now )?(open|being accepted)|now accepting|accepting (applications|submissions|nominations|proposals)|nominations (are )?open|call for (artists|applications|entries|proposals|submissions)|how to apply|we('re| are) hiring|now hiring|rolling (basis|admissions?|applications?))/i;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
/** Find a deadline like "Due Sept. 30", "Deadline: November 15, 2026", "through 12/1/2026". */
export function findDeadline(text, postedIso = new Date().toISOString()) {
  const near = /(due|deadline|apply by|applications? (?:close|are due|due)|submit by|closes?|until|through|no later than)\W{0,4}/i;
  const m1 = String(text).match(new RegExp(near.source + String.raw`(?:on\s+)?(?:[a-z]+day,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?`, "i"));
  const m2 = String(text).match(new RegExp(near.source + String.raw`(?:on\s+)?(\d{1,2})/(\d{1,2})(?:/(20)?(\d{2}))?\b`, "i"));
  let d = null;
  const postedYear = new Date(postedIso).getUTCFullYear();
  if (m1) {
    const k = m1[2].toLowerCase();
    d = new Date(Date.UTC(m1[4] ? +m1[4] : postedYear, MONTHS[k.startsWith("sept") ? "sept" : k.slice(0, 3)], +m1[3]));
  } else if (m2) {
    d = new Date(Date.UTC(m2[5] ? 2000 + +m2[5] : postedYear, +m2[2] - 1, +m2[3]));
  }
  if (!d || isNaN(d)) return null;
  // no year written and the date is well before the post → it means next year
  if (!(m1?.[4] || m2?.[5]) && d < new Date(new Date(postedIso).getTime() - 30 * 864e5)) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Does the date written right after an "open" phrase already lie in the past?
    (e.g. "nominations are open October 7 through November 1, 2026") */
function openWindowPassed(text, openRe) {
  const m = String(text).match(new RegExp(`(${openRe.source})[\\s\\S]{0,160}`, "i"));
  if (!m) return false;
  const d = findDeadline(m[0]);
  return !!d && d < todayStr();
}

/* --------------------------------------------------------------------------
   4. Scam red flags & pay-to-apply fees
   -------------------------------------------------------------------------- */
// 👉 Each entry: [pattern, plain-English reason shown in the log]
const SCAM_FLAGS = [
  [/\b(telegram|whatsapp|signal app|wickr|google hangouts|hangouts chat)\b/i, "interview or contact over a chat app"],
  [/(send|mail) (you )?(a )?(check|cheque)|check (will be|to be) (sent|mailed)|mobile deposit|deposit (the|a) check/i, "check-cashing scheme"],
  [/(purchase|buy) (your own |the )?(equipment|laptop|software|gift cards?)|gift cards?/i, "asks you to buy things"],
  [/\breship|package (forwarding|handling|inspector)|parcel (forwarding|handling)/i, "package reshipping"],
  [/wire (transfer|money)|western union|moneygram|\bzelle\b|cash ?app|bitcoin|crypto(currency)? (wallet|payment)/i, "unusual payment method"],
  [/(training|starter|registration|onboarding|equipment) (fee|kit)|pay (a|the) (fee|deposit)|upfront (fee|payment|cost)/i, "asks you to pay to start"],
  [/earn (up to )?\$\s?\d{3,}[,\d]* (a|per) (day|week)|\$\s?\d{2,} ?(\/|per) ?h(ou)?r.{0,60}no experience|no experience (needed|required).{0,60}\$\s?\d{2,} ?(\/|per) ?h(ou)?r/i, "too-good-to-be-true pay"],
  [/mystery shopper|payment processing (agent|assistant)|financial (agent|representative) (remote|work from home)|personal assistant.{0,40}(errands|payments|bills)/i, "classic scam job title"],
  [/(guaranteed|unlimited) (income|earnings)|be your own boss|financial freedom|network marketing|\bmlm\b|commission[- ]only/i, "MLM / commission-only"],
  [/kindly (send|provide|forward)|text (me|us) (at|on) \+?\d/i, "scam-style contact wording"],
];
export function scamFlags(text) {
  return SCAM_FLAGS.filter(([re]) => re.test(text)).map(([, why]) => why);
}

// Art calls that charge you to apply ("pay-to-play" / vanity shows).
// 👉 If you're OK with small entry fees, delete this check in scrape.mjs.
const FEE_FLAGS = /((entry|application|submission|jury(ing)?|registration|processing|participation|exhibition|hanging|wall|artist) fees?\b|fee (to|per) (apply|enter|submit|entry|image|piece|work)|\$\s?\d+(\.\d\d)?\s*(per|\/|for each)\s*(entry|submission|image|work|piece|artwork)|non-?refundable|(artists?|exhibitors?) (must )?(pay|cover) )/i;
const NO_FEE = /(no (entry |application |submission |jury |registration )?fees?\b|free to (apply|enter|submit)|fee waiver|without (a|any) fee|no cost to (apply|enter)|there is no (fee|cost))/i;
export function chargesFee(text) {
  return FEE_FLAGS.test(text) && !NO_FEE.test(text);
}

/* --------------------------------------------------------------------------
   5. Reputation — is this org called a scam on Reddit or Hacker News?
   Reddit blocks anonymous automated searches, and we respect that. So:
     • If you add your own Reddit app keys as GitHub secrets
       (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET), we use Reddit's official
       API — fast and reliable.
     • Otherwise we ask Arctic Shift, a free public Reddit archive, GENTLY:
       one search per org, and when it says "slow down" we back off.
     • Hacker News search (official, free) is always checked too.
   Answers are cached for 30 days (data/reputation.json). An org we
   couldn't check yet is HELD BACK (not shown) and retried next run.

   Only posts that call the org ITSELF a scam count. Posts about scammers
   pretending to be a company ("fake Google recruiter texted me") don't.
   -------------------------------------------------------------------------- */
export const REPORTS_TO_BLOCK = 2;     // 👉 posts calling it a scam before we block it
const REDDIT_SINCE = "2024-11-01";     // only look at the last ~2 years
const IMPERSONATION = /(pretend|impersonat|posing as|claim(ing|ed|s)? to be|fake recruiter|recruiter scam|phishing|text(ed)? me|e-?mail(ed)? me|dm(ed)? me|cold dm|messaged me|whatsapp|telegram|referr?al|hack|breach|lookalike|copycat|using (their|the) name)/i;

function accuses(title, name) {
  // Only titles where the org is the SUBJECT of the accusation count:
  //   "Is Acme a scam?" · "Acme is a total scam" · "Acme scam!" · "Scammed by Acme"
  //   "Beware of Acme" · "Acme never paid me"
  // …not "fraud through Acme", "Acme scam apps", "fake Acme recruiter".
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const SCAM = "(scam|scams|scammers?|fraud|fraudulent|fake company|ponzi|pyramid scheme|mlm)";
  const patterns = [
    `\\b(is|are) ${n}\\b.{0,15}\\b(a |an )?${SCAM}\\b`,                                         // is Acme a scam
    `\\b${n}(\\s+\\S+){0,3}\\s+(is|are|was|=)\\s+(a |an |just a )?(total |complete |outright |huge )?${SCAM}\\b`, // Acme (program) is a scam
    `\\b${n}\\b\\s*(-|:)?\\s*${SCAM}\\s*([?!.:]|$|-|\\()`,                                      // "Acme scam?" / "Acme - scam"
    `\\b(scammed|defrauded|ripped off) by ${n}\\b`,
    `\\b(beware( of)?|avoid|warning:?) ${n}\\b`,
    `\\b${n}\\b.{0,30}\\b(never paid|didn'?t pay|won'?t pay|not paying|withheld (my )?pay)`,
  ];
  return new RegExp(patterns.join("|"), "i").test(title) && !IMPERSONATION.test(title);
}

/* Reddit's official API (only if you've added your own app keys). */
let redditToken = null;
async function officialReddit(subreddit, name) {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return undefined; // not set up
  try {
    if (!redditToken) {
      const res = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST", body: "grant_type=client_credentials",
        headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      });
      redditToken = (await res.json()).access_token;
      if (!redditToken) return null;
    }
    const q = encodeURIComponent(`title:"${name}"`);
    const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/search?q=${q}&restrict_sr=1&t=year&limit=100&sort=relevance`,
      { headers: { authorization: `Bearer ${redditToken}`, "user-agent": UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    return ((await res.json()).data?.children || []).map((c) => ({ title: c.data.title, permalink: c.data.permalink }));
  } catch { return null; }
}

/* Arctic Shift (public archive). Returns posts, null (couldn't check), or
   "throttled" (it asked us to slow down — the caller pauses). */
async function arcticShift(subreddit, name) {
  const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subreddit}&title=${encodeURIComponent(name)}` +
    `&after=${REDDIT_SINCE}&limit=100&fields=title,created_utc,id`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(45000) });
    const data = await res.json().catch(() => null);
    if (data && Array.isArray(data.data)) return data.data;
    if (res.status === 422 || res.status === 429 || /slow down/i.test(data?.error || "")) return "throttled";
    return null;
  } catch { return null; }
}

async function hackerNews(name) {
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${name}" scam`)}&tags=story&hitsPerPage=30`,
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    return (await res.json()).hits || [];
  } catch { return []; }
}

/** Check one org on r/Scams + one field subreddit + Hacker News.
    Returns { verdict: "clean" | "reported" | "pending", reports, checked, via, throttled } */
export async function checkReputation(name, subreddits) {
  const reports = [];
  let complete = true, throttled = false, via = "Reddit (Arctic Shift archive)";
  for (const sub of subreddits) {
    let posts = await officialReddit(sub, name);
    if (posts !== undefined) via = "Reddit (official API)";
    else {
      posts = await arcticShift(sub, name);
      if (posts === "throttled") { throttled = true; posts = null; }
    }
    if (posts === null) { complete = false; break; } // stop; retry this org next run
    for (const p of posts) {
      if (accuses(p.title, name)) reports.push({ where: `r/${sub}`, title: p.title, url: p.permalink ? `https://www.reddit.com${p.permalink}` : `https://www.reddit.com/r/${sub}/comments/${p.id}` });
    }
    await sleep(posts.length ? 8000 : 4000);
  }
  for (const h of await hackerNews(name)) {
    if (h.title && accuses(h.title, name)) reports.push({ where: "Hacker News", title: h.title, url: `https://news.ycombinator.com/item?id=${h.objectID}` });
  }
  const verdict = reports.length >= REPORTS_TO_BLOCK ? "reported" : complete ? "clean" : "pending";
  return { verdict, reports: reports.slice(0, 5), checked: new Date().toISOString(), via, throttled };
}

/** The name we search Reddit for: the org, else the start of the title, else the website. */
const FORM_HOSTS = /(google|docs|forms|airtable|submittable|callforentry|smartsheet|jotform|typeform|wordpress|squarespace|wixsite|wix|linktr|eventbrite|myworkdayjobs|greenhouse|lever|ashbyhq|smartrecruiters|workable|bamboohr|icims|jobvite|rippling|breezy|recruitee|applytojob|paylocity|ultipro|dayforce|jazzhr|teamtailor|personio|notion|canva|dropbox|zealous|slideroom|entrythingy)/i;
const GENERIC_NAMES = /^(the|a|an|call|open|apply|job|jobs|hiring|new|art|artist|artists|grant|grants|fellowship|residency|program|intern|internship|remote|studio|gallery|museum|center|centre|foundation|award|prize|project)$/i;
export function orgName(item) {
  if (item.org && item.org.length >= 3) return item.org.trim();
  const lead = item.title.split(/\s[-–—|:]\s|:\s|\s(at|with|from)\s/)[0].replace(/^(job|call|intern|open call)\s*:?\s*/i, "").trim();
  if (lead.split(/\s+/).length <= 5 && lead.length >= 4 && !GENERIC_NAMES.test(lead)) return lead;
  const host = hostOf(item.url);
  if (!host || FORM_HOSTS.test(host)) return null;
  const core = host.split(".").slice(-2, -1)[0] || "";
  return core.length >= 5 ? core : null;
}

/* --------------------------------------------------------------------------
   Programs (the hand-picked list) — is each one open TODAY?
   Returns { open, reason, listings:[{title,url}] }
   -------------------------------------------------------------------------- */
export async function checkProgram(p) {
  const c = p.check;
  if (!c) return { open: false, reason: "can't be checked automatically" };
  const today = todayStr();

  if (c.type === "greenhouse") {
    try {
      const data = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${c.board}/jobs`);
      const want = new RegExp(c.title, "i");
      const skip = c.exclude ? new RegExp(c.exclude, "i") : null;
      const listings = (data.jobs || [])
        .filter((j) => want.test(j.title) && !(skip && skip.test(j.title)) && (!c.remote || /remote/i.test(j.location?.name || "")))
        .map((j) => ({ title: j.title, url: j.absolute_url, location: j.location?.name || "" }));
      return listings.length ? { open: true, reason: `${listings.length} matching posting(s) live on their jobs board`, listings }
        : { open: false, reason: "no matching postings on their jobs board" };
    } catch (err) { return { open: false, reason: `jobs board didn't answer (${err.message})` }; }
  }

  const page = await fetchPage(c.url || p.url);
  if (c.type === "rolling") {
    // always-open sign-ups: fine as long as the site is up (some block robots with 403)
    return page.status >= 200 && page.status < 400 || page.status === 403
      ? { open: true, reason: "always-open sign-up; site is up", listings: [{ title: p.title, url: p.url }] }
      : { open: false, reason: `site didn't load (${page.status || page.error})` };
  }
  if (page.status !== 200) return { open: false, reason: `page didn't load for our check (${page.status || page.error})` };

  if (c.type === "deadline") {
    if (!p.deadline || p.deadline < today) return { open: false, reason: "deadline has passed" };
    if (c.confirm && !new RegExp(c.confirm, "i").test(page.text)) return { open: false, reason: "page no longer mentions this call" };
    if (CLOSED.test(page.text) && !new RegExp(c.confirm || "$^", "i").test(page.text)) return { open: false, reason: "page says it's closed" };
    return { open: true, reason: `open until ${p.deadline}`, listings: [{ title: p.title, url: c.url || p.url }] };
  }

  // type "page"
  const openRe = new RegExp(c.open, "i");
  if (c.closed && new RegExp(c.closed, "i").test(page.text)) return { open: false, reason: "page says it's closed" };
  if (!openRe.test(page.text)) return { open: false, reason: "page doesn't say it's open" };
  if (openWindowPassed(page.text, openRe)) return { open: false, reason: "the open window's end date has passed" };
  const deadline = findDeadline(page.text);
  return { open: true, reason: "page says applications are open", deadline: deadline && deadline >= today ? deadline : null,
    listings: [{ title: p.title, url: page.finalUrl || c.url || p.url }] };
}
