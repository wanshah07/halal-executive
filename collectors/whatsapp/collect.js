// WhatsApp collector. Logs in once (QR in the terminal), keeps the session in
// .wwebjs_auth/, and streams every message from the group named
// HE_GROUP_NAME to the Sheet. --backfill reads the group history first.
//
//   npm install && npm run groups       (first time: scan QR, list exact names)
//   npm run backfill                    (read the history once)
//   npm start                           (then keep it running, e.g. under pm2)
//
// Settings come from collectors/.env: HE_API_URL, HE_INGEST_TOKEN,
// HE_GROUP_NAME (or HE_GROUP_ID, the ...@g.us id printed by `npm run groups`).
//
// Attachments ride along as base64 so Apps Script can drop them into Drive
// "00 Inbox/whatsapp". Big videos are skipped (> HE_MAX_MB).
//
// Why no client.getChats(): in whatsapp-web.js 1.34 it loads the metadata of
// EVERY group in one Promise.all, and a single group that fails to load
// rejects the whole call (seen on Wan's PC, 14 Oct 2026: "Error: r" from
// Client.getChats). Here the group list is read straight from WhatsApp Web's
// own chat collection, and messages are fetched for the one group only.
import pkg from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { ingest, post, browserPath } from '../lib.js'

const { Client, LocalAuth, Chat } = pkg
const GROUP = (process.env.HE_GROUP_NAME || 'Halal Executive').trim()
const GROUP_ID = (process.env.HE_GROUP_ID || '').trim()
const SALT = process.env.HE_SALT || 'halal-executive'
const MAX_MB = Number(process.env.HE_MAX_MB || 15)
const BACKFILL_LIMIT = Number(process.env.HE_BACKFILL_LIMIT || 5000)
const BACKFILL = process.argv.includes('--backfill')
const LIST = process.argv.includes('--list-groups')
const STATE = new URL('./state.json', import.meta.url)
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { lastTs: 0 }
const save = () => fs.writeFileSync(STATE, JSON.stringify(state))
const hash = (s) => crypto.createHash('sha256').update(SALT + String(s)).digest('hex').slice(0, 16)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Message and chat ids come back either as plain strings or as id objects,
// depending on the WhatsApp Web build. These always give a usable string.
const widStr = (w) => (!w ? '' : typeof w === 'string' ? w : w._serialized || (w.user && w.server ? `${w.user}@${w.server}` : ''))
const remoteOf = (m) => widStr(m.id && m.id.remote) || (m.fromMe ? widStr(m.to) : widStr(m.from))
const msgIdOf = (m) => {
  const id = m.id || {}
  return id._serialized || [id.fromMe ? 'true' : 'false', remoteOf(m), id.id, widStr(id.participant)].filter(Boolean).join('_')
}
const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

const exe = browserPath()
if (!exe) console.warn('No Chrome or Edge found. Install Google Chrome, or set HE_BROWSER in collectors/.env to a chrome.exe / msedge.exe path.')
else console.log('Browser:', exe)
// A small cloud server (1 GB) loads WhatsApp Web slowly; give the login and
// the first sync time instead of the library's short defaults.
const client = new Client({
  authStrategy: new LocalAuth(),
  authTimeoutMs: 180000,
  puppeteer: { headless: true, executablePath: exe, protocolTimeout: 300000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] },
})
// Progress after the QR is scanned, so a stall or a logout shows where it happened.
client.on('authenticated', () => console.log('Linked. Loading chats (a small server can take a few minutes)…'))
client.on('loading_screen', (pct, msg) => console.log(`Loading ${pct}% ${msg || ''}`))
client.on('change_state', (st) => console.log('State:', st))
client.on('qr', (qr) => { console.log('Scan with WhatsApp → Settings → Linked devices → Link a device'); qrcode.generate(qr, { small: true }) })
client.on('auth_failure', (m) => { console.error('Login failed:', m, '\nDelete the .wwebjs_auth folder and run again to get a new QR.'); process.exit(1) })
// WhatsApp logged this device out or the connection dropped: exit so pm2
// restarts the collector, which reconnects with the saved session.
client.on('disconnected', (reason) => {
  console.error('Disconnected:', reason)
  if (reason === 'LOGOUT') console.error('WhatsApp ended this linked session. On the phone, check Linked devices, then run again for a new QR.')
  process.exit(1)
})
process.on('unhandledRejection', (e) => console.error('Error:', e && (e.message || e)))

// Groups straight from WhatsApp Web's chat collection: id + title only, no
// per-group metadata fetch. Retries while the collection is still loading.
async function listGroups() {
  for (let i = 0; i < 12; i++) {
    const groups = await client.pupPage.evaluate(() => {
      const C = window.require('WAWebCollections').Chat
      return C.getModelsArray()
        .filter((c) => c && c.id && c.id.server === 'g.us')
        .map((c) => ({ id: c.id._serialized, name: c.formattedTitle || c.name || (c.groupMetadata && c.groupMetadata.subject) || '' }))
    }).catch(() => [])
    if (groups.length) return groups
    await sleep(5000)
  }
  return []
}

