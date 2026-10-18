# Standing rules for halal-executive

1. **The Sheet is the database.** Every write goes through
   `apps-script/Code.gs`. Do not add a second writer (no gspread, no direct
   Drive API) and do not change `TABS` column order; append columns only.
2. **Two providers, auto-selected by speed.** MIRELD and AFIQ cover each
   other on any failure (`pipeline/llm_router.py`, `complete()` in Code.gs).
   Each call's time is recorded per provider; once both have 3 timed calls
   the faster one leads 4 calls in 5 and the other keeps 1 in 5 so the lead
   can change by itself (Wan, 14 Oct 2026). Automatic stays the default and
   nothing in code hard-codes one. **Admin → AI model** (Wan, 18 Oct 2026) may
   pin one provider, set the main and the quick model for each, and switch the
   handover to the other off ("use only this one"). The choice is Settings keys
   `llm_mode`, `llm_strict`, `llm_model_<NAME>`, `llm_fast_<NAME>`, written only
   by `llmConfigSave` (the generic `settings` route and every public output
   strip `llm_*`), read by `complete()` in Code.gs and by `llm_router.py`
   through the `llm_config` action. It beats the `*_MODEL` variables, which
   stay as the fallback; a withdrawn model falls back to auto rather than
   breaking the site. Never add a third provider without Wan, never mark a Raw
   row processed when every allowed provider failed.
3. **Nothing private is published.** `Raw` never reaches the page. Names,
   phone numbers, member company names and case details stay out of FAQ,
   Documents titles, Events and News. A fact the messages left unstated is
   written `[SAHKAN: <the exact missing fact>]`, a working note only:
   `pipeline/resolve_sahkan.py` fills it from the references library with
   the page cited (quote checked word for word, no new numbers) or takes it
   out and keeps it in `FAQ.verify_notes` for the admin. The page and
   `publicData()` never show a marker.
4. **Language.** Bahasa Malaysia, never Bahasa Indonesia: boleh not bisa,
   ubat not obat, syarikat not perusahaan, kualiti not kualitas,
   pembungkusan not kemasan. Regulatory terms stay original.
5. **News lives 72 hours.** `expires_at` is set once at fetch and never
   extended.
6. **Group files wait for an admin; expired ones never show.** A poster,
   certificate or document from the WhatsApp group is copied into Drive and
   lands in Admin → Drafts (`from:group`); Admin uploads publish at once.
   An Admin upload marked Event is always read into an event with its poster
   (`read_event`), like a certificate upload, and a poster chosen in the
   Events form is read by the AI to fill the form (`eventFromPoster`). An
   expired certificate or document goes to `90 Archive` with status `expired`
   and is never a draft; nor is a finished event (Wan, 15 Oct 2026).
   **Nothing is deleted automatically except finished events.** Superseded
   document versions move to `90 Archive`; duplicates are marked, not removed.
   Deleting for good (row + its Drive file) happens only through Admin's
   Delete button, which asks first (`adminDelete` in Code.gs). Finished
   events (a day after they end) and their uploaded posters are removed by
   `purgePastEvents` on the 30-minute timer (Wan, 14 Oct 2026), and so are AI
   draft events taken from a message more than 120 days old (Wan, 15 Oct 2026).
7. **One repository publishes this site**, this one, to
   `halalexecutive.kkmhalalconsultant.com`. Never connect it to a host that
   serves the repo root (the 05 Sep 2026 Cloudflare Pages exposure in
   malaysian-regulatory-affairs is why).
8. **Logo.** The JAKIM Halal Malaysia mark is a certification mark under the
   Trade Descriptions (Certification and Marking of Halal) Order 2011. Wan
   supplied the artwork and chose to use it (14 Oct 2026); the files are in
   `public/brand/`. Clearance with JAKIM is Wan's to settle.
9. `kkm-targets`, Hermes, ws.regulab Studio and the KKM Complaints system are
   other repos. Do not recreate any of them here.
10. **Admin is locked to registered emails.** Sign-in is a 6-digit code
    mailed by Apps Script to an address in `ADMIN_EMAILS`. Never add a
    shared password or put a token in the page.
11. **Current references** (checked 14 Oct 2026): MPPHM (Domestik) 2020,
    MHMS 2020, MS 1500:2019, MS 2634:2019. MS 2200-1:2008 is withdrawn;
    never cite it as current.
12. **References stay private.** Uploaded standards (MS documents are
    copyrighted by Standards Malaysia) live in Drive and the `RefChunks` tab.
    The public page may receive answers and short quotes (25 words), never
    whole passages or files.
13. **Every link from the Sheet goes through `safeUrl`** (src/lib/safe.js) and
    links from the model through `safe_url` in the pipeline. Sheet text can
    come from a WhatsApp message.
