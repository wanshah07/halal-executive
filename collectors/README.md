# Collectors

Each collector reads one source and POSTs rows to the Apps Script `ingest`
action. The Sheet is the only thing they write to; everything downstream
(classification, FAQ, Drive filing) runs in `pipeline/`.

Order of work, as agreed: **WhatsApp first**, then Facebook and Telegram.

| Source | Mechanism | Where it runs | Cadence |
|---|---|---|---|
| WhatsApp group "Halal Executive" | `whatsapp-web.js` (WhatsApp Web session, QR once) | a machine that stays on: Wan's PC, a Render background worker with a persistent disk, or a small VPS | continuous; `--backfill` on first run reads the whole history |
| Telegram group "Halal Executive" | Telegram Bot API, long polling | same machine, or any runner | continuous |
| Facebook group "Halal Executive" | Playwright with Wan's own logged-in browser profile | Wan's PC only | once a day (24 h), runs until the feed is exhausted |

Common env for all three:

```
HE_API_URL=https://script.google.com/macros/s/…/exec
HE_INGEST_TOKEN=…               # Script Property INGEST_TOKEN
HE_GROUP_NAME=Halal Executive   # exact group / chat title
```

## Privacy

Sender identity is hashed (`sender_hash` = SHA-256 of the sender id with a
local salt) before it leaves the machine. Phone numbers are never stored.
Nothing in `Raw` is published: the page only shows `FAQ`, `Guidelines`,
`Documents`, `Events`, `News`, and the pipeline prompt strips names, company
names and private cases before an FAQ entry is written.

## Facebook: read this before running

Meta's Groups API no longer exposes group feeds to third-party apps, so the
only way to read the group programmatically is a browser session logged in
as a member. Automated browsing is against Facebook's Terms of Service and
the account used can be restricted. Run it only from Wan's own machine, with
Wan's own profile, once a day, and stop if Facebook shows a checkpoint. The
alternative that carries no account risk: a member downloads the group's
posts manually (Facebook → Your information → Download) and drops the
export into `collectors/facebook/exports/`; `collect.js --import <file>`
ingests it the same way.
