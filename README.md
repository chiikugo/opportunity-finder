# Open Call: opportunity finder

This site finds **fellowships, residencies, grants, research roles and part-time work** in tech, art, fashion and research. Most of what it shows is remote, and it matches everything against your resume or a short prompt.

Live site: **https://chiikugo.github.io/opportunity-finder/**

## What it does

| Tab | What you get |
| --- | --- |
| **Fellowships & programs** | A hand-checked list of around 30 opportunities. Each one notes pay, remote status, eligibility and timing (open now, opening soon, or next round). |
| **New finds** | Listings collected **automatically every day** from 8 public sources: NYU ITP opportunities, Hyperallergic, AAPG, Opportunity Desk, the Surface Design Association, Fashionista, ProFellow, and SimplifyJobs' remote new-grad tech roles. Newly found listings get a **New** badge. |
| **Live remote jobs** | Current paid remote job posts from Remotive, Jobicy and RemoteOK. They're filtered to roles open to US applicants, with senior roles hidden by default. |
| **More places to search** | One-click searches on sites that don't share their data, such as LinkedIn (remote and part-time), Idealist, ProFellow, ArtConnect, BoF Careers and NYFA. |
| **Tailor resume** | Paste a job posting, or click **Tailor resume** on any card. It scores your resume's keyword match and runs an ATS format checklist. It asks about the gaps ("The posting asks for Figma — have you used it?"), suggests stronger bullet wording, and rebuilds a clean one-column resume. You can then download it as **.docx**, **PDF** or **.txt**, or copy it. |
| **My list** | Save anything here, then track its status and notes. You can download the list as a spreadsheet. |

These rules are built in:
- **Tech must be paid.** An unpaid opportunity that is only tech is never shown.
- **Unpaid art, fashion and research roles are optional.** The "Include free…" switch controls them.
- **Remote first.** "Remote-friendly only" is on by default.
- **Eligibility is set for US residents and recent grads.** Live jobs must accept US applicants, and senior titles are hidden.

**Tailoring never invents anything.** A question you leave unanswered changes nothing. Skills only get added when you say "Yes" or "A little", and bullets only change when you tick "Use this version". Your skill answers are remembered for the next posting.

**Privacy:** your resume is read inside your browser by PDF.js or Mammoth and is never uploaded. Your searches and saved list are stored in this browser only.

## I want to… → edit this file

| I want to… | Edit |
| --- | --- |
| Add, update or remove a fellowship | `js/data/opportunities.js` (copy a `{ … }` block; the field guide is at the top) |
| Re-check deadlines | `js/data/opportunities.js`, then update `LAST_CHECKED` |
| Add a site to "More places to search" | `js/data/boards.js` |
| Teach the matcher a new skill or synonym | `js/match.js`, in `SKILLS` |
| Make remote, paid or open-now matter more or less | `js/match.js`, in `WEIGHTS` |
| Change what the filters start as | `js/app.js`, in `DEFAULT_FILTERS` |
| Rename the tracker stages | `js/app.js`, in `STATUSES` |
| Let a resume skill drive live job searches | `js/live.js`, in `SEARCHABLE` |
| Show senior jobs, or change which titles count as senior | `js/live.js`, in `SENIOR_WORDS` |
| Change colours or fonts | `styles.css` (the tokens at the top) |
| Add a tool or skill the tailor looks for in postings | `js/tailor.js`, in `ATS_TERMS` |
| Stop the tailor asking about a common word | `js/tailor.js`, in `GENERIC` |
| Recognise another resume section heading | `js/tailor.js`, in `HEADINGS` |
| Change the .docx / PDF fonts and margins | `js/tailor-ui.js`, in `makeDocx()` / `printPdf()` |
| Add a source to the daily scraper | `scripts/scrape.mjs`, in `SOURCES` (needs an RSS feed) |
| Change when the scraper runs | `.github/workflows/refresh.yml` (the `cron` line, in UTC) |
| Run the scraper right now | GitHub → **Actions** → **Refresh new finds** → **Run workflow**, or locally with `node scripts/scrape.mjs` |

## How it works

There's no build step, no server and no AI. These are plain files:

```
index.html              page layout
styles.css              look and feel (light and dark mode)
js/app.js               glue: filters, tabs, cards, saved list
js/match.js             resume/prompt → profile → score for each opportunity
js/live.js              live job feeds (cached for 6 hours)
js/resume.js            reads PDF, DOCX and TXT files in the browser
js/tailor.js            resume tailoring: keywords, ATS checks, questions, rebuild
js/tailor-ui.js         the Tailor resume tab + .docx / PDF / .txt export
scripts/scrape.mjs      the daily "new finds" collector (run by GitHub Actions)
data/fresh.json         what the collector found (rewritten every day)
.github/workflows/refresh.yml   the daily schedule
js/data/opportunities.js  the curated list
js/data/boards.js         the "more places to search" sites
```

## Run it on your computer

The browser needs a tiny local server because the JavaScript uses modules:

```bash
python3 -m http.server 5180
```

Then open http://localhost:5180.

## Publish changes

GitHub Pages serves the `main` branch directly, so publishing is just committing and pushing:

```bash
git add -A && git commit -m "Update opportunities" && git push
```

The live site updates about a minute later.

## How "New finds" stays fresh

Every morning at about 9am ET, GitHub runs `scripts/scrape.mjs` on its own servers. This is free for public repos. The script:
1. Reads each source's feed and works out from the text what kind of opportunity each listing is (fellowship, residency, grant, job…), its field, pay, whether it's remote, and its deadline.
2. Drops anything past its deadline, unrelated to your fields, or tech-but-unpaid.
3. Keeps each listing for 45 days after it was first seen.
4. Checks that every hand-picked link still loads. A link that's gone gets a warning on its card.
5. Commits `data/fresh.json`, and GitHub Pages republishes the site.

Scraped listings aren't hand-checked, so the cards say "Pay: check" or "Location: check" when the text doesn't make those clear.

## Data credits

New finds link back to their sources: [NYU ITP](https://itp.nyu.edu/opportunities/), [Hyperallergic](https://hyperallergic.com/tag/opportunities/), [AAPG](https://www.aapgh.org/artist-opportunities), [Opportunity Desk](https://opportunitydesk.org/), [Surface Design Association](https://www.surfacedesign.org/), [Fashionista](https://fashionista.com/), [ProFellow](https://www.profellow.com/) and [SimplifyJobs](https://github.com/SimplifyJobs/New-Grad-Positions). Live jobs come from the [Remotive](https://remotive.com), [Jobicy](https://jobicy.com) and [Remote OK](https://remoteok.com) public APIs. Their terms require that every post credits the site and links back to the original posting. The cards do this, so please keep it.
