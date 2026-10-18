// Telegram collector. Create a bot with @BotFather, turn privacy mode OFF
// (/setprivacy -> Disable) so it sees every group message, add it to the
// "Halal Executive" group, then:
//
//   npm run chats     lists the groups the bot can see, with their ids
//   npm start         listens and sends every new message to the Sheet
//
// The Bot API only delivers messages from the moment the bot joins; for
// history, export the chat from Telegram Desktop (JSON) and run
//   node collect.js --import result.json
//
// Settings (collectors/.env): TELEGRAM_BOT_TOKEN, and either TELEGRAM_CHAT_ID
// (the id from `npm run chats`, which wins) or HE_GROUP_NAME (the exact title).
//
// No admin rights in the group? Two ways in that need none:
//   - Direct: send or forward messages, photos and files to the bot in a private
//     chat. Only the Telegram ids in TELEGRAM_ALLOWED_USERS are accepted (anyone
//     else is told their own id and nothing is kept), and a forwarded message
//     keeps its original time. `npm run chats` shows your id.
//   - Export: Telegram Desktop -> the group -> Export chat history (JSON, with
//     photos and files), then  node collect.js --import <folder or result.json>
//
// Like the WhatsApp collector it checks in every 5 minutes (the Overview shows
// Telegram as Live, and the watchdog emails the admins when the beats stop),
// and a message the Sheet could not take is kept on disk and sent again, so a
// Google outage loses nothing.
import TelegramBot from 'node-telegram-bot-api'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ingest, post } from '../lib.js'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const GROUP = process.env.HE_GROUP_NAME || 'Halal Executive'
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim()
const ALLOWED = String(process.env.TELEGRAM_ALLOWED_USERS || '').split(/[,\s]+/).filter(Boolean)
const SALT = process.env.HE_SALT || 'halal-executive'
const MAX_FILE = 10 * 1024 * 1024 // same ceiling as Admin uploads; a bigger file is noted, not sent
const MAX_OUTBOX = 300
const STATE = new URL('./state.json', import.meta.url)
const hash = (s) => crypto.createHash('sha256').update(SALT + String(s)).digest('hex').slice(0, 16)
const botOpts = (polling) => ({ polling, ...(process.env.TELEGRAM_API_BASE ? { baseApiUrl: process.env.TELEGRAM_API_BASE } : {}) })
const isOurs = (c) => !!c && ['group', 'supergroup'].includes(c.type) && (CHAT_ID ? String(c.id) === CHAT_ID : String(c.title || '').trim().toLowerCase() === GROUP.trim().toLowerCase())

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain' }
const flat = (t) => (Array.isArray(t) ? t.map((x) => (typeof x === 'string' ? x : x.text)).join('') : t || '')
const imp = process.argv.indexOf('--import')
if (imp > 0) {
  // The path may be the export folder or its result.json; photos and files sit
  // beside it in the folders Telegram Desktop wrote (photos/, files/).
  let file = process.argv[imp + 1]
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'result.json')
  const dir = path.dirname(file)
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  let withFile = 0, skipped = 0
  const rows = (j.messages || []).filter((m) => m.type === 'message').map((m) => {
    const row = { source: 'telegram', group: j.name || GROUP, msg_id: String(m.id), sender_hash: hash(m.from_id), ts: new Date(m.date).toISOString(), text: flat(m.text), attachments: [] }
    const rel = m.photo || m.file
    if (rel && typeof rel === 'string' && !rel.startsWith('(')) {
      const name = m.file_name || path.basename(rel), full = path.join(dir, rel)
      const mime = m.mime_type || (m.photo ? 'image/jpeg' : MIME[name.split('.').pop().toLowerCase()] || '')
      try {
        const size = fs.statSync(full).size
        if (size > MAX_FILE) { row.attachments.push({ name, mime, note: `file over ${MAX_FILE / 1048576} MB, not sent; re-share it in Admin` }); skipped++ }
        else { const buf = fs.readFileSync(full); row.attachments.push({ name, mime, b64: buf.toString('base64'), sha256: crypto.createHash('sha256').update(buf).digest('hex') }); withFile++ }
      } catch { row.attachments.push({ name, mime, note: 'the export did not include this file (export with photos and files ticked)' }); skipped++ }
    } else if (rel) { row.attachments.push({ name: m.file_name || String(rel), mime: m.mime_type || '', note: 'the export did not include this file (export with photos and files ticked)' }); skipped++ }
    return row
  }).filter((r) => r.text || r.attachments.length)
  // Rows with files are sent in small batches: a batch stays under ~8 MB.
  let batch = [], bytes = 0, sent = 0
  const go = async () => { if (batch.length) { console.log(await ingest(batch)); sent += batch.length; batch = []; bytes = 0 } }
  for (const r of rows) {
    const b = r.attachments.reduce((n, a) => n + (a.b64 ? a.b64.length : 0), 0)
    if (batch.length >= 25 || (batch.length && bytes + b > 8e6)) await go()
    batch.push(r); bytes += b
  }
  await go()
  console.log(`Imported ${sent} message(s): ${withFile} with their file, ${skipped} file(s) skipped.`)
  process.exit(0)
}

