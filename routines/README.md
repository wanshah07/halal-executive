# Routines (Claude) as the alternative scheduler

GitHub Actions (`.github/workflows/pipeline.yml`) is the primary scheduler.
These prompts let a Claude Routine run the same jobs when a runner cannot
reach a provider (argus CLAUDE.md, 19 Sep 2026: `api.mireld.my` does not
answer GitHub runners; it does answer a Claude session). A Routine fired into
a session with this repo checked out runs the Python the same way, with the
secrets in the environment.

| Routine | Cron (MYT) | Prompt |
|---|---|---|
| WhatsApp + Telegram pass | every 30 min, :10 and :40 | `process-3h.md` |
| Facebook pass | daily 02:40 | `process-facebook.md` |
| News sweep | every 6 h, :25 | `news.md` |
| Drive organiser | daily 03:50 | `organise.md` |

Both schedulers can be on at once: the Apps Script lock serialises writes and
the Raw `status` column means a message is never processed twice.
