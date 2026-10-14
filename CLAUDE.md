# Standing rules for halal-executive

1. **The Sheet is the database.** Every write goes through
   `apps-script/Code.gs`. Do not add a second writer (no gspread, no direct
   Drive API) and do not change `TABS` column order; append columns only.
2. **Two providers, auto-selected.** MIRELD and AFIQ alternate per call with
   mutual fallback (`pipeline/llm_router.py`, `complete()` in Code.gs). Never
   hard-code one, never add a third without Wan, never mark a Raw row
   processed when both failed.
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
6. **Nothing is deleted automatically except finished events.** Superseded
   document versions move to `90 Archive`; duplicates are marked, not removed.
   Deleting for good (row + its Drive file) happens only through Admin's
   Delete button, which asks first (`adminDelete` in Code.gs). Finished
   events (a day after they end) and their uploaded posters are removed by
   `purgePastEvents` on the 30-minute timer (Wan, 14 Oct 2026).
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
