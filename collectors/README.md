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

Settings for all three go in one file, `collectors/.env`. Copy
`collectors/.env.example` to `collectors/.env` and fill in:

```
HE_API_URL=https://script.google.com/macros/s/…/exec
HE_INGEST_TOKEN=…               # printed by setup() / showSecrets() in Apps Script
HE_GROUP_NAME=Halal Executive   # exact group title; `npm run groups` lists yours
```

WhatsApp uses Chrome or Edge already installed on the machine, so npm's
"install-scripts" warning about puppeteer can be ignored.

## Older WhatsApp messages: import the chat export

The live collector is a linked device, and a linked device only holds what
the phone has synced, often a few dozen recent messages. The full history
comes from WhatsApp's own export:

1. Phone: open the group → ⋮ (Android) or the group name (iPhone) → More →
   **Export chat** → **Include media**. Save or send the `.zip` to the PC.
2. PC: `cd collectors\whatsapp` then
   `npm run import -- "C:\Users\Muham\Downloads\WhatsApp Chat with HE Malaysia.zip"`

It reads the `.zip`, the unzipped folder, or the bare `.txt`. Photos, PDFs
and office files go to Drive with their message; voice notes and videos are
skipped. Running the same export twice adds nothing twice. WhatsApp caps an
export with media at about 10,000 recent messages (40,000 without media).
`HE_IMPORT_SINCE=2025-01-01` in `.env` limits the import to newer messages.

## Is the collector live?

While it runs, the WhatsApp collector checks in every 5 minutes. The site's
Overview → Collectors shows **Live** while check-ins arrive and **Offline · N
min** when they stop. If it says Offline, on the PC run `pm2 logs he-whatsapp`.
If WhatsApp logged the device out, the collector exits and pm2 restarts it;
when a QR code shows in the log, run `npm run groups` once in a window to scan
again.

## Dependency warnings

`npm install` reports high-severity warnings in `extract-zip`, pulled in by
puppeteer's browser downloader. No fixed version exists yet. The collector
never uses that downloader (it drives the Chrome or Edge already installed,
and npm blocks puppeteer's download step), so the vulnerable code does not run.
`basic-ftp` is pinned to a fixed version and `adm-zip` is on 0.6.

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
