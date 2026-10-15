# Standing rules for halal-executive

1. **The Sheet is the database.** Every write goes through
   `apps-script/Code.gs`. Do not add a second writer (no gspread, no direct
   Drive API) and do not change `TABS` column order; append columns only.
2. **Two providers, auto-selected by speed.** MIRELD and AFIQ cover each
   other on any failure (`pipeline/llm_router.py`, `complete()` in Code.gs).
   Each call's time is recorded per provider; once both have 3 timed calls
   the faster one leads 4 calls in 5 and the other keeps 1 in 5 so the lead
   can change by itself (Wan, 14 Oct 2026). Never hard-code one, never add a
   third without Wan, never mark a Raw row processed when both failed.
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
   lands in Admin → Drafts (`from:group`); Admin uploads publish at once. An
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