if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN is missing. Put it in collectors/.env (see .env.example).'); process.exit(1) }

// npm run chats: every group the bot has been shown a message from, with its id.
if (process.argv.includes('--chats')) {
  const bot = new TelegramBot(TOKEN, botOpts(false))
  const me = await bot.getMe()
  const seen = new Map()
  for (const u of await bot.getUpdates({ timeout: 0, limit: 100 })) {
    const m = u.message || u.edited_message || u.my_chat_member
    const c = m && m.chat
    if (c) seen.set(c.id, c)
  }
  console.log(`Bot @${me.username} can see ${seen.size} chat(s):`)
  for (const c of seen.values()) console.log(`  ${String(c.id).padEnd(16)} ${c.type.padEnd(11)} ${c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || ''}${isOurs(c) ? '   <- this is the group the collector will read' : ''}${c.type === 'private' ? `   <- a person: this number is their Telegram id${ALLOWED.includes(String(c.id)) ? ' (allowed)' : ''}` : ''}`)
  if (!seen.size) console.log('  none yet. Add the bot to the group, turn privacy mode off (BotFather: /setprivacy -> Disable), send any message in the group, then run this again.')
  process.exit(0)
}

// ---- the outbox: rows the Sheet could not take yet ----
let state = { outbox: [], lastTs: '' }
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) } } catch { /* first run */ }
const save = () => { try { fs.writeFileSync(STATE, JSON.stringify(state)) } catch (e) { console.error('state not saved:', e.message || e) } }
let flushing = false
async function flush() {
  if (flushing || !state.outbox.length) return
  flushing = true
  try {
    while (state.outbox.length) {
      const batch = state.outbox.slice(0, 5)
      await ingest(batch)
      state.outbox.splice(0, batch.length); save()
      console.log(new Date().toISOString(), `outbox: sent ${batch.length}, ${state.outbox.length} left`)
    }
  } catch (e) { console.error('outbox still waiting:', e.message || e) } finally { flushing = false }
}
async function send(row) {
  try { console.log(new Date().toISOString(), await ingest([row])); state.lastTs = row.ts; save(); flush() }
  catch (e) {
    console.error('ingest failed, kept for another try:', e.message || e)
    state.outbox.push(row); if (state.outbox.length > MAX_OUTBOX) state.outbox.shift(); save()
  }
}

const bot = new TelegramBot(TOKEN, botOpts(false))
let me
try { me = await bot.getMe() } catch (e) { console.error('Telegram refused the token:', e.message || e); process.exit(1) }
await bot.deleteWebHook().catch(() => {}) // polling and a webhook cannot both be on
if (CHAT_ID) {
  await bot.getChat(CHAT_ID).then((c) => console.log(`Reading "${c.title}" (${c.id})`)).catch((e) => console.error(`The bot cannot see chat ${CHAT_ID} (${e.message || e}). Add it to the group first.`))
} else console.log(`Reading the group titled "${GROUP}". Set TELEGRAM_CHAT_ID (npm run chats) to pin it by id.`)
bot.startPolling()
console.log(`Telegram polling as @${me.username}…`)

