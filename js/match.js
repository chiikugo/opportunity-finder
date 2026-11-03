/* ==========================================================================
   match.js — turns your resume / prompt into a "profile", then scores
   every opportunity against it. No AI and no internet: just keyword rules,
   so it's free, private and predictable.
   --------------------------------------------------------------------------
   THE THREE STEPS
   1. readPrompt(text)    → figures out what you ASKED for
                            ("remote", "paid", "fashion", "part-time"…)
   2. buildProfile(...)   → finds the skills & interests in your resume
                            and prompt, using the SKILLS list below
   3. scoreItem(item, p)  → gives each opportunity a number + a list of
                            reasons ("matches: textiles, archives")

   WANT BETTER MATCHES?
   Add words to SKILLS. Each skill has the word to show, which field it
   belongs to, and "aka" — other ways people write it on a resume.
   ========================================================================== */

/* --------------------------------------------------------------------------
   SKILLS — the vocabulary the matcher understands.
   field: which area it points to ("tech" | "art" | "fashion" | "research")
   aka:   alternate spellings / related words found in resumes
   👉 Add your own here. Keep words lower-case.
   -------------------------------------------------------------------------- */
export const SKILLS = [
  // tech
  { word: "python", field: "tech", aka: ["pandas", "numpy", "django", "flask"] },
  { word: "javascript", field: "tech", aka: ["typescript", "node", "node.js"] },
  { word: "react", field: "tech", aka: ["react.js", "next.js", "nextjs"] },
  { word: "web development", field: "tech", aka: ["html", "css", "frontend", "front-end", "full stack", "full-stack", "web dev", "website"] },
  { word: "software engineering", field: "tech", aka: ["software engineer", "developer", "programming", "computer science", "cs"] },
  { word: "coding", field: "tech", aka: ["code", "programmer", "programming"] },
  { word: "java", field: "tech", aka: [] },
  { word: "c++", field: "tech", aka: ["c#"] },
  { word: "sql", field: "tech", aka: ["database", "postgres", "mysql"] },
  { word: "data", field: "tech", aka: ["data science", "analytics", "data analyst", "tableau", "excel", "statistics"] },
  { word: "data analysis", field: "research", aka: ["statistical analysis", "spss", "r studio", "rstudio", "quantitative"] },
  { word: "ai", field: "tech", aka: ["artificial intelligence", "chatgpt", "generative ai", "genai", "prompt engineering"] },
  { word: "machine learning", field: "tech", aka: ["ml", "deep learning", "pytorch", "tensorflow", "neural network"] },
  { word: "llm", field: "tech", aka: ["large language model", "language model", "nlp"] },
  { word: "open source", field: "tech", aka: ["open-source", "github"] },
  { word: "git", field: "tech", aka: ["github", "version control"] },
  { word: "ux", field: "tech", aka: ["ux design", "ui", "ui/ux", "user experience", "product design", "interaction design"] },
  { word: "figma", field: "tech", aka: ["sketch", "prototyping", "wireframe", "wireframes"] },
  { word: "product", field: "tech", aka: ["product manager", "product management"] },
  { word: "policy", field: "research", aka: ["public policy", "tech policy", "government", "law"] },
  { word: "privacy", field: "tech", aka: ["security", "cybersecurity", "trust and safety"] },
  { word: "games", field: "tech", aka: ["game design", "unity", "unreal", "game development"] },
  { word: "vr", field: "tech", aka: ["virtual reality", "xr", "extended reality"] },
  { word: "ar", field: "tech", aka: ["augmented reality"] },
  { word: "startup", field: "tech", aka: ["entrepreneur", "entrepreneurship", "founder", "small business"] },

  // art
  { word: "art", field: "art", aka: ["artist", "fine art", "studio art", "bfa", "visual arts"] },
  { word: "creative coding", field: "art", aka: ["generative art", "touchdesigner", "openframeworks", "processing", "p5.js", "p5"] },
  { word: "p5.js", field: "art", aka: ["p5"] },
  { word: "processing", field: "art", aka: [] },
  { word: "generative art", field: "art", aka: ["generative", "algorithmic art"] },
  { word: "digital art", field: "art", aka: ["digital media", "new media", "media art", "net art", "internet art"] },
  { word: "illustration", field: "art", aka: ["illustrator", "drawing", "sketching", "procreate", "adobe illustrator"] },
  { word: "drawing", field: "art", aka: ["sketch", "figure drawing"] },
  { word: "painting", field: "art", aka: ["painter", "oil painting", "acrylic", "watercolor"] },
  { word: "photography", field: "art", aka: ["photographer", "lightroom", "photo", "photos", "film photography"] },
  { word: "video", field: "art", aka: ["film", "filmmaking", "videography", "premiere", "after effects", "editing"] },
  { word: "design", field: "art", aka: ["graphic design", "graphic designer", "photoshop", "indesign", "adobe", "branding", "visual design", "typography"] },
  { word: "3d", field: "art", aka: ["blender", "3d modeling", "cinema 4d", "c4d", "maya", "rhino"] },
  { word: "blender", field: "art", aka: [] },
  { word: "installation", field: "art", aka: ["sculpture", "public art"] },
  { word: "curatorial", field: "art", aka: ["curator", "curating", "exhibition", "exhibitions", "gallery"] },
  { word: "museum", field: "art", aka: ["museums", "gallery", "collections", "collection"] },
  { word: "art history", field: "research", aka: ["art historian", "visual culture", "history of art"] },
  { word: "arts administration", field: "art", aka: ["arts admin", "arts management", "nonprofit arts"] },
  { word: "craft", field: "art", aka: ["ceramics", "woodworking", "printmaking", "making", "maker"] },
  { word: "writing", field: "research", aka: ["writer", "essays", "essay", "blog", "copywriting", "editorial", "journalism", "zine", "publication", "published"] },
  { word: "art criticism", field: "art", aka: ["art writing", "art critic", "reviews"] },
  { word: "teaching", field: "art", aka: ["teacher", "tutor", "tutoring", "instructor", "teaching assistant", "ta", "workshop", "workshops", "education", "educator", "curriculum"] },
  { word: "mentoring", field: "tech", aka: ["mentor", "mentorship", "coach", "coaching"] },
  { word: "social media", field: "fashion", aka: ["instagram", "tiktok", "content creation", "content creator", "marketing"] },

  // fashion
  { word: "fashion", field: "fashion", aka: ["fashion industry", "apparel", "clothing", "garment", "garments", "runway"] },
  { word: "fashion design", field: "fashion", aka: ["fashion designer", "collection", "clo3d", "clo 3d"] },
  { word: "sewing", field: "fashion", aka: ["sew", "tailoring", "alterations", "garment construction", "construction"] },
  { word: "pattern making", field: "fashion", aka: ["patternmaking", "pattern-making", "draping", "patterns"] },
  { word: "textiles", field: "fashion", aka: ["textile", "fabric", "fabrics", "knitwear", "knitting", "weaving", "fiber", "fibre", "dyeing"] },
  { word: "styling", field: "fashion", aka: ["stylist", "wardrobe", "editorial styling", "styled"] },
  { word: "fashion history", field: "fashion", aka: ["dress history", "costume history", "history of dress"] },
  { word: "costume", field: "fashion", aka: ["costume design", "costumes", "wardrobe"] },
  { word: "merchandising", field: "fashion", aka: ["visual merchandising", "retail", "buying", "buyer", "e-commerce", "ecommerce"] },
  { word: "trend", field: "fashion", aka: ["trend forecasting", "trends", "wgsn"] },
  { word: "sustainability", field: "fashion", aka: ["sustainable", "circular", "upcycling", "upcycled", "thrift", "secondhand", "slow fashion"] },
  { word: "brand", field: "fashion", aka: ["branding", "label", "brand strategy"] },

  // research
  { word: "research", field: "research", aka: ["researcher", "research assistant", "ra", "thesis", "honors thesis", "lab", "study", "studies"] },
  { word: "archives", field: "research", aka: ["archive", "archival", "archivist", "special collections", "primary sources"] },
  { word: "qualitative", field: "research", aka: ["interviews", "ethnography", "fieldwork", "focus groups", "coding qualitative"] },
  { word: "user research", field: "research", aka: ["usability", "usability testing", "ux research"] },
  { word: "survey", field: "research", aka: ["surveys", "questionnaire"] },
  { word: "literature review", field: "research", aka: ["lit review", "annotated bibliography", "academic writing", "citations"] },
  { word: "digital humanities", field: "research", aka: ["dh", "omeka", "tei", "text mining"] },
  { word: "history", field: "research", aka: ["historian", "historical"] },
  { word: "material culture", field: "research", aka: ["object study", "object-based"] },
  { word: "transcription", field: "research", aka: ["transcribing"] },
  { word: "library", field: "research", aka: ["librarian", "library science", "mlis"] },
];

