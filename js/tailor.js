/* ==========================================================================
   tailor.js — the "brain" of the Tailor resume tab. No AI, no internet:
   plain rules, so it's free, private, and it NEVER invents experience.
   --------------------------------------------------------------------------
   HOW TAILORING WORKS (the 5 steps)
   1. analyzeJob(posting)        → which skills/tools the posting asks for,
                                   and how much (requirements count most)
   2. parseResume(text)          → splits your resume into header, sections,
                                   roles and bullet points
   3. compareResume(job, text)   → for each keyword: you HAVE it, you say it
                                   DIFFERENTLY (a "swap"), or it's MISSING
   4. makeQuestions(...)         → turns the gaps into questions for you
                                   ("The posting asks for Figma — have you
                                   used it?"). Nothing changes until you answer.
   5. buildResume(...)           → writes a clean, ATS-friendly resume using
                                   ONLY your answers + your original text

   Also: atsChecks(...) → a checklist of things that trip up ATS scanners
   (missing contact info, odd headings, icons, tables, length…).

   WHAT'S AN ATS?  An "Applicant Tracking System" is the software that
   reads your resume before a person does. It mostly looks for the posting's
   exact words and gets confused by fancy layouts. So the two big wins are:
   use the posting's wording, and keep the format plain.

   I WANT TO…                              → EDIT
     teach it a tool/skill to look for      → ATS_TERMS below (or SKILLS in match.js)
     stop it asking about a common word     → GENERIC below
     recognise another section heading      → HEADINGS below
     change the verb suggestions            → WEAK_OPENERS / STRONG_VERBS below
   ========================================================================== */

import { SKILLS, normalize, hasPhrase } from "./match.js";

/* --------------------------------------------------------------------------
   ATS_TERMS — tools & skills that show up a lot in tech / art / fashion /
   research postings. `aka` = other ways a resume might say the same thing
   (used to spot "you have it, but worded differently").
   👉 Add more here. Write `word` the way postings usually write it.
   -------------------------------------------------------------------------- */
const ATS_TERMS = [
  // creative software
  { word: "Adobe Creative Suite", aka: ["adobe creative cloud", "creative cloud", "photoshop", "illustrator", "indesign", "adobe"] },
  { word: "Photoshop", aka: ["adobe photoshop"] },
  { word: "Illustrator", aka: ["adobe illustrator"] },
  { word: "InDesign", aka: ["adobe indesign"] },
  { word: "Lightroom", aka: ["adobe lightroom"] },
  { word: "Premiere Pro", aka: ["premiere", "adobe premiere", "final cut", "davinci resolve"] },
  { word: "After Effects", aka: ["motion graphics"] },
  { word: "Figma", aka: [] },
  { word: "Canva", aka: [] },
  { word: "Procreate", aka: [] },
  { word: "CLO 3D", aka: ["clo3d", "browzwear"] },
  // office & productivity
  { word: "Microsoft Office", aka: ["ms office", "microsoft word", "excel", "powerpoint", "office 365", "microsoft 365"] },
  { word: "Excel", aka: ["microsoft excel", "google sheets", "spreadsheets"] },
  { word: "Google Workspace", aka: ["g suite", "google docs", "google sheets", "google drive", "google slides"] },
  { word: "PowerPoint", aka: ["keynote", "google slides"] },
  { word: "Airtable", aka: [] },
  { word: "Notion", aka: [] },
  { word: "Asana", aka: ["trello", "monday.com"] },
  { word: "Jira", aka: [] },
  { word: "Slack", aka: [] },
  // web & commerce
  { word: "Shopify", aka: [] },
  { word: "WordPress", aka: [] },
  { word: "Squarespace", aka: ["wix", "webflow"] },
  { word: "HTML", aka: ["html5"] },
  { word: "CSS", aka: ["css3", "sass", "tailwind"] },
  { word: "SEO", aka: ["search engine optimization"] },
  { word: "Mailchimp", aka: ["klaviyo", "email marketing"] },
  { word: "Salesforce", aka: ["hubspot", "crm"] },
  { word: "Tableau", aka: ["power bi", "looker", "data visualization"] },
  // research tools
  { word: "Qualtrics", aka: ["surveymonkey", "google forms"] },
  { word: "NVivo", aka: ["atlas.ti", "dedoose", "maxqda"] },
  { word: "SPSS", aka: ["stata"] },
  { word: "Zotero", aka: ["endnote", "mendeley"] },
  { word: "The Museum System", aka: ["tms", "pastperfect", "collectionspace", "axiell"] },
  // museum / archives / research skills
  { word: "metadata", aka: ["dublin core"] },
  { word: "cataloging", aka: ["cataloguing", "catalogued", "cataloged", "inventory"] },
  { word: "digitization", aka: ["digitized", "digitizing", "scanning"] },
  { word: "collections management", aka: ["collections care", "collection management", "object handling", "art handling"] },
  { word: "exhibition", aka: ["exhibitions", "exhibit", "installation"] },
  { word: "provenance research", aka: ["provenance"] },
  { word: "grant writing", aka: ["grant applications", "grants", "fundraising"] },
  { word: "editing", aka: ["edited", "copyediting", "copy editing", "proofreading"] },
  // fashion
  { word: "garment construction", aka: ["sewing", "tailoring", "construction"] },
  { word: "tech packs", aka: ["tech pack", "spec sheets", "specs"] },
  { word: "technical flats", aka: ["flats", "flat sketches", "technical sketches", "technical drawings"] },
  { word: "trend research", aka: ["trend forecasting", "trends", "wgsn"] },
  { word: "visual merchandising", aka: ["merchandising", "window displays", "displays"] },
  { word: "e-commerce", aka: ["ecommerce", "online store"] },
  { word: "photo shoots", aka: ["photoshoots", "photoshoot", "shoots"] },
  { word: "fittings", aka: ["fitting", "fit sessions"] },
  { word: "sourcing", aka: ["fabric sourcing", "vendors", "suppliers"] },
  // workplace skills (postings repeat these a lot)
  { word: "project management", aka: ["managed projects", "project coordination", "coordinated", "timelines"] },
  { word: "event planning", aka: ["event coordination", "organized events", "events"] },
  { word: "communication", aka: ["communications", "communicated", "public speaking"] },
  { word: "collaboration", aka: ["collaborated", "cross-functional", "teamwork"] },
  { word: "attention to detail", aka: ["detail-oriented", "detail oriented", "meticulous", "proofreading"] },
  { word: "time management", aka: ["deadlines", "prioritization", "multitasking"] },
  { word: "problem solving", aka: ["problem-solving", "troubleshooting", "troubleshot"] },
  { word: "customer service", aka: ["client service", "guest services", "visitor services", "front desk"] },
  { word: "content creation", aka: ["created content", "content creator", "copywriting"] },
  { word: "public speaking", aka: ["presented", "presentations", "talks", "gave tours", "tours"] },
  { word: "data entry", aka: ["databases", "database", "records"] },
  { word: "bilingual", aka: ["spanish", "french", "fluent", "native speaker"] },
];

