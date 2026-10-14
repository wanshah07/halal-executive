// WhatsApp collector. Logs in once (QR in the terminal), keeps the session in
// .wwebjs_auth/, and streams every message from the group named
// HE_GROUP_NAME to the Sheet. --backfill walks the group history first.
//
//   npm install && npm run backfill     (first time)
//   npm start                           (then keep it running)
//   npm run groups                      (print the exact names of your groups)
//
// Settings come from collectors/.env: HE_API_URL, HE_INGEST_TOKEN, HE_GROUP_NAME.
//
// Attachments ride along as base64 so Apps Script can drop them into Drive
// "00 Inbox/whatsapp". Big videos are skipped (> MAX_MB).
import pkg from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { ingest, browserPath } from '../lib.js'

const { Client, LocalAuth } = pkg
const GROUP = process.env.HE_GROUP_NAME || 'Halal Executive'
const SALT = process.env.HE_SALT || 'halal-executive'
const MAX_MB = Number(process.env.HE_MAX_MB || 15)
const BACKFILL = process.argv.includes('--backfill')
const LIST = process.argv.includes('--list-groups')
const STATE = new URL('./state.json', import.meta.url)
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { lastTs: 0 }
const save = () => fs.writeFileSync(STATE, JSON.stringify(state))
const hash = (s) => crypto.createHash('sha256').update(SALT + String(s)).digest('hex').slice(0, 16)

const exe = browserPath()
if (!exe) console.warn('No Chrome or Edge found. Install Google Chrome, or set HE_BROWSER in collectors/.env to a chrome.exe / msedge.exe path.')
else console.log('Browser:', exe)
const client = new Client({ authStrategy: new LocalAuth(), puppeteer: { headless: true, executablePath: exe, args: ['--no-sandbox'] } })
client.on('qr', (qr) => { console.log('Scan with WhatsApp → Linked devices'); qrcode.generate(qr, { small: true }) })

async function toRow(m) {
  const row = { source: 'whatsapp', group: GROUP, msg_id: m.id._serialized, sender_hash: hash(m.author || m.from), ts: new Date(m.timestamp * 1000).toISOString(), text: m.body || '', attachments: [] }
  if (m.hasMedia) {
    try {
      const media = await m.downloadMedia()
      if (media && media.data && (media.data.length * 0.75) / 1e6 <= MAX_MB) {
        row.attachments.push({ name: media.filename || `${m.id.id}.${(media.mimetype || 'bin').split('/')[1].split(';')[0]}`, mime: media.mimetype, b64: media.data, sha256: crypto.createHash('sha256').update(Buffer.from(media.data, 'base64')).digest('hex') })
      } else row.attachments.push({ name: media && media.filename, mime: media && media.mimetype, skipped: 'too large' })
    } catch (e) { row.attachments.push({ error: String(e.message || e) }) }
  }
  return row
}

client.on('ready', async () => {
  console.log('WhatsApp ready')
  const chats = await client.getChats()
  if (LIST) { console.log('Your groups (copy one exactly into HE_GROUP_NAME):'); chats.filter((c) => c.isGroup).forEach((c) => console.log('  ' + c.name)); process.exit(0) }
  const g = chats.find((c) => c.isGroup && c.name === GROUP)
  if (!g) { console.error(`Group "${GROUP}" not found. Groups seen:`, chats.filter((c) => c.isGroup).map((c) => c.name)); process.exit(1) }
  if (BACKFILL) {
    let limit = 200, msgs = []
    // fetchMessages grows the window until no more history arrives.
    for (;;) { msgs = await g.fetchMessages({ limit }); if (msgs.length < limit) break; limit += 200; if (limit > 20000) break }
    console.log(`Backfill: ${msgs.length} messages`)
    for (let i = 0; i < msgs.length; i += 10) {
      const rows = []
      for (const m of msgs.slice(i, i + 10)) rows.push(await toRow(m))
      const r = await ingest(rows); console.log(`  ${i + rows.length}/${msgs.length} added ${r.added} skipped ${r.skipped}`)
    }
    state.lastTs = Date.now(); save()
  }
  console.log('Listening…')
})

client.on('message_create', async (m) => {
  try {
    const chat = await m.getChat()
    if (!chat.isGroup || chat.name !== GROUP) return
    const r = await ingest([await toRow(m)])
    state.lastTs = Date.now(); save()
    console.log(new Date().toISOString(), 'ingest', r)
  } catch (e) { console.error('ingest failed', e.message || e) }
})

client.initialize()