/* --------------------------------------------------------------------------
   Words in your prompt that change WHAT kind of thing you want.
   👉 Add synonyms here if the prompt box misunderstands you.
   -------------------------------------------------------------------------- */
const FIELD_WORDS = {
  tech: ["tech", "technology", "software", "coding", "engineering", "developer", "ai", "data"],
  art: ["art", "arts", "artist", "artistic", "museum", "gallery", "creative"],
  fashion: ["fashion", "clothing", "apparel", "textile", "textiles", "garment", "style"],
  research: ["research", "researcher", "archive", "archives", "academic", "study"],
};
const KIND_WORDS = {
  fellowship: ["fellowship", "fellowships", "fellow"],
  residency: ["residency", "residencies"],
  grant: ["grant", "grants", "funding", "award", "prize"],
  internship: ["internship", "internships", "intern"],
  "part-time": ["part-time", "part time", "parttime", "side job", "side gig", "gig", "freelance"],
  volunteer: ["volunteer", "volunteering", "unpaid", "free"],
};

// Common English words to ignore when pulling "extra keywords" out of a prompt.
const STOPWORDS = new Set(("a an and are as at be but by can do for from get have i i'm im in into is it its " +
  "like looking me my of on or our so some something that the their them then there these this to " +
  "want wanna would with you your want need find any also more most really just get paid pay remote " +
  "opportunity opportunities role roles position positions work working job jobs part time fulltime " +
  "full where what which who how not no yes ok please help").split(" "));