// Words so common that we count them but never ASK about them.
// 👉 Add a word here if the questions feel silly.
const GENERIC = new Set(["art", "fashion", "coding", "data", "design", "research", "history", "brand", "product",
  "museum", "library", "startup", "processing", "trend", "craft", "ai", "ar", "vr", "video", "drawing", "policy",
  "survey", "communication", "collaboration", "events", "teaching", "writing", "games", "privacy"]);

// One combined term list: ATS_TERMS first (more specific), then the matcher's SKILLS.
const key = (s) => normalize(s).trim();
const TERMS = (() => {
  const seen = new Set();
  const out = [];
  for (const t of [...ATS_TERMS, ...SKILLS.map((s) => ({ word: s.word, aka: s.aka }))]) {
    const k = key(t.word);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ word: t.word, key: k, aka: (t.aka || []).map(key).filter((a) => a.length > 1), generic: GENERIC.has(k) });
  }
  return out;
})();

/** Find how a term is actually written in some text (keeps its capitals). */
function displayOf(text, word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(text).match(new RegExp(`(^|[^A-Za-z0-9])(${esc})(?=[^A-Za-z0-9]|$)`, "i"));
  return m ? m[2] : word;
}

/* ==========================================================================
   1. analyzeJob — what does the posting want?
   Returns { title, org, keywords:[{term, display, weight, required, preferred}],
             repeated:[word], years, wantsDegree, wantsPortfolio }
   Requirements sections count 3×, responsibilities 2×, "nice to have" 1.5×.
   ========================================================================== */
