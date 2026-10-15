# Halal Executive

Knowledge hub for halal executives in Malaysia, built from what members share
in the **Halal Executive** WhatsApp, Facebook and Telegram groups.

**Live page:** https://halalexecutive.kkmhalalconsultant.com (GitHub Pages, this repo)

| Segment | What it holds | Where it comes from |
|---|---|---|
| Overview | counts, certificate validity tiles, FAQ-per-month chart, Malaysia map of certificates by state, recent FAQ, category and source bars, pipeline status, event posters, popup notice | Sheet feed |
| References | ask in Malay or English; plain answer, details and page citations from uploaded manuals and standards | `RefChunks` tab, built by `pipeline/index_references.py` |
| FAQ facts | a fact the group left unstated is filled from the references library with the page cited, or left out until a reference states it (Admin lists those) | `pipeline/resolve_sahkan.py`, after every 2-hourly run |
| Halal Certificates | holder, certificate number, scheme, state, validity (valid / expiring ≤ 90 d / expired), product list that folds and unfolds; cards or table | Certificates tab, filled by `pipeline/drive_organiser.py` from certificate documents |
| FAQ | questions by category (Halal, Food, Cosmetic), four answers each: formal / layman × EN / BM; cards or table | `pipeline/process_raw.py` from group messages |
| Guidelines | instrument list with issuer, summary EN/BM, link; cards or table | Guidelines tab (pipeline + hand-typed) |
| Documents | certificates and circulars shared in the groups, filed in Drive with date and version; current vs archived | `pipeline/drive_organiser.py` |
| Events | upcoming talks, courses, audits; posters from the Admin panel | Events tab + Settings.posters |
| News | halal-related headlines, each removed 72 h after fetch | `pipeline/news_sweep.py` |
| Admin | hero text and image, popup notification, event posters | writes Settings via Apps Script |
| Sidebar | auto-hides to an icon rail, expands on hover or focus, pin to keep it open; drawer on phones | page |
| Export | current segment as CSV, PDF (jsPDF) or Word (.docx), from the header menu | page |
| Search + Assistant | one search box over every segment; the assistant answers from the matched entries through MIRELD / AFIQ | page + `Code.gs` chat |

## How it fits together

```
WhatsApp group ──(collectors/whatsapp)──┐
Telegram group ──(collectors/telegram)──┼──► Apps Script `ingest` ──► Sheet: Raw ──► pipeline/process_raw.py ──► FAQ / Guidelines / Events / Documents(inbox)
Facebook group ──(collectors/facebook)──┘           │                                        │ (MIRELD ⇄ AFIQ)
                                                    └── Drive /Halal Executive/00 Inbox       └──► pipeline/drive_organiser.py ──► 10 Documents (vN) / 90 Archive
news feeds ──► pipeline/news_sweep.py ──► Sheet: News (72 h) 
Sheet ──(GET ?action=data)──► this page (Vite + React + Tailwind) ──► GitHub Pages ──► halalexecutive.kkmhalalconsultant.com
```

* **Models.** MIRELD (`api.mireld.my/v1`) and AFIQ (`rootsys.cloud/v1`) alternate
  on every call; if the chosen one fails for any reason the other answers the
  same request. Both failing leaves the batch untouched for the next run.
  Selection is automatic (`pipeline/llm_router.py`, and `complete()` in
  `apps-script/Code.gs` for the chatbot). The Runs tab and the Overview show
  which provider answered.
* **Cadence.** WhatsApp + Telegram + Admin uploads + new references every 30 minutes for now (2 hours once stable), each run continuing until
  the queue is empty; Facebook once a day, up to 5 hours; news every 6 hours;
  Drive organiser after every pass and once a day. See
  `.github/workflows/pipeline.yml` (primary) and `routines/` (Claude Routine
  alternative).
* **Order of work.** WhatsApp first; Facebook and Telegram after it is stable.
* **Charts.** Category colours (`src/lib/config.js` CHART) were validated with the dataviz palette validator on the light and dark surfaces; one hue per category, fixed order.

## Repository map

```
src/                 the page (React, JSX, CSS via Tailwind 4)
public/brand/        logo + favicon slots (read public/brand/README.md)
apps-script/         Code.gs (Sheet + Drive + chat backend), SHEET.md (schema)
collectors/          whatsapp/ telegram/ facebook/ + shared lib.js
pipeline/            llm_router.py, process_raw.py, drive_organiser.py, news_sweep.py
routines/            prompts if the jobs run as Claude Routines instead of Actions
.github/workflows/   deploy.yml (Pages), pipeline.yml (crons)
scripts/             split-to-own-repo.sh
SETUP.md             step-by-step bring-up
CLAUDE.md            rules for sessions working here
```

## Run locally

```
npm install
cp .env.example .env     # set VITE_API_URL once the Apps Script is deployed
npm run dev              # http://localhost:5173, sample data when VITE_API_URL is empty
```

## FHCB, Directory, events by type (15 Oct 2026)

- **FHCB**: foreign halal certification bodies recognised by JAKIM, by country
  on a world map, with logos, contacts and the document page each row cites.
  Admin → FHCB: Load the 21 Aug 2026 list once, then add / edit / delete rows
  as JAKIM gazettes updates; upload the list PDF and circulars (embedded on the
  page).
- **Directory**: Training (JAKIM Daftar Penyedia Latihan Halal, Jun 2026) and
  Services (Jurusertu, Training & Consultancy, Laboratory - coming soon), on a
  map by state. Admin → Directory to add rows and logos.
- **Events** carry a training type (Halal Competency, Halal Awareness, Halal
  Executive, Internal Halal Auditor, Others), set by the AI from the poster and
  editable in Admin.
- **FAQ**: Admin → Manage published content → FAQ has Edit, Rephrase (AI
  rewrite, same facts) and Delete in one box.
- Expired events and certificates are deleted a day after they end.
