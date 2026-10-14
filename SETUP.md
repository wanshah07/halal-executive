# Bring-up, in order

Twelve steps. Nothing here needs a Google service account: the Apps Script
web app is the only door to the Sheet and Drive.

## 1. Sheet + Drive
1. Create a Google Sheet "Halal Executive". Extensions → Apps Script. Replace
   `Code.gs` with `apps-script/Code.gs`; set the manifest from
   `apps-script/appsscript.json` (Project Settings → show manifest). Enable
   the Drive advanced service (Services → Drive API v3) for OCR.
2. Create Drive folder "Halal Executive"; copy its folder id.
3. Script properties: `ADMIN_TOKEN`, `INGEST_TOKEN` (two long random
   strings), `DRIVE_ROOT_ID`, `MIRELD_API_KEY`, `MIRELD_MODEL`,
   `AFIQ_API_KEY`, `AFIQ_MODEL`. Run `listModels()` once and pick model ids
   from the log (AFIQ listed `glm-5.3`, `kimi-k3`, `deepseek-v4-pro` and
   others on 14 Oct 2026).
4. Run `setup()` once (creates tabs). Deploy → New deployment → Web app →
   Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
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
   `AFIQ_API_KEY`. Variables: `MIRELD_MODEL`, `AFIQ_MODEL`. The crons in
   `pipeline.yml` start on their own; run "Pipeline" by hand first with job
   `news` to see a green run and a row in the Runs tab.

## 4. Collectors (WhatsApp first)
10. On the machine that will stay on: `cd collectors/whatsapp && npm install`,
    export `HE_API_URL`, `HE_INGEST_TOKEN`, `HE_GROUP_NAME="Halal Executive"`,
    then `npm run backfill` (scan the QR with WhatsApp → Linked devices),
    then `npm start` under pm2 or a scheduled task so it restarts.
11. Telegram: BotFather → new bot → `/setprivacy` Disable → add the bot to
    the group → `cd collectors/telegram && npm install && TELEGRAM_BOT_TOKEN=… npm start`.
12. Facebook: read `collectors/README.md` first. `cd collectors/facebook &&
    npm install && npm run login`, then a daily scheduled `npm start`.

## Checks
* Page shows "Google Sheet" (not "sample data") under Overview.
* Admin → save a notice → reload: popup appears, Settings tab updated.
* Runs tab alternates MIRELD / AFIQ; a forced failure (wrong key on one)
  shows the other answering with `fallback` in the log.
