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
   breaking the site. Never add another provider without Wan (Wan added Wanshah 3,
   KIOS, as the image expert on 19 Oct 2026: rule 37; it is not part of this
   rotation), never mark a Raw row processed when every allowed provider failed.
3. **Nothing private is published.** `Raw` never reaches the page. Names,
   phone numbers, member company names and case details stay out of FAQ,
   Documents titles, Events and News. A fact the messages left unstated is
   written `[SAHKAN: <the exact missing fact>]`, a working note only:
   `pipeline/resolve_sahkan.py` fills it from the references library with
   the page cited (quote checked word for word, no new numbers) or takes it
   out and keeps it in `FAQ.verify_notes` for the admin. The page and
   `publicData()` never show a marker.
   **An open marker reaches the reader as a request, never as the marker**
   (Wan, 19 Oct 2026): in a long text field (answer, summary, description,
   details, scope, note) `noMarks` in Code.gs and `markText` in api.js take the
   marker out and add one sentence at the end, "Find the specific guideline and
   page that state this, then check it with the Assistant" (BM: "Cari garis
   panduan dan muka surat khusus ..."), with the marker's own words when they
   name the fact; in any other field the marker is just removed. The Assistant
   and References Q&A say what is missing and ask for the guideline and page;
   when the question names one ("MPPHM 2020 page 14", `pagePassages`) they check
   the statement against that page only, quoting at most 25 words, or say the
   guideline is not in the library.
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
   **Nothing is deleted automatically except finished events, expired
   certificates (rule 18) and closed vacancies (rule 38).** Superseded
   document versions move to `90 Archive`; duplicates are marked, not removed.
   Deleting for good (row + its Drive file) happens only through Admin's
   Delete button, which asks first (`adminDelete` in Code.gs). Finished
   events (a day after they end) and their uploaded posters are removed by
   `purgePastEvents` on the 30-minute timer (Wan, 14 Oct 2026), and so are AI
   draft events taken from a message more than 120 days old (Wan, 15 Oct 2026).
   "Removed" means deleted for good (Wan, 20 Oct 2026: "permanently deleted"):
   an uploaded poster goes through `removeDriveFile` (`Drive.Files.remove`,
   past the Drive bin), never `setTrashed`.
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
29. **Uploaded and published are NOT shown on public pages any more** (Wan,
    19 Oct 2026: "remove published & uploaded"); Updated stays, News keeps
    Fetched, Admin lists keep the stamps. The stamping below still runs.
    Original rule (18 Oct 2026): every item shows when it was uploaded and when it was published,
    Malaysia time. Code.gs stamps `created_at` once, when a
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
    **No group admin needed** (Wan, 18 Oct 2026): the bot also takes private
    messages and forwards from the ids in `TELEGRAM_ALLOWED_USERS` (Wan's own
    Telegram id; `npm run chats` prints it). A forward keeps its original group
    name and time; any other sender is told their id once and nothing is
    ingested. The third route is Telegram Desktop's export:
    `node collect.js --import <export folder>` sends the text and the photos and
    files (10 MB cap, batches under ~8 MB). Asking an admin to add the bot is
    still the only way to read the group live. Reading the group from a user
    account (MTProto) is not built: members would not see a bot, which is a
    consent question for Wan first.