let pollErrors = 0
bot.on('polling_error', (e) => {
  pollErrors++
  const msg = String((e && e.message) || e)
  if (/409/.test(msg)) console.error('Another copy of this bot is polling (409). Stop the other one: pm2 delete he-telegram on the old machine.')
  else console.error('polling error:', msg.slice(0, 200))
})

// Where a forwarded message came from, and when it was first sent.
const origin = (m) => {
  const o = m.forward_origin || {}
  const when = o.date || m.forward_date
  const chat = (o.chat && o.chat.title) || (m.forward_from_chat && m.forward_from_chat.title) || ''
  const who = (o.sender_user && o.sender_user.id) || (m.forward_from && m.forward_from.id) || o.sender_user_name || m.forward_sender_name || ''
  return { when, chat, who }
}
const told = new Set()
bot.on('message', async (m) => {
  try {
    const direct = m.chat && m.chat.type === 'private'
    if (!isOurs(m.chat) && !direct) return
    if (direct) {
      // A private chat is an inbox for the people in TELEGRAM_ALLOWED_USERS. Anyone
      // else is told their own id and nothing they send is kept.
      if (!ALLOWED.includes(String(m.from && m.from.id))) {
        if (m.from && !told.has(m.from.id)) { told.add(m.from.id); bot.sendMessage(m.chat.id, `This bot only takes files from its owner. Your Telegram id is ${m.from.id}. Give it to the owner if you should be allowed.`).catch(() => {}) }
        return
      }
      if (m.text && m.text.startsWith('/')) { bot.sendMessage(m.chat.id, 'Send or forward a message, photo or file here and it goes to the Halal Executive Hub.').catch(() => {}); return }
    }
    const o = direct ? origin(m) : {}
    const row = { source: 'telegram', group: direct ? (o.chat || 'Telegram (sent to the bot)') : m.chat.title, msg_id: `${m.chat.id}:${m.message_id}`, sender_hash: hash(direct && o.who ? o.who : m.from && m.from.id), ts: new Date((direct && o.when ? o.when : m.date) * 1000).toISOString(), text: m.text || m.caption || '', attachments: [] }
    const doc = m.document || (m.photo && m.photo[m.photo.length - 1])
    if (doc) {
      const name = doc.file_name || `${doc.file_unique_id}.jpg`, mime = doc.mime_type || 'image/jpeg'
      if (doc.file_size && doc.file_size > MAX_FILE) row.attachments.push({ name, mime, note: `file over ${MAX_FILE / 1048576} MB, not sent; re-share it in Admin` })
      else {
        try {
          const link = await bot.getFileLink(doc.file_id)
          const res = await fetch(link)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          row.attachments.push({ name, mime, b64: buf.toString('base64'), sha256: crypto.createHash('sha256').update(buf).digest('hex') })
        } catch (e) { console.error(`file ${name} not downloaded:`, e.message || e); row.attachments.push({ name, mime, note: 'could not be downloaded' }) }
      }
    }
    if (!row.text && !row.attachments.length) return // a join notice, a pin, a sticker
    await send(row)
    if (direct) bot.sendMessage(m.chat.id, `Received${row.attachments.length ? ` with ${row.attachments.length} file` : ''}. It is read in the next run (within about 30 minutes).`).catch(() => {})
  } catch (e) { console.error('message not handled:', e.message || e) }
})

// Check in every 5 minutes. Two failed checks in a row: exit, and pm2 starts a
// fresh copy. The watchdog in Apps Script emails the admins when beats stop.
let bad = 0
const beat = async () => {
  let st = 'CONNECTED'
  try { await Promise.race([bot.getMe(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))]) } catch { st = 'UNKNOWN' }
  bad = st === 'CONNECTED' ? 0 : bad + 1
  await post('heartbeat', { source: 'telegram', group: GROUP, last_msg: state.lastTs || '', version: 'collector-1', state: st })
    .catch((e) => console.error('heartbeat failed:', e.message || e))
  pollErrors = 0
  flush()
  if (bad >= 2) { console.error(new Date().toISOString(), 'Telegram unreachable twice in a row; restarting'); process.exit(1) }
}
beat(); setInterval(beat, 5 * 60 * 1000)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { bot.stopPolling().finally(() => process.exit(0)) })
