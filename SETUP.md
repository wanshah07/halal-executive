# Bring-up, in order

Twelve steps. The pipeline runs every 30 minutes for now (2 hours once stable). Nothing here needs a Google service account: the Apps Script
web app is the only door to the Sheet and Drive.

## 1. Sheet + Drive
1. Create a Google Sheet "Halal Executive". Extensions → Apps Script. Replace
   `Code.gs` with `apps-script/Code.gs`; set the manifest from
   `apps-script/appsscript.json` (Project Settings → show manifest). Enable
   the Drive advanced service (Services → Drive API v3) for OCR.
2. No Drive step: `setup()` in step 4 creates the "Halal Executive" folder.
3. Script properties (Project Settings → Script properties): add only
   `MIRELD_API_KEY` and `AFIQ_API_KEY`. Model properties are optional:
   leave them out (or write `auto`) and the model is picked from each
   gateway's own list and re-picked by itself if it is withdrawn.
4. Run `setup()` once. It creates the nine tabs, a Drive folder called
   "Halal Executive", and the `ADMIN_TOKEN`, `INGEST_TOKEN` and
   `DRIVE_ROOT_ID` properties, then prints all three in the execution log.
   `showSecrets()` prints them again; `listModels()` shows what auto picked.
   Then Deploy → New deployment → Web app → Execute as **Me**, access
   **Anyone**. Copy the `/exec` URL.
5. Triggers → add `purgeExpiredNews`, time-driven, hourly.

## 2. Page
6. Repository → Settings → Variables: `VITE_API_URL` (the /exec URL),
   `VITE_SHEET_URL`, `VITE_DRIVE_FOLDER_URL`. Settings → Pages → Source:
   GitHub Actions (the workflow cannot do this itself). Then Actions → "Deploy
   site" → Run workflow; the first run after enabling publishes the page.
7. DNS at the `kkmhalalconsultant.com` zone: `CNAME halalexecutive →
   wanshah07.github.io` (already pointing at GitHub on 14 Oct 2026). With the
   Actions source, Pages does NOT read `public/CNAME`: type
   `halalexecutive.kkmhalalconsultant.com` into Settings → Pages → Custom
   domain and Save, wait for the DNS check, then tick Enforce HTTPS. Until
   then the page is at https://wanshah07.github.io/halal-executive/ (the
   build uses relative paths, so it works at both).
8. Logo files are in `public/brand/` (from Wan's artwork, 14 Oct 2026). Replace
   them there if the artwork changes; nothing else references the path.

## 3. Pipeline
9. Repository secrets: `HE_API_URL`, `HE_INGEST_TOKEN`, `MIRELD_API_KEY`,
   `AFIQ_API_KEY`. Variables `MIRELD_MODEL` and `AFIQ_MODEL` are optional
   (empty = auto). The crons in
   `pipeline.yml` start on their own; run "Pipeline" by hand first with job
   `news` to see a green run and a row in the Runs tab.

## 4. Collectors (WhatsApp first)
10. On the machine that will stay on: `cd collectors/whatsapp && npm install`.
    Copy `collectors/.env.example` to `collectors/.env` and fill in
    `HE_API_URL`, `HE_INGEST_TOKEN` (from `showSecrets()`) and
    `HE_GROUP_NAME`. Run `npm run groups` (scan the QR with WhatsApp → Linked
    devices) to print the exact group names, fix `HE_GROUP_NAME` if needed,
    then `npm run backfill` (it stops by itself and prints how many rows went
    to the Raw tab), then keep `npm start` running under pm2. If a group name
    has odd characters, put its `…@g.us` id from `npm run groups` in
    `HE_GROUP_ID` instead.
10b. Older messages: export the chat from the phone with media and run
    `npm run import -- "<path to the .zip>"` (details in `collectors/README.md`).
11. Telegram: BotFather → new bot → `/setprivacy` Disable → add the bot to
    the group → `cd collectors/telegram && npm install && TELEGRAM_BOT_TOKEN=… npm start`.
12. Facebook: read `collectors/README.md` first. `cd collectors/facebook &&
    npm install && npm run login`, then a daily scheduled `npm start`.

## Admin uploads
Admin → **Add screenshots or files**: screenshots, PDF, Word, Excel,
PowerPoint or text (10 MB each), with a type (FAQ material, halal
certificate, guideline, event) and an optional note. Each file lands in the
Raw tab as source `manual` and in Drive `00 Inbox/manual`; the next pipeline
run reads its text (OCR for images and scans) and writes FAQ entries, or
files it as a certificate. Run Actions → Pipeline → `process_whatsapp` to do
it straight away.

## References library and questions
Admin → **References library**: upload a manual, standard or circular (PDF,
Word, Excel, PowerPoint, TXT, 25 MB). The next pipeline run (or Actions →
Pipeline → `references`) reads it page by page, scanned pages through OCR,
stores the passages in the `RefChunks` tab and writes a short summary. The
**References** tab then answers questions in Malay or English: plain answer,
details, and the exact pages, with any citation the AI invents dropped by the
server. Repeat questions come from a 6-hour memory. The passages stay in the
private Sheet; the public page only ever receives the answer and short quotes.

## Events
Admin → **Events**: add or edit an event with an optional poster (5 MB). The
poster is stored in Drive `30 Posters` and shared view-only by link so the
page can show it. Events the AI finds in the groups arrive as drafts.

## Admin sign-in
The Admin tab is locked. Enter a registered email, receive a 6-digit code
from your own Gmail (sent by the Apps Script), type it in. The session lasts
6 hours in that browser. `setup()` registers the Sheet owner's email; add or
remove others in Admin → Registered admin emails, or edit the
`ADMIN_EMAILS` script property. After pasting a new `Code.gs`, use Deploy →
Manage deployments → edit → Version: New version, so the same `/exec` URL
serves the new code, and run any function once to approve the email
permission.

## Checks
* Page shows "Google Sheet" (not "sample data") under Overview.
* Admin → Drafts to review: publish the FAQ the pipeline was unsure about.
* Admin → sign in with the code → save a notice → reload: popup appears,
  Settings tab updated.
* Runs tab alternates MIRELD / AFIQ; a forced failure (wrong key on one)
  shows the other answering with `fallback` in the log.