/** Make text lower-case and squash punctuation so matching is simpler. */
export function normalize(text) {
  return " " + String(text || "").toLowerCase().replace(/[^a-z0-9+#./\- ]+/g, " ").replace(/\s+/g, " ") + " ";
}

/** True if `phrase` appears in `text` as whole word(s), not inside another word. */
export function hasPhrase(text, phrase) {
  // escape regex symbols like "+" in "c++"
  const p = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`).test(text);
}

/* ==========================================================================
   1. readPrompt — what did you ASK for?
   Returns { fields, kinds, remote, paid, keywords } where each is what the
   prompt mentioned. Empty = "no preference said".
   ========================================================================== */
export function readPrompt(prompt) {
  const text = normalize(prompt);
  const fields = Object.keys(FIELD_WORDS).filter((f) => FIELD_WORDS[f].some((w) => hasPhrase(text, w)));
  const kinds = Object.keys(KIND_WORDS).filter((k) => KIND_WORDS[k].some((w) => hasPhrase(text, w)));
  const remote = /remote|from home|wfh|online|virtual/.test(text);
  const paid = /\bpaid\b|stipend|salary|\$|money/.test(text);

  // Any leftover meaningful words become free-text keywords (also used
  // to search the live job feeds).
  const known = new Set(Object.values(FIELD_WORDS).flat().concat(Object.values(KIND_WORDS).flat()));
  const keywords = text.trim().split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !known.has(w) && !/^\d+$/.test(w));

  return { fields, kinds, remote, paid, keywords: [...new Set(keywords)].slice(0, 12) };
}

/* ==========================================================================
   2. buildProfile — what skills/interests show up in your resume + prompt?
   Returns:
     skills:    [{ word, field, count }]   strongest first
     fieldMix:  { tech: n, art: n, fashion: n, research: n }  how much of each
     asked:     the result of readPrompt (what you explicitly asked for)
   ========================================================================== */
export function buildProfile(resumeText, promptText) {
  const text = normalize(`${resumeText || ""} ${promptText || ""}`);
  const found = [];
  for (const s of SKILLS) {
    // count how many of the skill's spellings appear
    const hits = [s.word, ...s.aka].filter((w) => hasPhrase(text, w)).length;
    if (hits) found.push({ word: s.word, field: s.field, count: hits });
  }
  found.sort((a, b) => b.count - a.count);

  const fieldMix = { tech: 0, art: 0, fashion: 0, research: 0 };
  for (const s of found) fieldMix[s.field] += s.count;

  return { skills: found, fieldMix, asked: readPrompt(promptText) };
}

/** All alternate spellings for a skill word (used to match against item tags). */
function spellings(word) {
  const s = SKILLS.find((x) => x.word === word);
  return s ? [s.word, ...s.aka] : [word];
}

/* ==========================================================================
   3. scoreItem — how well does one opportunity fit you?
   Works for both curated items and live job posts (they share the fields
   title / blurb / tags / fields / pay / where / kind).
   Returns { score, reasons: [string] }. Higher score = shown first.

   👉 TUNING: the numbers below are the "weights". Bigger = matters more.
   ========================================================================== */
const WEIGHTS = {
  skillInTags: 6,      // one of your skills is in the item's tags
  skillInText: 3,      // ...or just appears in its title/description
  keywordHit: 4,       // an extra word from your prompt appears in it
  askedField: 8,       // it's in a field you asked for (e.g. "fashion")
  leanField: 2,        // per point of your resume's lean toward its field
  askedKind: 6,        // it's the kind you asked for (e.g. "residency")
  remote: 5,           // fully remote (you prefer remote)
  hybrid: 2,           // has a remote option
  paid: 3,             // paid or stipend
  openSoon: 4,         // open now / opening soon / rolling
  multiField: 2,       // bridges more than one of your fields (e.g. art × tech)
  askedPaidMiss: 12,   // penalty: you said "paid" but it's unpaid
  askedRemoteMiss: 8,  // penalty: you said "remote" but it's on-site
};

export function scoreItem(item, profile, timing) {
  const reasons = [];
  let score = 0;
  const text = normalize(`${item.title} ${item.org || ""} ${item.blurb || ""}`);
  const tags = normalize((item.tags || []).join(" , "));

  // --- skills you have that this wants
  const matched = [];
  for (const s of profile.skills) {
    const forms = spellings(s.word);
    if (forms.some((w) => hasPhrase(tags, w))) { score += WEIGHTS.skillInTags; matched.push(s.word); }
    else if (forms.some((w) => hasPhrase(text, w))) { score += WEIGHTS.skillInText; matched.push(s.word); }
  }
  if (matched.length) reasons.push(`matches your ${matched.slice(0, 4).join(", ")}`);

  // --- free-text keywords from your prompt
  const kwHits = profile.asked.keywords.filter((k) => hasPhrase(text, k) || hasPhrase(tags, k));
  score += kwHits.length * WEIGHTS.keywordHit;
  if (kwHits.length) reasons.push(`mentions "${kwHits.slice(0, 3).join('", "')}"`);

  // --- fields you asked for, or that your resume leans toward
  const itemFields = item.fields || [];
  const askedHit = itemFields.filter((f) => profile.asked.fields.includes(f));
  if (askedHit.length) { score += WEIGHTS.askedField * askedHit.length; reasons.push(`${askedHit.join(" + ")} (you asked)`); }
  const totalMix = Object.values(profile.fieldMix).reduce((a, b) => a + b, 0) || 1;
  for (const f of itemFields) score += WEIGHTS.leanField * (profile.fieldMix[f] / totalMix) * 5;
  if (itemFields.length > 1 && itemFields.filter((f) => profile.fieldMix[f] > 0).length > 1) {
    score += WEIGHTS.multiField;
  }

  // --- kind you asked for
  if (profile.asked.kinds.includes(item.kind)) { score += WEIGHTS.askedKind; reasons.push(`it's a ${item.kind}`); }

  // --- your standing preferences: remote, paid, open soon
  if (item.where === "remote") { score += WEIGHTS.remote; }
  else if (item.where === "hybrid") { score += WEIGHTS.hybrid; }
  if (item.pay === "paid" || item.pay === "stipend") score += WEIGHTS.paid;
  // you said "paid" / "remote" in the prompt → push unpaid / on-site down
  if (profile.asked.paid && item.pay === "unpaid") score -= WEIGHTS.askedPaidMiss;
  if (profile.asked.remote && item.where === "onsite") score -= WEIGHTS.askedRemoteMiss;
  if (timing && (timing.state === "open" || timing.state === "soon" || timing.state === "rolling")) score += WEIGHTS.openSoon;

  return { score: Math.round(score * 10) / 10, reasons };
}

/* ==========================================================================
   timingOf — turns deadline / opens / rolling into a friendly status.
   state: "open" | "soon" | "rolling" | "later" | "unknown"
   ========================================================================== */
export function timingOf(item, today = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const t0 = new Date(today.toDateString()).getTime();
  if (item.rolling) return { state: "rolling", label: "Apply any time" };
  if (item.deadline) {
    const d = new Date(item.deadline + "T23:59:00").getTime();
    const left = Math.ceil((d - t0) / day);
    if (left >= 0) return { state: "open", label: left === 0 ? "Closes today" : `Closes in ${left} day${left === 1 ? "" : "s"}`, days: left };
  }
  if (item.opens) {
    const o = new Date(item.opens + "T00:00:00").getTime();
    const until = Math.ceil((o - t0) / day);
    if (until <= 0 && until > -45) return { state: "open", label: "Should be open now — check" };
    if (until > 0 && until <= 120) return { state: "soon", label: `Opens ~${fmtMonth(item.opens)}` };
    if (until > 120) return { state: "later", label: `Next round ~${fmtMonth(item.opens)}` };
  }
  return { state: "unknown", label: "Check dates" };
}

function fmtMonth(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