// Ask WhatsApp Web for older messages until it has no more. A linked device
// only holds what the phone has synced, and each request pulls the next
// page from the phone, so this keeps asking (with a pause) and stops after
// three empty answers in a row.
async function loadHistory(id) {
  const total = await client.pupPage.evaluate(async (id, limit) => {
    const chat = await window.WWebJS.getChat(id, { getAsModel: false })
    if (!chat) return -1
    try { const Cmd = window.require('WAWebCmd').Cmd; if (Cmd && Cmd.openChatBottom) await Cmd.openChatBottom({ chat }) } catch (e) { /* older builds */ }
    const load = window.require('WAWebChatLoadMessages').loadEarlierMsgs
    let empty = 0
    while (chat.msgs.getModelsArray().length < limit && empty < 3) {
      const got = await load({ chat }).catch(() => null)
      if (got && got.length) empty = 0; else { empty++; await new Promise((r) => setTimeout(r, 2500)) }
    }
    return chat.msgs.getModelsArray().length
  }, id, BACKFILL_LIMIT).catch((e) => { console.warn('History load stopped:', e.message); return null })
  if (total !== null) console.log(`WhatsApp Web now holds ${total} messages for this group.`)
}

async function toRow(m) {
  const row = { source: 'whatsapp', group: GROUP, msg_id: msgIdOf(m), sender_hash: hash(widStr(m.author) || widStr(m.from)), ts: new Date(m.timestamp * 1000).toISOString(), text: m.body || '', attachments: [] }
  if (m.hasMedia) {
    try {
      const media = await m.downloadMedia()
      if (media && media.data && (media.data.length * 0.75) / 1e6 <= MAX_MB) {
        const ext = (media.mimetype || 'application/bin').split('/')[1].split(';')[0]
        row.attachments.push({ name: media.filename || `${m.id.id}.${ext}`, mime: media.mimetype, b64: media.data, sha256: crypto.createHash('sha256').update(Buffer.from(media.data, 'base64')).digest('hex') })
      } else row.attachments.push({ name: media && media.filename, mime: media && media.mimetype, skipped: 'too large or unavailable' })
    } catch (e) { row.attachments.push({ error: String(e.message || e) }) }
  }
  return row
}

let groupId = GROUP_ID

client.on('ready', async () => {
  try {
    console.log('WhatsApp ready, reading your groups…')
    const groups = await listGroups()
    if (LIST) {
      console.log(`\n${groups.length} groups. Copy the name exactly into HE_GROUP_NAME (or the id into HE_GROUP_ID):\n`)
      groups.sort((a, b) => a.name.localeCompare(b.name)).forEach((g) => console.log(`  ${g.name}\n      ${g.id}`))
      await client.destroy(); process.exit(0)
    }
    if (!groupId) {
      const exact = groups.filter((g) => g.name === GROUP)
      const loose = exact.length ? exact : groups.filter((g) => norm(g.name) === norm(GROUP))
      if (loose.length !== 1) {
        console.error(loose.length ? `More than one group is called "${GROUP}". Put the right id in HE_GROUP_ID:` : `Group "${GROUP}" not found. Groups on this number:`)
        ;(loose.length ? loose : groups).forEach((g) => console.error(`  ${g.name}   ${g.id}`))
        await client.destroy(); process.exit(1)
      }
      groupId = loose[0].id
    }
    console.log(`Group: ${GROUP} (${groupId})`)

    if (BACKFILL) {
      // Chat built from the id alone: fetchMessages only needs the id, and
      // this skips the group-metadata load that crashed getChats.
      const chat = new Chat(client, { id: { _serialized: groupId }, formattedTitle: GROUP, isGroup: true })
      console.log(`Backfill: loading up to ${BACKFILL_LIMIT} messages (large groups take a few minutes)…`)
      await loadHistory(groupId)
      const msgs = await chat.fetchMessages({ limit: BACKFILL_LIMIT })
      const ids = new Set(msgs.map(msgIdOf))
      if (ids.size < msgs.length) console.warn(`Warning: ${msgs.length - ids.size} messages share an id; tell Claude.`)
      console.log(`Backfill: ${msgs.length} messages, sending to the Sheet in batches of 10`)
      let added = 0, skipped = 0, failed = 0
      for (let i = 0; i < msgs.length; i += 10) {
        const rows = []
        for (const m of msgs.slice(i, i + 10)) { try { rows.push(await toRow(m)) } catch (e) { failed++ } }
        try { const r = await ingest(rows); added += r.added; skipped += r.skipped } catch (e) { failed += rows.length; console.error('  batch failed:', e.message) }
        console.log(`  ${Math.min(i + 10, msgs.length)}/${msgs.length}  added ${added}  already there ${skipped}  failed ${failed}`)
      }
      state.lastTs = Date.now(); save()
      console.log(`Backfill done: ${added} new rows in the Raw tab.`)
      if (!process.argv.includes('--listen')) { await client.destroy(); process.exit(failed ? 1 : 0) }
    }
    // Heartbeat every 5 minutes: the site's Overview shows "WhatsApp: live"
    // while these arrive and "offline" when they stop.
    const beat = () => post('heartbeat', { source: 'whatsapp', group: GROUP, last_msg: state.lastTs ? new Date(state.lastTs).toISOString() : '', version: 'collector-2' })
      .catch((e) => console.error('heartbeat failed:', e.message || e))
    beat(); setInterval(beat, 5 * 60 * 1000)
    console.log('Listening for new messages… (Ctrl+C to stop)')
  } catch (e) {
    console.error('Stopped:', e && (e.message || e)); await client.destroy().catch(() => {}); process.exit(1)
  }
})

// Live messages: matched on the chat id carried by the message itself
// (m.id.remote), so no chat lookup is needed.
client.on('message_create', async (m) => {
  try {
    if (!groupId || remoteOf(m) !== groupId) return
    const r = await ingest([await toRow(m)])
    state.lastTs = Date.now(); save()
    console.log(new Date().toISOString(), 'saved', r.added ? 'new' : 'already there')
  } catch (e) { console.error('ingest failed', e.message || e) }
})

client.initialize()
