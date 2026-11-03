/* ==========================================================================
   boards.js — other websites worth searching, with one-click links.
   --------------------------------------------------------------------------
   WHAT THIS FILE IS
   Lots of great opportunity sites have no public data feed, so the app
   can't pull their listings in directly. Instead, the "More places to
   search" tab shows each site as a card with a button that opens a search
   ON THAT SITE using your keywords.

   HOW TO ADD A SITE
   Copy a { ... } block and edit it:
     name      what the button says
     fields    which of "tech" | "art" | "fashion" | "research" it's good for
     what      one line on why it's useful
     search    a function that takes your keywords (already URL-safe) and
               returns a link. If the site has no search URL, just return
               its home page and ignore the keywords:  () => "https://…"
   ========================================================================== */

export const BOARDS = [
  // --- General job sites (use their remote / part-time filters) -----------
  {
    name: "LinkedIn — remote, part-time",
    fields: ["tech", "art", "fashion", "research"],
    what: "Pre-filtered to remote (f_WT=2) and part-time (f_JT=P) roles.",
    search: (q) => `https://www.linkedin.com/jobs/search/?keywords=${q}&f_WT=2&f_JT=P`,
  },
  {
    name: "Indeed — remote",
    fields: ["tech", "art", "fashion", "research"],
    what: "Huge general board. Add 'part time' to your keywords to narrow it.",
    search: (q) => `https://www.indeed.com/jobs?q=${q}&l=Remote`,
  },
  {
    name: "Idealist",
    fields: ["art", "research", "tech", "fashion"],
    what: "Nonprofit jobs, fellowships and volunteer roles (filter to Remote).",
    search: (q) => `https://www.idealist.org/en/?q=${q}`,
  },
  {
    name: "USAJOBS",
    fields: ["research", "tech", "art"],
    what: "Federal jobs & paid internships — Library of Congress, Smithsonian, NEA.",
    search: (q) => `https://www.usajobs.gov/Search/Results?k=${q}`,
  },

  // --- Fellowships & research ---------------------------------------------
  {
    name: "ProFellow",
    fields: ["research", "art", "tech", "fashion"],
    what: "Big searchable database of professional & academic fellowships.",
    search: (q) => `https://www.profellow.com/?s=${q}`,
  },
  {
    name: "Google: fellowships with a stipend",
    fields: ["research", "art", "tech", "fashion"],
    what: "A pre-written web search for current fellowships in your area.",
    search: (q) => `https://www.google.com/search?q=${q}+fellowship+2027+stipend+remote+%22recent+graduates%22`,
  },
  {
    name: "80,000 Hours job board",
    fields: ["research", "tech"],
    what: "Research & policy roles, many entry-level and remote (AI, policy, science).",
    search: () => "https://jobs.80000hours.org/",
  },
  {
    name: "All Tech Is Human — Responsible Tech jobs",
    fields: ["tech", "research"],
    what: "Tech-ethics, trust & safety, policy and research jobs + mentorship.",
    search: () => "https://alltechishuman.org/responsible-tech-job-board",
  },
  {
    name: "HigherEdJobs — remote research assistant",
    fields: ["research"],
    what: "University research-assistant and project roles, filterable to remote.",
    search: (q) => `https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=${q}+research&Remote=1`,
  },

  // --- Art ------------------------------------------------------------------
  {
    name: "ArtConnect — open calls",
    fields: ["art", "fashion"],
    what: "Residencies, grants, open calls and art jobs, worldwide.",
    search: () => "https://www.artconnect.com/opportunities",
  },
  {
    name: "NYFA Classifieds",
    fields: ["art", "research"],
    what: "Arts jobs, internships and opportunities (filter by 'remote').",
    search: () => "https://www.nyfa.org/classifieds/",
  },
  {
    name: "CAA Career Center",
    fields: ["art", "research"],
    what: "Art-history, museum and academic arts jobs & fellowships.",
    search: () => "https://careers.collegeart.org/jobs/",
  },
  {
    name: "Alliance of Artists Communities — residency directory",
    fields: ["art"],
    what: "Search hundreds of residencies by deadline, cost and stipend.",
    search: () => "https://artistcommunities.org/directory/residencies",
  },
  {
    name: "Res Artis — open calls",
    fields: ["art", "research"],
    what: "International residencies, including online ones.",
    search: () => "https://resartis.org/open-calls/",
  },
  {
    name: "AAM Job HQ (museums)",
    fields: ["art", "research", "fashion"],
    what: "American Alliance of Museums board — curatorial, collections, digital.",
    search: () => "https://aamjobhq.careerwebsite.com/",
  },
  {
    name: "ITP / IMA opportunities blog (NYU)",
    fields: ["art", "tech"],
    what: "A constantly updated list of art × tech calls, residencies and gigs.",
    search: () => "https://itp.nyu.edu/opportunities/",
  },

  // --- Fashion --------------------------------------------------------------
  {
    name: "BoF Careers",
    fields: ["fashion"],
    what: "Business of Fashion's job board — brands, media, tech (filter Remote).",
    search: () => "https://www.businessoffashion.com/careers/",
  },
  {
    name: "FashionUnited jobs",
    fields: ["fashion"],
    what: "Large fashion-industry board with part-time and remote filters.",
    search: () => "https://fashionunited.com/fashion-jobs",
  },
  {
    name: "Google: fashion fellowships & grants",
    fields: ["fashion"],
    what: "A pre-written search for current fashion fellowships, prizes and grants.",
    search: (q) => `https://www.google.com/search?q=${q}+fashion+fellowship+OR+grant+OR+residency+2027+open+call`,
  },

  // --- Tech -----------------------------------------------------------------
  {
    name: "Wellfound (startups)",
    fields: ["tech", "fashion"],
    what: "Startup jobs with clear salary ranges; filter Remote + Part-time.",
    search: () => "https://wellfound.com/jobs",
  },
  {
    name: "Tech Jobs for Good",
    fields: ["tech", "research"],
    what: "Paid tech roles at mission-driven orgs, many remote.",
    search: () => "https://techjobsforgood.com/",
  },
];
