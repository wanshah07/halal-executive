# The Sheet

One Google Sheet, nine tabs, created by `setup()` in `Code.gs`. Column order
is the contract between the page, the collectors and the pipeline; add
columns at the end only.

| Tab | Who writes | Who reads | Notes |
|---|---|---|---|
| `Raw` | collectors (`ingest`) | pipeline | one row per group message; `status` = new → processed / skipped |
| `FAQ` | pipeline (`upsert`), Wan by hand | page | `status` = draft / published / hidden; only published shows |
| `Guidelines` | pipeline, Wan by hand | page | same shape as the info sheet; `status` hidden removes a row |
| `Documents` | organiser | page | one row per file version; `status` current / archived |
| `Certificates` | organiser (from certificate documents), Wan by hand | page | holder, cert no, scheme, state, valid_from/valid_to, products (`;`-separated); `status` hidden removes a row; validity badge is computed on the page from `valid_to` |
| `Events` | Wan by hand, pipeline when a message is an event | page | |
| `News` | news sweep | page | `expires_at` = `fetched_at` + 72 h; purged by the sweep and by `purgeExpiredNews()` |
| `Settings` | Admin panel | page | key/value: hero_*, notice_*, posters (JSON array) |
| `Runs` | pipeline (`run_log`) | page (Overview) | which provider answered each run |

## Raw.attachments

JSON array. The collector sends `{name, mime, b64, sha256}`; `ingest` stores
the bytes in Drive `/Halal Executive/00 Inbox/<source>/` and keeps
`{name, mime, sha256, drive_file_id, drive_url}` in the cell.

## Drive layout

```
/Halal Executive
  00 Inbox/whatsapp|facebook|telegram    raw attachments as received
  10 Documents/halal|food|cosmetic       current versions: "2026-10-09 v2 Title.pdf"
  90 Archive/halal|food|cosmetic         superseded versions, same naming
```

Drive's own "Last modified" column is the visible update time; the organiser
also writes `updated_at` into `Documents` from the file's `modifiedTime`.

## Settings keys the page understands

`hero_title`, `hero_subtitle`, `hero_subtitle_bm`, `hero_image`, `hero_cta`,
`hero_cta_url`, `notice_enabled` (true/false), `notice_title`, `notice_body`,
`notice_body_bm`, `notice_level` (info/warning/danger), `notice_until`
(ISO date), `posters` (JSON: `[{title,url,link}]`).