export function analyzeJob(jobText, title = "", org = "") {
  const found = new Map();
  let mode = "other";
  for (const raw of String(jobText).split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const low = line.toLowerCase();
    // short lines are probably headings: switch "mode"
    if (line.length < 70 && !BULLET.test(line)) {
      if (/(preferred|nice to have|bonus|a plus|desired|ideally)/.test(low)) mode = "pref";
      else if (/(requirement|qualification|what you.{0,3}ll (need|bring)|must have|you have|who you are|about you|you bring|skills)/.test(low)) mode = "req";
      else if (/(responsibilit|what you.{0,3}ll do|duties|the role|day.to.day|you will)/.test(low)) mode = "resp";
    }
    const weight = { req: 3, resp: 2, pref: 1.5, other: 1 }[mode];
    const n = normalize(line);
    const onLine = TERMS.filter((t) => hasPhrase(n, t.key));
    for (const t of onLine) {
      // skip "history" when this line actually says "art history"
      if (onLine.some((o) => o !== t && o.key.length > t.key.length && hasPhrase(` ${o.key} `, t.key))) continue;
      const cur = found.get(t.key) || { term: t, display: displayOf(jobText, t.word), weight: 0, required: false, preferred: false };
      cur.weight += weight;
      if (mode === "req") cur.required = true;
      if (mode === "pref") cur.preferred = true;
      found.set(t.key, cur);
    }
  }
  // Drop a term if a longer matched term contains it and isn't weaker
  // (e.g. drop "fashion" when the posting really said "fashion design").
  const list = [...found.values()];
  const keywords = list.filter((a) => !list.some((b) => b !== a && b.term.key.length > a.term.key.length
    && hasPhrase(` ${b.term.key} `, a.term.key) && b.weight >= a.weight))
    .sort((a, b) => b.weight - a.weight);

  // Other words the posting keeps repeating (could be worth echoing).
  const known = new Set(keywords.flatMap((k) => [k.term.key, ...k.term.key.split(" ")]));
  const counts = {};
  for (const w of normalize(jobText).trim().split(" ")) {
    if (w.length < 5 || JOB_STOP.has(w) || known.has(w) || /\d/.test(w)) continue;
    counts[w] = (counts[w] || 0) + 1;
  }
  const orgWords = new Set(normalize(org).trim().split(" "));
  const repeated = Object.entries(counts).filter(([w, c]) => c >= 3 && !orgWords.has(w))
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);

  const yrs = String(jobText).match(/(\d+)\s*\+?\s*(?:-|–|to)?\s*\d*\s*\+?\s*years?/i);
  return {
    title: title.trim(), org: org.trim(), keywords, repeated,
    years: yrs ? Number(yrs[1]) : null,
    wantsDegree: /bachelor|b\.a\.|b\.s\.|\bbfa\b|\bdegree\b/i.test(jobText),
    wantsPortfolio: /portfolio|work samples|reel/i.test(jobText),
  };
}

// Words to ignore in "repeated words" (job-posting filler).
const JOB_STOP = new Set(("about above after again against their there these those which while would could should " +
  "being other through during before under where every within without including include includes will shall " +
  "your yours youll youre ability able strong excellent working experience preferred required requirements " +
  "qualifications responsibilities position candidate candidates applicants apply application team teams company " +
  "opportunity employer employment equal status benefits salary hours based years must plus skills knowledge " +
  "provide support ensure work role roles across using other related relevant prior also more most well please " +
  "within perform performs duties dental vision health insurance location remote hybrid office").split(" "));

/* ==========================================================================
   2. parseResume — split plain text into parts we can rearrange.
   Returns { header:[line], sections:[{ id, kind, title, lines, entries }] }
     entries (for experience-like sections):
       [{ id, head:[line], bullets:[{ id, text }] }]
   ========================================================================== */
const HEADINGS = {
  summary: ["summary", "professional summary", "profile", "objective", "about", "about me"],
  experience: ["experience", "work experience", "professional experience", "employment", "relevant experience",
    "work history", "employment history", "related experience", "additional experience", "internships", "experiences"],
  research: ["research", "research experience", "research projects", "academic research"],
  projects: ["projects", "selected projects", "creative projects", "portfolio", "design projects", "selected work"],
  leadership: ["leadership", "activities", "involvement", "leadership and activities", "leadership experience",
    "extracurricular activities", "campus involvement", "community involvement"],
  volunteer: ["volunteer", "volunteer experience", "volunteering", "service"],
  education: ["education", "academic background", "education and training"],
  skills: ["skills", "technical skills", "skills and interests", "tools", "software", "core skills",
    "skills and tools", "technical proficiencies", "competencies", "skills and languages"],
  awards: ["awards", "honors", "awards and honors", "honors and awards", "grants and awards", "achievements"],
  exhibitions: ["exhibitions", "shows", "exhibitions and shows", "selected exhibitions", "press"],
  publications: ["publications", "presentations", "publications and presentations", "conferences"],
  certifications: ["certifications", "certificates", "licenses", "courses", "relevant coursework", "coursework"],
  languages: ["languages"],
  interests: ["interests", "hobbies"],
};
const LIST_KINDS = new Set(["experience", "research", "projects", "leadership", "volunteer"]);
const BULLET = /^\s*[•●▪◦‣⁃∙·*\-–—]\s+/;
const DATE = /((19|20)\d{2}|present|current|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(19|20)?\d{2})/i;

function headingKind(line) {
  const t = line.trim();
  if (!t || t.length > 45 || BULLET.test(t)) return null;
  const n = t.toLowerCase().replace(/&/g, "and").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!n || n.split(" ").length > 5) return null;
  for (const [kind, names] of Object.entries(HEADINGS)) if (names.includes(n)) return kind;
  // A short ALL-CAPS line with no dates is very likely a heading too.
  if (t === t.toUpperCase() && /[A-Z]{3}/.test(t) && !DATE.test(t) && n.split(" ").length <= 4) return "other";
  return null;
}

