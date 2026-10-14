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
   Documents titles, Events and News. Unverified numbers are `[SAHKAN: …]`.
4. **Language.** Bahasa Malaysia, never Bahasa Indonesia: boleh not bisa,
   ubat not obat, syarikat not perusahaan, kualiti not kualitas,
   pembungkusan not kemasan. Regulatory terms stay original.
5. **News lives 72 hours.** `expires_at` is set once at fetch and never
   extended.
6. **Documents are never deleted from Drive.** Superseded versions move to
   `90 Archive`; duplicates are marked, not removed.
7. **One repository publishes this site**, this one, to
   `halalexecutive.kkmhalalconsultant.com`. Never connect it to a host that
   serves the repo root (the 05 Sep 2026 Cloudflare Pages exposure in
   malaysian-regulatory-affairs is why).
8. **Logo.** The JAKIM Halal Malaysia mark is a certification mark under the
   Trade Descriptions (Certification and Marking of Halal) Order 2011. The
   files are not committed; Wan drops them in `public/brand/` after clearing
   the use.
9. `kkm-targets`, Hermes, ws.regulab Studio and the KKM Complaints system are
   other repos. Do not recreate any of them here.
