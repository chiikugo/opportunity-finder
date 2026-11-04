# Open Call: opportunity finder

This site finds **fellowships, residencies, grants, research roles and part-time work** in tech, art, fashion and research. Most of what it shows is remote, and it matches everything against your resume or a short prompt.

Live site: **https://chiikugo.github.io/opportunity-finder/**

## What it does

| Tab | What you get |
| --- | --- |
| **Programs open now** | Hand-picked programs (Anthropic Fellows, MLH, Eyebeam, Fashion Trust U.S.…), shown **only on days they're open**. Each is re-checked every morning on its own site or jobs board. |
| **Open calls & fellowships** | Calls, grants, fellowships and residencies collected daily from 7 opportunity feeds, kept only if they pass every check below. |
| **Remote jobs** | Paid, remote, entry-level-friendly jobs from Remotive, Jobicy, Remote OK and the SimplifyJobs new-grad list, kept only if they pass every check below. |
| **More places to search** | Search links (not listings) for sites that don't share their data, such as LinkedIn, Idealist, ProFellow, ArtConnect, BoF Careers and NYFA. These can't be verified, so the tab says so. |
| **Tailor resume** | Paste a job posting, or click **Tailor resume** on any card. It scores your resume's keyword match and runs an ATS format checklist. It asks about the gaps ("The posting asks for Figma — have you used it?"), suggests stronger bullet wording, and rebuilds a clean one-column resume. You can then download it as **.docx**, **PDF** or **.txt**, or copy it. |
| **My list** | Save anything here, then track its status and notes. You can download the list as a spreadsheet. |

**The strict rule: only open, real, scam-checked listings are shown.** Every morning the scraper re-checks everything, and a listing must pass all of these:
1. **It's a real listing.** It links to a specific application or job page, not a news round-up or a general homepage.
2. **It's live and open today.** The page loads, it doesn't say "closed", "filled" or "no longer accepting", and any deadline hasn't passed. Things that are coming up but not yet open are hidden.
3. **It has no scam red flags.** That means no chat-app interviews, check-cashing, "buy your own equipment", too-good-to-be-true pay or MLM wording. Art calls that charge an entry or application fee are dropped too.
4. **Nobody calls it a scam.** The organization is searched on Reddit (r/Scams, plus r/recruitinghell for jobs or r/artbusiness for art calls) and on Hacker News. Two or more posts calling it a scam means it's out. Posts about scammers *impersonating* a company don't count.

Anything that fails is hidden. The "What today's check filtered out" box on the site lists what was removed and why.

Other rules built in:
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
| Show senior jobs, or change which titles count as senior | `scripts/scrape.mjs`, in `SENIOR` |
| Change which job titles count as relevant | `scripts/scrape.mjs`, in `RELEVANT_ROLE` |
| Add a scam red flag | `scripts/lib/verify.mjs`, in `SCAM_FLAGS` |
| Allow art calls that charge entry fees | `scripts/scrape.mjs`: delete the `chargesFee` check |
| Change how many Reddit posts count as "called a scam" | `scripts/lib/verify.mjs`, in `REPORTS_TO_BLOCK` |
| Never show a certain organization | `data/blocklist.json` |
| Change how a hand-picked program is checked | `js/data/opportunities.js`, in that entry's `check` |
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
js/resume.js            reads PDF, DOCX and TXT files in the browser
js/tailor.js            resume tailoring: keywords, ATS checks, questions, rebuild
js/tailor-ui.js         the Tailor resume tab + .docx / PDF / .txt export
scripts/scrape.mjs      the daily collector + verifier (run by GitHub Actions)
scripts/lib/verify.mjs  the checks: open/closed, real listing, scam flags, Reddit/HN
data/fresh.json         today's verified listings (rewritten every day)
data/reputation.json    cached scam-check answers per organization (30 days)
data/blocklist.json     organizations you never want shown
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

## How the daily check works

Every morning at about 9am ET, GitHub runs `scripts/scrape.mjs` on its own servers. This is free for public repos. The script:
1. Checks each hand-picked program using that program's `check` rule: its Greenhouse jobs board, its page's open/closed wording, or its deadline.
2. Collects calls from the feeds and jobs from the job APIs.
3. Visits every application page and applies the four rules above.
4. Searches Reddit for each organization through [Arctic Shift](https://arctic-shift.photon-reddit.com/), a free public Reddit archive (Reddit itself blocks automated searches), and also searches Hacker News. Answers are cached for 30 days. If the archive is slow, that organization's listings are **held back** and retried the next day rather than shown unchecked.
5. Saves `data/fresh.json`, and GitHub Pages republishes the site.

**Limits.** Sites that block automated visitors (some museums, Library of Congress) can't be verified, so their programs stay hidden even when open. Scam checks lower the risk; they can't remove it. Never pay to apply, and never share bank details before a real offer.

## Data credits

Listings link back to their sources: [NYU ITP](https://itp.nyu.edu/opportunities/), [Hyperallergic](https://hyperallergic.com/tag/opportunities/), [AAPG](https://www.aapgh.org/artist-opportunities), [Opportunity Desk](https://opportunitydesk.org/), [Surface Design Association](https://www.surfacedesign.org/), [Fashionista](https://fashionista.com/), [ProFellow](https://www.profellow.com/) and [SimplifyJobs](https://github.com/SimplifyJobs/New-Grad-Positions). Live jobs come from the [Remotive](https://remotive.com), [Jobicy](https://jobicy.com) and [Remote OK](https://remoteok.com) public APIs. Their terms require that every post credits the site and links back to the original posting. The cards do this, so please keep it.