/** Does this line look like a role/school line (title, org, dates) rather than a sentence? */
function looksLikeEntryHead(line) {
  const t = line.trim();
  const words = t.split(/\s+/);
  if (DATE.test(t) && words.length <= 14) return true;
  if (/\s[|–—]\s/.test(t) && words.length <= 12) return true;
  const caps = words.filter((w) => /^[A-Z&(]/.test(w)).length;
  return words.length <= 8 && caps / words.length >= 0.6 && !/[.;]$/.test(t);
}

export function parseResume(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const header = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) { cur = { id: `s${sections.length}`, kind, title: line.trim(), lines: [], entries: [] }; sections.push(cur); continue; }
    if (!cur) header.push(line.trim()); else cur.lines.push(line);
  }
  // Break list-style sections into roles + bullets.
  for (const s of sections) {
    if (!LIST_KINDS.has(s.kind)) continue;
    let entry = null;
    const newEntry = () => { entry = { id: `${s.id}e${s.entries.length}`, head: [], bullets: [] }; s.entries.push(entry); };
    for (const raw of s.lines) {
      const line = raw.trim();
      const addBullet = (t) => { if (!entry) newEntry(); entry.bullets.push({ id: `${entry.id}b${entry.bullets.length}`, text: t }); };
      if (BULLET.test(line)) { addBullet(line.replace(BULLET, "").trim()); continue; }
      if (looksLikeEntryHead(line)) {
        if (!entry || entry.bullets.length) newEntry();
        entry.head.push(line);
        continue;
      }
      const last = entry && entry.bullets[entry.bullets.length - 1];
      // A line that continues the previous bullet (PDFs wrap long lines)
      if (last && (/^[a-z0-9(]/.test(line) || !/[.!?]$/.test(last.text))) last.text += " " + line;
      else addBullet(line);
    }
  }
  return { header, sections };
}

/* ==========================================================================
   3. compareResume — for every posting keyword: have / swap / missing
   ========================================================================== */
export function compareResume(job, resumeText) {
  const r = normalize(resumeText);
  // singular / plural count as the same word ("textile" = "textiles")
  const variants = (w) => [w, w.endsWith("s") ? w.slice(0, -1) : w + "s"];
  return job.keywords.map((k) => {
    if (variants(k.term.key).some((v) => hasPhrase(r, v))) return { ...k, status: "have" };
    const syn = k.term.aka.find((a) => a.length > 2 && hasPhrase(r, a));
    if (syn) return { ...k, status: "swap", foundAs: displayOf(resumeText, syn) };
    // same word, different ending ("catalog" vs "cataloging")
    const stem = k.term.key.replace(/(ing|ed|ion|s)$/, "");
    if (!k.term.key.includes(" ") && stem.length >= 5) {
      const m = r.match(new RegExp(`(^|[^a-z0-9])(${stem}[a-z]*)`));
      if (m) return { ...k, status: "swap", foundAs: displayOf(resumeText, m[2]) };
    }
    return { ...k, status: "missing" };
  });
}

/** Keyword match as a 0–100 number (wording swaps count half). */
export function matchScore(compared) {
  const total = compared.reduce((s, k) => s + k.weight, 0) || 1;
  const got = compared.reduce((s, k) => s + (k.status === "have" ? k.weight : k.status === "swap" ? k.weight / 2 : 0), 0);
  return Math.round((got / total) * 100);
}

/* ==========================================================================
   Bullet helpers — weak openers → stronger verbs
   ========================================================================== */
const WEAK_OPENERS = [
  { re: /^(was\s+)?responsible for\s+/i, fallback: "Managed" },
  { re: /^in charge of\s+/i, fallback: "Led" },
  { re: /^helped( to)?\s+/i, fallback: "Supported" },
  { re: /^assisted (with|in)\s+/i, fallback: "Supported" },
  { re: /^assisted\s+/i, fallback: "Supported" },
  { re: /^worked on\s+/i, fallback: "Contributed to" },
  { re: /^participated in\s+/i, fallback: "Contributed to" },
  { re: /^involved in\s+/i, fallback: "Contributed to" },
  { re: /^tasked with\s+/i, fallback: "Completed" },
  { re: /^duties included\s+/i, fallback: "Handled" },
];
// 👉 The verb chips offered under each bullet question.
export const STRONG_VERBS = ["Led", "Created", "Designed", "Researched", "Analyzed", "Organized", "Developed",
  "Curated", "Produced", "Coordinated", "Built", "Managed", "Wrote", "Improved", "Launched"];

const IRREGULAR = { write: "wrote", run: "ran", lead: "led", teach: "taught", make: "made", build: "built",
  give: "gave", take: "took", keep: "kept", find: "found", sell: "sold", draw: "drew", buy: "bought",
  bring: "brought", get: "got", begin: "began", speak: "spoke", hold: "held", meet: "met", set: "set",
  put: "put", cut: "cut", shoot: "shot", hang: "hung", choose: "chose", see: "saw", do: "did", go: "went" };