14. **Pipeline cadence is 30 minutes for now** (Wan, 14 Oct 2026), going back
    to 2 hours once the collectors are stable. The clock is Apps Script, not
    GitHub cron (it fired twice in ten hours on this repo): `installTriggers()`
    in Code.gs dispatches `pipeline.yml` with GITHUB_TOKEN (30 min messages;
    3 h reference review, `index_references.py --audit`, re-reads a reference
    until it is whole, at most 5 times; 6 h news). Change the times
    there and run `installTriggers()` again; do not add a cron back to
    pipeline.yml, or runs double.
15. **Runs go phase by phase** (Wan, 14 Oct 2026, "like the KKM complaints
    routine"). Each phase in `pipeline.yml` has its own time box, a failed or
    timed-out phase never stops the next, and `process_raw.py` stops itself
    after `--minutes 20`, so a backlog is worked through over several runs
    and never times out. Every phase and every batch writes a line to
    Admin → Progress (`phase.py`, `he_api.progress`, `saveProgress` in
    Code.gs). One bad model reply marks only its own batch `error`; it never
    stops the queue. `tickWatch` (every 10 min) emails the admins once when
    the WhatsApp heartbeat is older than 15 minutes or not CONNECTED, or the
    last 3 runs failed, and once when it is fixed.
16. **FHCB and Directory are Sheet tabs edited in Admin** (Wan, 15 Oct 2026).
    `src/data/fhcb.json` (96 bodies, JAKIM list effective 21 Aug 2026) and
    `src/data/directory.json` (42 JAKIM training providers, Jun 2026, plus
    sample service rows) are seeds: Admin → "Load" copies the rows the Sheet
    does not have yet, and the page shows the seed only while the tab is empty.
    After that every update is one row added, edited or deleted in Admin, and
    each row keeps `source_ref` (document and page). Logos the seed ships are
    in `public/fhcb/` and `public/directory/`; a logo uploaded in Admin goes to
    Drive `50 Logos`, the FHCB list PDF and circulars to `40 FHCB` (Documents,
    category `fhcb`, embedded on the page with Drive's viewer).
17. **Maps are MapLibre GL on Carto Positron** (`src/components/MapView.jsx`);
    the CSP in `index.html` allows `basemaps.cartocdn.com`. Country centroids
    live in `COUNTRY_COORDS` (config.js); add a country there when a new one
    appears in the FHCB list, or its marker is silently skipped.
18. **Expired certificates are deleted for good a day after `valid_to`**
    (`purgeExpiredCerts`, every 30 min with the events purge, under the script
    lock), with their document row and Drive file. An expired document that is
    not a certificate (a circular, a form) is archived, never deleted. Dates are
    read day-first (DD/MM/YYYY) before anything else (`eventOver`). Nothing
    else deletes by itself.
19. **Disclaimer.** The footer, the FAQ page and the popup notice say the hub
    is AI-drafted, reviewed, not a ruling, can be wrong, and is used at the
    reader's own responsibility. Keep that wording on every public page.
20. **Sheet cells: `cellSafe` on every write.** A value starting with + = - @
    is stored with a leading apostrophe, and so is a number with a leading
    zero, or Sheets turns "+61 8 ..." into #ERROR! and drops the 0 of a phone
    number (15 Oct 2026). Admin's FHCB/Directory "Load" also repairs cells an
    earlier load damaged; it never overwrites a value Wan edited.
21. **Popup notice is the card-8 AlertCard** (`src/components/ui/alert-card.tsx`),
    colour from `notice_color`, posters from `notice_posters` sliding under
    the message, each shown whole. It shows only while `notice_enabled` is
    ticked, only on the Overview page, every time it is opened or refreshed
    (nothing remembered), and closes itself after 7 seconds (paused while
    held) as well as on a click (Wan, 15 Oct 2026).
22. **Navigation.** Tablet and desktop header: `ui/nav-header.tsx`, text only,
    no icons; phones: the icon bar. Admin is only the black button at the top
    right, never in the header tabs or the sidebar (`MENU` in Sidebar.jsx).
    Directory has three sections (#directory/training, /sertu, /lab); the
    categories inside Training & Consultancy live in Settings `dir_categories`
    and are edited in Admin → Directory. Deleted FHCB/Directory rows are kept
    in Settings `seed_deleted` so "Load" never brings them back.
23. **Header and page share one column**: both are `max-w-7xl mx-auto` inside
    `xl:pl-[232px]`; the sidebar shows from 1280 px (below that it is the menu
    drawer), so the ten header tabs always fit and the edges line up.
25. **Popup freshness.** The page always asks the Sheet on load (the saved
    copy shows meanwhile), and the popup reads `?action=settings` (a few KB)
    first, waiting up to 8 s for fresh settings before falling back to the
    saved copy. Its text colour is picked by contrast ratio (dark on amber or
    gold, white on green, red or navy); posters are capped so the whole card
    fits a phone screen.
24. **Popup posters** slide every 3 s and each adds 3 s to the 7 s the popup
    stays open. Admin → Event posters is a different thing: posters for the
    Events page and the Overview's upcoming-events row.
26. **A halal certificate is never listed as a document** (Wan, 18 Oct 2026).
    Each certificate keeps a Documents row (`kind: certificate`) only to hold
    its Drive file. Readers meet it on Halal Certificates. Every document
    list leaves it out through `filedDocs()` (src/lib/certs.js): the Documents
    page, the counts, Overview, search, export, Admin → Drafts and Manage;
    `reviewList` skips it server-side. Document kinds are shown by name
    (`dk_*` in i18n), never as the raw kind.
27. **The QR code on an event poster is its registration link** (Wan, 18 Oct 2026).
    A model reading a poster only gets its words, so QR codes are decoded from
    the file itself, and only http(s) addresses count (`qr_links.py`; `qr.js`
    in the page). Pipeline: every event made from an Admin upload or a group
    poster goes through `qr_link_for` in `process_raw.py` (pictures, PDF pages,
    pictures inside .pptx/.docx); the QR link beats a link the model guessed.
    Events form: a picture is read in the browser (jsQR); a PDF or Office
    poster is read from the first-page preview `eventFromPoster` returns as
    `qr_image`. A link typed in the form is never replaced. Job `event_qr`
    (Admin → Run now) fills the empty `link` of upcoming events that already
    have a poster; it never replaces a link and never touches finished or
    hidden events.
28. **The hero globe is a real Earth** (`ui/globe.tsx`, `public/brand/earth.jpg`,
    NASA Blue Marble): one WebGL shader, no 3D library, turns by itself, pins
    on the FHCB countries, no glow, no shadow and no text on the card (Wan,
    18 Oct 2026), CSS fallback without WebGL. cobe was tried first
    and dropped: it is a monochrome dot map and its shader rendered black on
    software GL. The picture is NASA imagery (generally free to use with
    credit); Wan to confirm the credit line he wants.
29. **Every item shows when it was uploaded and when it was published**
    (Wan, 18 Oct 2026), Malaysia time. Code.gs stamps `created_at` once, when a
    row first appears, and `published_at` once, the first time its status is
    published, current or indexed (`stampLine` in `upsert`, and `updateByIds`
    for a status change); a whole-row upsert keeps both, and hiding then
    re-publishing keeps the first moment. Columns were appended to Guidelines,
    Certificates, Events, FHCB and Directory (created_at, published_at) and to
    FAQ and Documents (published_at). Rows from before the stamps fall back, in
    the page only (`uploadedAt`/`publishedAt` in util.js): the received, added
    or fetched time, the time inside a hand-made id (EV-M261016011450), then the
    last update. News shows Fetched and the source's own date; References show
    added and indexed. Nothing was back-filled in the Sheet.
30. **The hero title stays on one line at every width** (checked 360 to 1536 px,
    English and Malay; the Malay line is longer, so it is set smaller on phones).
    It is "Welcome to Halal Executive Hub" / "Selamat Datang ke
    Halal Executive Hub"** unless Admin types a title (`hero_title`, and
    `hero_title_bm` for Bahasa Malaysia); the old plain "Halal Executive" counts
    as not typed.
31. **Every card has a thumbnail** (Wan, 18 Oct 2026). `FileThumb` shows the Drive
    preview of a certificate (id CERT-) or a document (id DOC-) through the
    `thumb` route (`thumbFor` in Code.gs, read with the owner's Drive rights,
    no file made public) and, with no preview, a designed tile with the name
    and what it is, never a blank. A certificate tries its own file, then the
    file of its document row. A file Drive reports as not found comes back
    `missing` and is not asked for again for 10 minutes. Events always show a
    poster tile (the title on the brand gradient when there is no poster).
    Admin → Halal certificates (`CertAdmin`, `certFilesCheck`) lists every
    certificate, hidden ones too, with its file state (in Drive; in Drive trash:
    restore it; not found or not linked: upload it again), and can Hide, show or
    Delete one. An older Code.gs answers `unknown action cert_files`: the box then
    lists the public certificates and says to deploy the newest Code.gs. A file
    that belongs to a certificate cannot be deleted from Documents: delete the
    certificate, which removes its file with it. On 18 Oct 2026 14 of 17
    certificates had lost their Drive file (`Drive.Files.remove` deletes for
    good, it does not trash).
32. **Telegram is a live collector** (Wan, 18 Oct 2026): `collectors/telegram`
    (bot, long polling), started on the WhatsApp VM by
    `collectors/cloud/add-telegram.sh` as pm2 `he-telegram`. It needs a bot
    token and the group id in `collectors/.env` (Wan creates the bot; never put
    the token in the repo). It checks in every 5 minutes as source `telegram`,
    `tickWatch` watches it once it has checked in once, and a message the Sheet
    refuses is kept in `state.json` and sent again. Rows are source `telegram`;
    the pipeline already reads them with WhatsApp.
