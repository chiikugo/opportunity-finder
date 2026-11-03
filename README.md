# Open Call: opportunity finder

This site finds **fellowships, residencies, grants, research roles and part-time work** in tech, art, fashion and research. Most of what it shows is remote, and it matches everything against your resume or a short prompt.

Live site: **https://chiikugo.github.io/opportunity-finder/**

## What it does

| Tab | What you get |
| --- | --- |
| **Fellowships & programs** | A hand-checked list of around 30 opportunities. Each one notes pay, remote status, eligibility and timing (open now, opening soon, or next round). |
| **Live remote jobs** | Current paid remote job posts from Remotive, Jobicy and RemoteOK. They're filtered to roles open to US applicants, with senior roles hidden by default. |
| **More places to search** | One-click searches on sites that don't share their data, such as LinkedIn (remote and part-time), Idealist, ProFellow, ArtConnect, BoF Careers and NYFA. |
| **My list** | Save anything here, then track its status and notes. You can download the list as a spreadsheet. |

These rules are built in:
- **Tech must be paid.** An unpaid opportunity that is only tech is never shown.
- **Unpaid art, fashion and research roles are optional.** The "Include free…" switch controls them.
- **Remote first.** "Remote-friendly only" is on by default.
- **Eligibility is set for US residents and recent grads.** Live jobs must accept US applicants, and senior titles are hidden.

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

## How it works

There's no build step, no server and no AI. These are plain files:

```
index.html              page layout
styles.css              look and feel (light and dark mode)
js/app.js               glue: filters, tabs, cards, saved list
js/match.js             resume/prompt → profile → score for each opportunity
js/live.js              live job feeds (cached for 6 hours)
js/resume.js            reads PDF, DOCX and TXT files in the browser
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

## Data credits

Live jobs come from the [Remotive](https://remotive.com), [Jobicy](https://jobicy.com) and [Remote OK](https://remoteok.com) public APIs. Their terms require that every post credits the site and links back to the original posting. The cards do this, so please keep it.