const NOT_VERBS = new Set(["the", "a", "an", "with", "to", "in", "on", "of", "for", "and", "my", "our", "their", "all", "various", "daily", "weekly"]);

/** "organize" → "organized", "managing" → "managed", "planning" → "planned". */
function pastTense(word) {
  const w = word.toLowerCase();
  if (w.endsWith("ing") && w.length > 5) {
    const base = w.slice(0, -3);
    if (IRREGULAR[base]) return IRREGULAR[base];
    if (IRREGULAR[base + "e"]) return IRREGULAR[base + "e"];
    if (/(.)\1$/.test(base) && IRREGULAR[base.slice(0, -1)]) return IRREGULAR[base.slice(0, -1)];
    if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + "ied";
    return base + "ed";
  }
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.endsWith("e")) return w + "d";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ied";
  return w + "ed";
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** If a bullet starts weakly, suggest a stronger version (or null). */
export function strongerBullet(text) {
  for (const { re, fallback } of WEAK_OPENERS) {
    const m = text.match(re);
    if (!m) continue;
    const rest = text.slice(m[0].length);
    const [first, ...others] = rest.split(" ");
    const looksVerb = first && !NOT_VERBS.has(first.toLowerCase()) && (/ing$/i.test(first) || /^(helped|assisted)/i.test(m[0]));
    if (looksVerb) return cap(pastTense(first)) + (others.length ? " " + others.join(" ") : "");
    return `${fallback} ${rest}`;
  }
  return null;
}

/** How relevant a bullet is to the posting: number of posting keywords in it. */
function relevance(text, keywords) {
  const n = normalize(text);
  return keywords.reduce((s, k) => s + ([k.term.key, ...k.term.aka].some((w) => w.length > 2 && hasPhrase(n, w)) ? k.weight : 0), 0);
}

/* ==========================================================================
   4. makeQuestions — what we need to ask you.
   Every question has an id; the UI stores your answer under that id.
   Types: headline · summary · missing (skill) · swap (wording) · bullet ·
          contact · portfolio
   ========================================================================== */
export function makeQuestions(job, compared, parsed, resumeText, skillBank = {}) {
  const qs = [];
  const all = String(resumeText);

  // contact basics
  if (!/\S+@\S+\.\w+/.test(all)) qs.push({ id: "contact-email", type: "contact", field: "email", prompt: "Your resume has no email address. ATS systems need one to contact you.", placeholder: "you@example.com" });
  if (!/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(all)) qs.push({ id: "contact-phone", type: "contact", field: "phone", prompt: "No phone number found. Add one? (Optional, but most applications expect it.)", placeholder: "(555) 555-5555" });
  if (job.wantsPortfolio && !/(https?:\/\/|www\.|\.com|\.net|\.org|linkedin|behance|portfolio)/i.test(all)) {
    qs.push({ id: "contact-portfolio", type: "contact", field: "portfolio", prompt: "The posting asks for a portfolio or work samples, but your resume has no link. Add your portfolio / website URL?", placeholder: "yourname.com or behance.net/yourname" });
  }

  // headline that echoes the job title
  if (job.title) {
    const titleInResume = hasPhrase(normalize(all), key(job.title));
    if (!titleInResume) qs.push({ id: "headline", type: "headline", prompt: `ATS scanners often check whether the job title appears on your resume. Add a headline under your name?`, suggestion: job.title });
  }

  // missing skills (the important ones, non-generic)
  const missing = compared.filter((k) => k.status === "missing" && !k.term.generic).slice(0, 10);
  for (const k of missing) {
    qs.push({
      id: `missing-${k.term.key}`, type: "missing", termKey: k.term.key, display: k.display,
      required: k.required, preferred: k.preferred,
      prompt: `The posting asks for ${k.display}${k.required ? " (listed as a requirement)" : k.preferred ? " (nice-to-have)" : ""}. Have you used it?`,
      remembered: skillBank[k.term.key] || null,
    });
  }

  // wording swaps
  const swaps = compared.filter((k) => k.status === "swap" && !k.term.generic).slice(0, 8);
  for (const k of swaps) {
    qs.push({
      id: `swap-${k.term.key}`, type: "swap", termKey: k.term.key, display: k.display, foundAs: k.foundAs,
      prompt: `Your resume says “${k.foundAs}”; the posting says “${k.display}”. ATS scanners look for the posting's exact words.`,
    });
  }

  // bullets worth strengthening: the most relevant ones that start weakly or have no numbers
  const bullets = [];
  for (const s of parsed.sections) for (const e of s.entries) for (const b of e.bullets) {
    const stronger = strongerBullet(b.text);
    const noNumber = !/\d/.test(b.text);
    if (!stronger && !noNumber) continue;
    bullets.push({ b, e, stronger, noNumber, rel: relevance(b.text, compared) + (stronger ? 2 : 0) });
  }
  bullets.sort((a, b) => b.rel - a.rel);
  for (const { b, e, stronger, noNumber } of bullets.slice(0, 5)) {
    qs.push({
      id: `bullet-${b.id}`, type: "bullet", bulletId: b.id, original: b.text, suggestion: stronger || b.text,
      where: e.head[0] || "",
      prompt: stronger
        ? `This bullet starts weakly (“${b.text.split(" ").slice(0, 3).join(" ")}…”). Lead with a strong verb${noNumber ? ", and add a number if you can" : ""}.`
        : `Can you add a number to this bullet? How many, how often, how much, or what result?`,
    });
  }

  // summary aimed at the role (offered last — it uses your other answers)
  qs.push({ id: "summary", type: "summary", prompt: parsed.sections.some((s) => s.kind === "summary")
    ? "Replace your summary with one aimed at this role? (Edit the draft — it only uses skills you have or confirmed.)"
    : "Add a short summary aimed at this role? (Edit the draft — it only uses skills you have or confirmed.)" });

  return qs;
}