34. **A halal certificate is never hidden** (Wan, 20 Oct 2026: "do not make halal
    cert hidden make sure all see on the site, unless it expired then delete it
    permanently"). `publicData` shows every certificate whose `valid_to` has not
    passed, whatever its status; `purgeExpiredCerts` puts any hidden or draft row
    back to `current` and deletes expired ones for good; `reviewSet` refuses to hide
    one; Admin has no Hide for certificates. A title-only row made for a document
    that is not a certificate is deleted, not hidden.
    **Halal certificates publish at once, from the group too** (Wan, 19 Oct 2026:
    certificates uploaded the day before did not show in Halal Certificates).
    `live_status` in `drive_organiser.py` returns `current` for any certificate
    (other group files still wait in Drafts); the sweep publishes certificate
    drafts left from before (an expired one stays out), and a certificate whose
    scan cannot be read gets a title-only row (holder from the title, notes
    "title-only") so it shows on its card instead of nowhere.
35. **Phones get a bottom tab bar** (Wan, 19 Oct 2026, like KKM Complaints):
    `BottomNav.jsx`, Overview, FAQ, Certificates, Events and More (the menu
    drawer), under 768 px only; the top icon bar and the hamburger are gone on
    phones (the hamburger stays for tablets). The Assistant button sits above
    the bar. Long unbroken text (file names, references) wraps with
    `[overflow-wrap:anywhere]` on cards; a Playwright sweep at 360/390/430 px
    with long tokens injected into every title must report no horizontal overflow.
36. **The globe never stops, and the filter buttons are organised** (Wan, 19 Oct 2026).
    `Globe` restarts only when the pins or the facing really change (keyed by
    content; a new array each render used to restart it, and the cleanup lost the
    GL context, so after a language switch or refresh, and on phones, it stood
    still), keeps its turn angle across restarts, rebuilds after
    `webglcontextrestored`, restarts a stalled frame loop and turns at a quarter
    speed (not frozen) under reduced motion. Filter rows use `.toolbar` and
    `.seg` (index.css): full-width, equal rows on phones. FHCB countries are one
    sideways-scrolling row (All plus the ten largest and the chosen one) with
    "All countries (n)" opening the full A to Z list. The organiser also files a
    document called a certificate whose title says otherwise (announcement,
    booklet) under its real kind and hides any title-only row made for it.
37. **Wanshah 3 (KIOS, https://kiosapi.com/v1) is the image expert, not a text provider**
    (Wan, 19 Oct 2026). Key: Script Property `KIOS_API_KEY` only (no GitHub secret:
    the pipeline reaches it through Code.gs `vision_read`). It is a separate table
    (`IMAGE_AI` in Code.gs), never in `PROVIDERS`, never in the automatic rotation
    or the handover, and cannot be pinned for answers. It does two jobs: reads a
    picture (`vision_read`: the organiser sends a certificate whose OCR text is
    unusable, a scanned PDF through its 1600 px preview; `read_cert_image`; one
    `ping` per run, so nothing else is asked while there is no key; a title-only
    row is tried once more and marked `vision-tried` when it still fails) and
    makes a test picture (Admin -> Wanshah 3 -> Test; the studio is gone, see below). Models come from
    its `/models` (image ids vs the rest); Admin's choice is Settings
    `llm_vision_KIOS` / `llm_image_KIOS`. Admin actions: `img_config`,
    `img_config_save`, `img_test`. Its robot card (W3, purple)
    shows Reads / Makes and is hidden when Code.gs is too old to report it.
    **Image studio removed** (Wan, 19 Oct 2026): no prompt box, no reference picture, no
    `image_generate` route, nothing saved to Drive `60 Generated`. What stays is the
    Admin card (models, tests) and `kiosGenerate`, used only by the image test.
    **Video studio removed too** (Wan, 20 Oct 2026: "remove video studio in
    admin"): no `video_generate` / `video_status` routes, no `kiosVideo*`, no
    panel. Admin makes nothing any more; Wanshah 3 reads pictures and makes one
    test picture.
    **The AI team card is split** (Wan, 19 Oct 2026): the public Overview shows each
    robot with its name and status only (`AiTeam compact`); Admin shows the full card
    (models, last work, response, average, answer rate, base URL) above the AI model
    pickers. **In Admin the three robots and both settings panels are ONE box**
    (Wan, 20 Oct 2026: "put 3 robot into 1 box, read, write, read image"): `AiTeam`,
    `AiModelAdmin` and `ImageAiAdmin` take `embedded` and sit in one card. Every robot
    card, Overview included, carries its jobs as chips (`Caps`): Wanshah 1 and 2
    Read · Write · Read image (the last from the picture test: ✓, ✗ or ?), Wanshah 3
    Read image · Make image.
    **Every Wanshah is a CSS 3D robot** (`Robot3D.jsx`, `.r3-*` in index.css: boxes
    in `preserve-3d`, no library; see "All three Wanshah are 3D robots" below —
    Wanshah 3 was the only box until 19 Oct 2026). **Response rate
    on every AI's base URL** (Wan, 19 Oct 2026): each status check pings the AI's
    own `/models`, `pingNote` keeps the last 48 results per AI in Script
    Properties (`ping_<NAME>`), the status carries `host`, `ms`, `avg_ms`,
    `best_ms`, `ok_rate`, `pings`, and the robot cards show them; `tickWatch`
    re-checks every 10 minutes so the history does not need visitors. The status
    cache key is versioned (`AI_STATUS_KEY`): bump it when the shape changes, or
    a fresh deploy serves the old shape for 5 minutes (Wanshah 3 was missing
    for that reason right after its first deploy). Admin has "Check read · write
    · text": a picture read, a picture made and a plain-text exchange, each with
    its HTTP code and time.
    **Measured on Wan's key (19 Oct 2026): making pictures works** (`gpt-image-2`,
    27 s, HTTP 200, a 1 MB png) **and the gateway lists no chat or vision model**, so
    reading pictures and text there answers `NO MODEL` (the card says so and lists
    what is offered; `visionRead` `ping` reports not ready, so the organiser does not
    call it). Image reading for certificates therefore stays with OCR until a model
    that reads pictures exists on some gateway. A reference picture (png, jpg, webp,
    up to 4 MB) goes to `/images/edits` as multipart: "change this picture as I
    describe". Do not assume a gateway has chat models: read `/models` first.
    **Live evidence (19 Oct 2026, 15:48 UTC): Wanshah 3 read a picture.** The TIPAROS
    certificate row became `KIOS:gpt-5.6-sol full-read` (holder, number, issuer, validity
    filled), so its gateway does list a reading model now: do not treat the earlier
    "image models only" answer as permanent (`kiosModel` reads `/models` each time).
    **A text AI is only asked to read a picture after it passed the picture test**
    (`canSee`, verdict in Script Property `vision_ok_<NAME>`, 7 days; only "answered
    without seeing it" is remembered as a no, an outage is not). A model that cannot
    see invents an answer, and an invented certificate must never reach the page. The
    status carries `sees` (true / false / null = not tested) per AI and Admin's full
    card shows it as "Reads pictures". Wanshah 2 could not be reached from a session
    (`api.mireld.my/v1/models` answers 401 without a key); its verdict comes from the
    first picture the pipeline reads or the Admin button.
    **Wanshah 1 and 2 read pictures** (tested 19 Oct 2026 through the rootsys.cloud
    connection: all 22 Wanshah 1 models read a fresh picture's words, number and
    shape back correctly; a control without a picture made `glm-5.3` say no image
    was attached, but `deepseek-v4-pro` invented a sign, so prefer `glm-5.3`, never
    trust a reading that was asked of a text model with no picture; the gateway
    limits to 30 requests a minute). `visionRead` therefore picks the reader:
    Wanshah 3 if its gateway lists a model that reads, else Wanshah 1 or 2 (the
    pinned or faster first, the other as handover; `visionOrder`, `textVision`).
    Each AI card in Admin has "Test picture reading": a small picture with
    "SIJIL 7391" in it, and the answer must contain 7391 (`llmTest` `vision`;
    an AI that answers without seeing it fails with `CANNOT READ`). Wanshah 2
    (api.mireld.my) could not be reached from a session: press its test in Admin.
    The generate path follows the OpenAI image shape (retries without
    `response_format`, follows a returned link); the vision and text paths were
    only run against a fake gateway.
    Untested against the real gateway until the key is in: the code follows the
    OpenAI image and vision shapes and was run against a fake one (retries
    without `response_format`, follows a returned link).
    **Poster generation was built and is HELD, because two sessions were given
    opposite instructions inside ten minutes** (19 Oct 2026). Wan asked this
    session to "connect it to all relevant segments such as kanvas", and named
    three: the Image studio, Canva, and the event/notice posters. `PosterGen.jsx`
    did the third — **Make one with Wanshah 3** beside all three poster uploads
    (Events edit form, popup `notice_posters` square, Admin's Event posters) —
    and **added no server action, which was its whole design**: `image_generate`
    already returned a data URI and `poster_upload` already took base64, so a
    generated poster reached Drive by exactly the route an uploaded one does and
    was the same kind of thing afterwards (same folder, url, `poster_file`,
    thumbnail, purge rules). That design is also what killed it: **another session
    removed the `image_generate` route seven minutes later**, on Wan's own
    instruction (the "Image studio removed" note above, `9cd4c40`, Sonnet 5.5
    `session_01NqPM77UEMoDz4gSMZcN2VK`), so all three buttons would have called a
    route that no longer exists.
    It was removed from the merge rather than re-added, and the rule is the one
    worth keeping: **a session does not resurrect what another session deleted on
    Wan's say-so, and does not ship a control wired to nothing either.** Those are
    the only two options once the route is gone, and both are wrong, so the work
    is parked in commit `e79ad1e` and comes back as a cherry-pick plus a
    three-line route the day Wan wants it. Picture-making itself still works on
    the gateway (`gpt-image-2`, 27 s, 1 MB png), so what is missing is the route
    and the buttons, not the capability. The failure this avoids is the one this
    file already catalogues four times over — a tickbox, a config field, a
    Background select and an `attach to LinkedIn` box, each wired to nothing.
    **Canva is NOT connected and cannot be with a key alone.** Pushing to Canva
    needs a registered Canva developer app and an OAuth round trip (Connect API
    `/v1/asset-uploads`), not a bearer token, so it is Wan's setup before it is
    anyone's code. The working path today needs no code at all: generated posters
    and clips land in Drive `60 Generated`, and Canva imports from Google Drive.
    **All three Wanshah are 3D robots now** (Wan, 19 Oct 2026, "I want add all 3D
    robot as wanshah"). `Robot3D.jsx` took a hard-coded purple, so Wanshah 3 was
    the only one that could be a box; it takes a `tone` now and the palette moved
    to `src/lib/robots.js`, where `shadeFor` derives the six box faces from the
    SAME three shell stops the SVG gradient already used. A tone is therefore
    defined once and the two renderers cannot disagree about what colour an AI is.
    The fractions in `shadeFor` were fitted to the shipped purple, which comes back
    within 1-4 points per channel, so Wanshah 3 did not change. `.r3-visor` and
    `.r3-badge` still carry purple in index.css: that is a default only, the
    component sets the tone's own glass inline. `Robot.jsx` (the flat SVG) is kept
    and still reads the same palette, but `AiTeam` no longer uses it.
33. **Google being busy must never reach the reader as an error** (Wan, 18 Oct
    2026: "Sheet feed 404", AI model "HTTP 404", Progress and Drafts stuck on
    Loading). Apps Script answers with Google's HTML "Page Not Found" (HTTP 404,
    or a 5xx page) when too many runs overlap, and the Admin page opens a dozen
    boxes at once. Page (`api.js`): at most 3 calls in flight (`gate`); a reply
    that is not JSON, or is 404/429/5xx, is asked again after 1.5 s and 4 s, for
    reads only (`READ_ACTIONS`, `GET` feed/status/settings/thumb): an action that
    writes is sent once and says "Google is busy (HTTP 404)". When the feed
    stays down the saved copy is shown with no banner and the page asks again
    every 30 s, 6 times. Code.gs: the public feed is built by one run at a time
    (`building` flag in the cache; the others wait up to 15 s for that copy);
    `cert_files` and `llm_models` are cached 5 minutes (`fresh` bypasses it;
    saving the AI choice or any Sheet write drops them). Do not add a box to
    Admin that loads something heavy without going through `post()`.
38. **Halal Vacancies** (Wan, 20 Oct 2026: "add halal vacancy segment, can be
    uploaded manually in admin or read via whatsapp and telegram, AI can read all
    details without fail, add disclaimer that we not belong to the job ads").
    Sheet tab `Vacancies` (columns in `TABS`), page `pages/Vacancies.jsx`,
    `#vacancies`. **The page always opens with the notice that the Hub is not the
    employer, not an agent and not connected to any listed company, and that no
    one should pay to apply.** Keep it.
    Three ways in: Admin → Halal vacancies (`VacanciesAdmin`; choosing the ad runs
    `vacancy_from_poster`, which fills the form; several jobs in one ad are added
    one at a time with Next job), Admin upload kind "Job vacancy", and the group
    messages (WhatsApp, Telegram). **Every ad is read twice if needed, never once**
    (`read_vacancy` in process_raw.py, `vacancyFromPoster` in Code.gs, one prompt,
    `VACANCY_READ` in prompts.py and Code.gs, keep them the same): the words first
    (message text plus the OCR of its attachments), then, when the job title or every
    way to apply is still empty, the picture itself through `visionRead`, which fills
    only the empty fields. A group ad is caught when the batch reply lists it OR its
    words match `VAC_TEXT` (vacancy, jawatan kosong, hiring, send CV ...), so a
    missed batch entry does not lose it. Group ads (WhatsApp, Telegram) publish at
    once like Admin rows (Wan, 20 Oct 2026: "make sure telegram can read and
    appear"); Admin can hide one. **Rule 3 has one exception here, and only here:** the employer and the
    apply link, email or phone ARE kept when the ad itself prints them as the way to
    apply; the number or name of whoever forwarded the ad never is.
    Same job at the same employer is skipped (`seen_vacancies`). An ad already past
    its closing date is never listed. **A vacancy is deleted for good a day after
    `closing_date`, or 60 days after it was added when it has none**
    (`vacancyOver`, `purgeClosedVacancies` on the 30-minute timer, through
    `adminDelete`, so its poster goes too). An older Code.gs (no `Vacancies` tab)
    makes the pipeline skip vacancies rather than fail.
39. **Sub-menus and boxes** (Wan, 20 Oct 2026). The sidebar's `SUBNAV`
    (Sidebar.jsx) gives FAQ, Certificates, Guidelines, Vacancies, Documents and
    News a sub-menu by category, Events one by training type and Directory its
    three sections. A sub-menu drops open by itself on the page you are on, and
    on hover or keyboard focus (CSS grid-rows 0fr → 1fr, no JS). Each opens
    `#page/<sub>`, which the page reads as its first filter (`sub` prop). The
    sidebar says "Certificates" (`nav_certs`) so the label fits beside its arrow.
    **Every card has a top box like an event's poster** ("all segments got their
    own box same like event"): pages with no picture of their own (FAQ,
    Guidelines, News, a vacancy without a poster) draw `Cover.jsx`, the
    segment's icon on the category colour with a short label.
40. **The thinking orb on References** (`components/ui/ai-thiking-orb-and-input.tsx`,
    Wan, 20 Oct 2026, a pasted shadcn component). The project already had the
    shadcn layout (`components.json`, `@/` alias, `src/components/ui`), Tailwind 4
    and TypeScript, so it went in as supplied with four marked changes: a `copy`
    prop (labels in the page language), the stage measures its own box instead of
    the window (it sits in a page, not full screen), a larger answer card, and
    `autoFocus={false}` so a phone does not open its keyboard on arrival. **Only its
    keyframes came with it**: the `.mo-*` styles at the end of `index.css` were
    written to the contract its runtime drives (CSS variables on `.mo-actor`,
    `.mo-status`, `.mo-root`; transforms set by the JS). `tw-animate-css` is not
    needed and not installed. The orb's card shows a short answer (38 words); the
    full answer, details and cited pages render in the card below it as before.
    **Second round, 20 Oct 2026** (Wan: "only dark answer ... full answer, not cut
    off, remove dark background but make the orb functioning and rotate motion in
    mobile, fold the references library"). There is ONE answer place: the orb's
    card. It grows to its whole content (`growToAnswer` measures `.mo-answer`
    and the stage grows with it), and `extra` puts the detail, the sources and who
    answered inside it; the old white answer card below is gone. The stage has no
    dark background; the dots are dark green. The orb waits above the pill turning
    slowly while idle (`--home` lifts it to the stage centre) and still turns, at a
    quarter speed, under reduced motion. Suggested questions go through the orb
    (`seed` prop). The library is folded (`<details>`).
41. **Priority Wanshah 1 > Wanshah 3 > Wanshah 2** (Wan, 20 Oct 2026). Robot cards
    are shown in that order, and `visionOrder` asks for a picture reading in that
    order (each text AI still only after it passed the picture test). Text answers
    keep the automatic speed choice (rule 2); pin Wanshah 1 in Admin → AI model to
    make it lead text too.
42. **Pictures from WhatsApp and Telegram are read by the AI** (Wan, 20 Oct 2026:
    "make sure the whatsapp and telegram can read image from the sources, read by
    AI and automation appear in website"). `message_for_model` sends a picture or
    PDF whose OCR gave under 120 characters to `vision_read` (`picture_text`,
    `PIC_READ`: copy every printed word, then say what the picture is), at most
    `PIC_MAX` (30) a run, and adds the words to the attachment's content, so a
    poster, a vacancy ad or a photographed circular reaches the model as text.
    The vacancy prompt now insists the title is the position, never a slogan like
    "We are hiring", takes the employer from the logo or email domain when no name
    is printed, and gives requirements as lines (a list is joined, not printed as
    `['...']`).