/** Skills you HAVE or CONFIRMED in your answers (posting wording). */
function confirmedSkills(compared, answers) {
  const out = [];
  for (const k of compared) {
    if (k.term.generic) continue;
    const a = answers[`missing-${k.term.key}`];
    const s = answers[`swap-${k.term.key}`];
    if (k.status === "have") out.push(k.display);
    else if (k.status === "swap" && s && s.choice && s.choice !== "keep") out.push(k.display);
    else if (k.status === "missing" && a && (a.has === "yes" || a.has === "some")) out.push(k.display);
  }
  return out;
}

/** A first-draft summary from your degree + matched skills. You edit it. */
export function draftSummary(job, compared, parsed, answers) {
  const edu = parsed.sections.filter((s) => s.kind === "education").flatMap((s) => s.lines).join(" ");
  // e.g. "B.A. in Art History" → "Recent Art History graduate (B.A.)"
  const deg = edu.match(/\b(B\.?F\.?A\.?|B\.?A\.?|B\.?S\.?|Bachelor of [A-Z][a-z]+(?: [A-Z][a-z]+)?|Bachelor'?s)(?:\s*(?:degree)?\s*,?\s*(?:in|of)\s+([A-Z][A-Za-z&]+(?: (?:and |& )?[A-Z][A-Za-z&]+){0,3}))?/);
  const who = !deg ? "Recent graduate"
    : deg[2] ? `Recent ${deg[2]} graduate (${deg[1]})` : `Recent ${deg[1]} graduate`;
  const skills = confirmedSkills(compared, answers).filter((s) => !GENERIC.has(key(s))).slice(0, 5);
  const hasResearch = parsed.sections.some((s) => s.kind === "research") || /research/i.test(parsed.sections.map((s) => s.lines.join(" ")).join(" "));
  let text = `${who}${skills.length ? ` with hands-on experience in ${listJoin(skills.slice(0, 3))}` : ""}.`;
  if (hasResearch) text += " Background in research, from finding sources to presenting findings.";
  if (skills.length > 3) text += ` Also skilled in ${listJoin(skills.slice(3))}.`;
  if (job.title) text += ` Excited to bring this to the ${job.title} role${job.org ? ` at ${job.org}` : ""}.`;
  return text;
}
const listJoin = (a) => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

/* ==========================================================================
   5. buildResume — writes the tailored version.
   Returns { text, blocks, changes }
     blocks = [{ type: "name"|"contact"|"headline"|"heading"|"entry"|"line"|"bullet", text }]
              ("entry" = a role/school line like "Gallery Intern, Small Gallery")
              (used to make the .docx and the printable PDF)
     changes = plain-English list of everything that changed
   Unanswered questions change nothing.
   ========================================================================== */
export function buildResume(parsed, job, compared, answers, { reorder = true } = {}) {
  const blocks = [];
  const changes = [];
  const push = (type, text) => blocks.push({ type, text });

  // --- header: name + contact
  const [name = "Your Name", ...contact] = parsed.header;
  push("name", name);
  const extra = ["email", "phone", "portfolio"].map((f) => (answers[`contact-${f}`]?.value || "").trim()).filter(Boolean);
  const contactLines = contact.length ? [...contact] : [];
  if (extra.length) {
    if (contactLines.length) contactLines[contactLines.length - 1] += " | " + extra.join(" | ");
    else contactLines.push(extra.join(" | "));
    changes.push(`Added contact details: ${extra.join(", ")}`);
  }
  contactLines.forEach((l) => push("contact", l));

  // --- headline
  const hl = answers.headline;
  if (hl?.use && hl.text?.trim()) { push("headline", hl.text.trim()); changes.push(`Added a headline matching the role: “${hl.text.trim()}”`); }

  // --- summary
  const sm = answers.summary;
  const useSummary = sm?.use && sm.text?.trim();
  let summaryDone = false;
  const writeSummary = () => {
    push("heading", "SUMMARY");
    push("line", sm.text.trim());
    summaryDone = true;
  };
  if (useSummary && !parsed.sections.some((s) => s.kind === "summary")) { writeSummary(); changes.push("Added a role-specific summary"); }

  // --- skill decisions
  const newSkills = [];
  const swapsToApply = [];
  for (const k of compared) {
    const a = answers[`missing-${k.term.key}`];
    if (k.status === "missing" && a && (a.has === "yes" || a.has === "some")) newSkills.push(k.display);
    const s = answers[`swap-${k.term.key}`];
    if (k.status === "swap" && s && s.choice && s.choice !== "keep") swapsToApply.push({ k, choice: s.choice });
  }
  const jdKeys = compared.filter((k) => k.status !== "missing" || newSkills.includes(k.display));

  // --- new bullets from "Where/how?" answers, grouped by role
  const newBullets = {};
  for (const k of compared) {
    const a = answers[`missing-${k.term.key}`];
    if (!a || !(a.has === "yes" || a.has === "some") || !a.detail?.trim() || !a.attachTo || a.attachTo === "skills") continue;
    (newBullets[a.attachTo] ||= []).push(a.detail.trim().replace(/^[•\-–]\s*/, ""));
  }

  let skillsWritten = false;
  const writeSkills = (section) => {
    // Parse "Label: a, b, c" lines into lists we can edit.
    const rows = (section ? section.lines : []).map((raw) => {
      const l = raw.replace(BULLET, "").trim();
      const m = l.match(/^([^:]{1,32}):\s*(.+)$/);
      return { label: m ? m[1].trim() : "", items: (m ? m[2] : l).split(/\s*[,;•|·]\s*/).map((x) => x.trim()).filter(Boolean) };
    }).filter((r) => r.items.length);
    if (!rows.length) rows.push({ label: "", items: [] });

    // wording swaps
    for (const { k, choice } of swapsToApply) {
      const syn = key(k.foundAs);
      let hit = false;
      for (const r of rows) r.items = r.items.map((it) => {
        if (!hasPhrase(normalize(it), syn)) return it;
        hit = true;
        return choice === "both" ? `${k.display} (${it})` : it.replace(new RegExp(k.foundAs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), k.display);
      });
      if (!hit) rows[0].items.unshift(k.display);
      changes.push(choice === "both" ? `Skills: wrote “${k.display} (${k.foundAs})” so both wordings match` : `Skills: used the posting's wording “${k.display}” instead of “${k.foundAs}”`);
    }
    // confirmed new skills go first
    const existing = normalize(rows.flatMap((r) => r.items).join(" , "));
    const adding = newSkills.filter((s) => !hasPhrase(existing, key(s)));
    if (adding.length) { rows[0].items.unshift(...adding); changes.push(`Skills: added ${adding.join(", ")} (you confirmed these)`); }
    // posting-relevant skills first in each row
    if (reorder) for (const r of rows) {
      const scored = r.items.map((it, i) => ({ it, i, s: relevance(it, jdKeys) }));
      scored.sort((a, b) => (b.s > 0) - (a.s > 0) || a.i - b.i);
      r.items = scored.map((x) => x.it);
    }
    push("heading", (section ? section.title : "Skills").toUpperCase());
    for (const r of rows) push("line", (r.label ? `${r.label}: ` : "") + r.items.join(", "));
    skillsWritten = true;
  };

  // --- body sections, in your original order
  for (const s of parsed.sections) {
    if (s.kind === "summary") {
      if (useSummary) { writeSummary(); changes.push("Replaced your summary with a role-specific one"); }
      else { push("heading", s.title.toUpperCase()); s.lines.forEach((l) => push("line", l.trim())); }
      continue;
    }
    if (s.kind === "skills") { writeSkills(s); continue; }
    push("heading", s.title.toUpperCase());
    if (!s.entries.length) { s.lines.forEach((l) => BULLET.test(l) ? push("bullet", l.replace(BULLET, "").trim()) : push("line", l.trim())); continue; }
    for (const e of s.entries) {
      e.head.forEach((h) => push("entry", h));
      let bullets = e.bullets.map((b, i) => {
        const a = answers[`bullet-${b.id}`];
        const text = a && a.text && a.text.trim() && a.text.trim() !== b.text ? a.text.trim() : b.text;
        if (text !== b.text) changes.push(`Reworded a bullet under ${e.head[0] || s.title}: “${shorten(text)}”`);
        return { text, i };
      });
      const added = (newBullets[e.id] || []).map((text) => ({ text, i: -1 }));
      if (added.length) changes.push(`Added ${added.length} bullet${added.length > 1 ? "s" : ""} under ${e.head[0] || s.title} from your answers`);
      if (reorder) {
        const before = bullets.map((b) => b.i).join();
        bullets = bullets.map((b) => ({ ...b, r: relevance(b.text, jdKeys) })).sort((a, b) => b.r - a.r || a.i - b.i);
        if (bullets.map((b) => b.i).join() !== before) changes.push(`Moved the most relevant bullets to the top under ${e.head[0] || s.title}`);
      }
      [...added, ...bullets].forEach((b) => push("bullet", b.text));
    }
  }
  if (useSummary && !summaryDone) writeSummary();
  if (!skillsWritten && (newSkills.length || swapsToApply.length)) { writeSkills(null); changes.push("Added a Skills section"); }

  return { text: blocksToText(blocks), blocks, changes };
}

const shorten = (t) => (t.length > 70 ? t.slice(0, 68) + "…" : t);

/** Plain-text version (what you paste into application forms). */
export function blocksToText(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "heading") out.push("", b.text);
    else if (b.type === "bullet") out.push(`• ${b.text}`);
    else if (b.type === "headline") out.push(b.text, "");
    else out.push(b.text);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Turn edited plain text back into blocks (for .docx / PDF after hand edits). */
export function textToBlocks(text) {
  const lines = String(text).split("\n");
  const blocks = [];
  let seenHeading = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (!blocks.length) { blocks.push({ type: "name", text: l }); continue; }
    if (headingKind(l)) { blocks.push({ type: "heading", text: l.toUpperCase() }); seenHeading = true; continue; }
    if (BULLET.test(l)) { blocks.push({ type: "bullet", text: l.replace(BULLET, "") }); continue; }
    blocks.push({ type: !seenHeading ? "contact" : looksLikeEntryHead(l) ? "entry" : "line", text: l });
  }
  return blocks;
}

/* ==========================================================================
   atsChecks — a quick health check of the resume itself.
   Returns [{ level: "good" | "warn" | "bad", text }]
   ========================================================================== */
export function atsChecks(text, parsed, { fromPdf = false } = {}) {
  const out = [];
  const add = (level, t) => out.push({ level, text: t });
  const words = (String(text).match(/\S+/g) || []).length;
  const kinds = new Set(parsed.sections.map((s) => s.kind));
  const bullets = parsed.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets));

  if (fromPdf && words < 120) add("bad", "Very little text came out of this PDF. If it's a scanned image or a designed template, an ATS may read it as blank — use a text-based PDF or .docx.");
  /\S+@\S+\.\w+/.test(text) ? add("good", "Email address found.") : add("bad", "No email address found.");
  /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(text) ? add("good", "Phone number found.") : add("warn", "No phone number found.");
  for (const [k, label] of [["education", "Education"], ["skills", "Skills"]]) {
    kinds.has(k) ? add("good", `Standard “${label}” heading found.`) : add("warn", `No “${label}” heading found — ATS systems look for standard headings.`);
  }
  [...kinds].some((k) => LIST_KINDS.has(k)) ? add("good", "Experience-type section found.") : add("warn", "No Experience / Research / Projects heading found. Use standard names like “Experience”.");
  if (kinds.has("other")) add("warn", `Unusual heading(s): ${parsed.sections.filter((s) => s.kind === "other").map((s) => `“${s.title}”`).join(", ")}. Standard names (Experience, Projects, Skills…) are safer.`);
  if (words > 750) add("warn", `${words} words — likely over one page. For recent grads, one page is the norm.`);
  else if (words < 200) add("warn", `Only ${words} words — there may be room to add projects, research or coursework.`);
  else add("good", `${words} words — a good one-page length.`);
  if (bullets.length) {
    const withNum = bullets.filter((b) => /\d/.test(b.text)).length;
    const pct = Math.round((withNum / bullets.length) * 100);
    add(pct >= 40 ? "good" : "warn", `${pct}% of your bullets include a number. Aim for at least 40% — numbers make results concrete.`);
    const weak = bullets.filter((b) => strongerBullet(b.text)).length;
    if (weak) add("warn", `${weak} bullet${weak > 1 ? "s start" : " starts"} with a weak opener like “Responsible for” or “Helped”.`);
    const firstPerson = bullets.filter((b) => /\b(I|my|me)\b/.test(b.text)).length;
    if (firstPerson) add("warn", `${firstPerson} bullet${firstPerson > 1 ? "s use" : " uses"} “I/my” — resumes usually drop first person.`);
  }
  if ((text.match(/[|\t]/g) || []).length > 12) add("warn", "Lots of “|” or tab characters — a sign of columns or tables, which ATS systems often scramble.");
  if (/[★☆✓✔✦❖◆■□▶►➤○◉☎✉📞📧🔗]/u.test(text)) add("warn", "Icons or decorative symbols found — some ATS systems turn these into garbage characters.");
  return out;
}
