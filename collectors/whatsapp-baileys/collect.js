// WhatsApp collector without a browser (Baileys). Same job and the same Sheet protocol as
// ../whatsapp/collect.js (check-in, QR and pairing code for Admin, fixed commands, ingest rows),
// but it speaks WhatsApp's own protocol over one websocket, so there is no Chromium to run out of
// memory on the 1 GB server and no WhatsApp Web page that can be logged out during its first load.
//
// Written 21 Nov 2026 after every link of the browser collector but one ended in
// CONNECTED, "Loading 99%", LOGOUT. NOT proved against real WhatsApp from the build session:
// the first real link is the test. Run only ONE of the two collectors at a time (both check in as
// source "whatsapp"): `pm2 stop he-whatsapp` before `pm2 start he-whatsapp-b`.
//
//   npm install
//   HE_PAIR_PHONE=<number with country code> node collect.js     (first link: a code is printed)
//   npm run groups                                                (list group names and ids)
//
// Settings come from collectors/.env like the other collectors: HE_API_URL, HE_INGEST_TOKEN,
// HE_GROUP_NAME (or HE_GROUP_ID), optional HE_MAX_MB, HE_SALT.
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, normalizeMessageContent, Browsers,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ingest, post } from '../lib.js'

const GROUP = (process.env.HE_GROUP_NAME || 'Halal Executive').trim()
const SALT = process.env.HE_SALT || 'halal-executive'
const MAX_MB = Number(process.env.HE_MAX_MB || 15)
const LIST = process.argv.includes('--list-groups')
const VERSION = 'baileys-1'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const AUTH = path.join(HERE, '.baileys_auth')
const STATE = path.join(HERE, 'state.json')
const EXIT_FILE = path.join(HERE, '.last-exit.json')
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { lastSeen: 0 }
const save = () => { try { fs.writeFileSync(STATE, JSON.stringify(state)) } catch (e) { /* read-only */ } }
const hash = (s) => crypto.createHash('sha256').update(SALT + String(s)).digest('hex').slice(0, 16)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
// The WhatsApp number is typed ONCE (Admin -> Progress, or HE_PAIR_PHONE) and kept in .pair_phone on this server (owner-only file, never
// logged, never sent back). From then on a lost link needs only a CODE typed on the phone: this collector asks WhatsApp for it by itself.
const PHONE_FILE = path.join(HERE, '.pair_phone')
const digits = (x) => String(x || '').replace(/\D/g, '')
const savedPhone = () => { try { const v = digits(fs.readFileSync(PHONE_FILE, 'utf8')); return /^\d{9,15}$/.test(v) ? v : '' } catch (e) { return '' } }
const savePhone = (v) => { try { fs.writeFileSync(PHONE_FILE, v, { mode: 0o600 }) } catch (e) { console.error('Could not keep the number:', e.message) } }
const phoneNow = () => (/^\d{9,15}$/.test(digits(process.env.HE_PAIR_PHONE)) ? digits(process.env.HE_PAIR_PHONE) : savedPhone())
if (/^\d{9,15}$/.test(digits(process.env.HE_PAIR_PHONE)) && !savedPhone()) savePhone(digits(process.env.HE_PAIR_PHONE))   // typed once in a terminal: kept for later
const mask = (v) => (v ? v.slice(0, 2) + '•••' + v.slice(-3) : '')
let groupId = (process.env.HE_GROUP_ID || '').trim()

// The last log lines travel with every check-in (Admin shows them). The phone number and the message text are never logged.
const LOG = []
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console)
  console[k] = (...a) => {
    orig(...a)
    const t = a.map((x) => (typeof x === 'string' ? x : x && x.message ? x.message : String(x))).join(' ')
    for (const line of t.split('\n')) if (line.trim() && !/[█▄▀]/.test(line)) LOG.push(new Date().toISOString().slice(11, 19) + ' ' + line.slice(0, 150))
    while (LOG.length > 40) LOG.shift()
  }
}
const logText = () => LOG.slice(-25).join('\n').slice(-2400)
let lastExit = null
try { lastExit = JSON.parse(fs.readFileSync(EXIT_FILE, 'utf8')) } catch (e) { /* first start */ }

let phase = 'STARTING', phaseAt = Date.now(), note = '', sock = null, open = false, quitting = false
let loggedFor = null, needSince = 0, qrSent = false, lastQr = '', lastQrAt = 0, lastCode = '', lastCodeAt = 0, wantUntil = 0, lastBeat = 0, beating = false, pairAsked = false, fast = 0
if (lastExit) { note = `previous run ended ${String(lastExit.at).slice(0, 16)}Z after ${lastExit.ran_s}s: ${lastExit.why}`.slice(0, 140); console.log('Previous run:', JSON.stringify(lastExit)) }
const setPhase = (p, n = '') => { if (phase !== p) phaseAt = Date.now(); phase = p; note = n }
const lastMsgMs = () => state.lastSeen || 0

async function quit(code, why, wipe) {
  if (quitting) return
  quitting = true
  if (why) console.error(new Date().toISOString(), why)
  try { fs.writeFileSync(EXIT_FILE, JSON.stringify({ at: new Date().toISOString(), why: why || 'exit ' + code, code, wipe: !!wipe, ran_s: Math.round(process.uptime()) })) } catch (e) { /* read-only */ }
  try { sock && sock.end(undefined) } catch (e) { /* already closed */ }
  if (wipe) { try { fs.rmSync(AUTH, { recursive: true, force: true }) } catch (e) { /* in use */ } }
  await sleep(300)
  process.exit(code)
}
process.on('unhandledRejection', (e) => console.error('Error:', e && (e.message || e)))
process.on('SIGTERM', () => quit(0, 'SIGTERM'))
process.on('SIGINT', () => quit(0, 'SIGINT'))

// ---- one WhatsApp message -> one Sheet row ------------------------------------------------------
const toNum = (t) => (t == null ? 0 : typeof t === 'number' ? t : Number(t.toString()))
// Same message id shape the browser collector made (fromMe_chat_id_participant@c.us), so a message both collectors saw is one row.
const cus = (j) => String(j || '').replace('@s.whatsapp.net', '@c.us')
function msgId(m) {
  const k = m.key || {}
  const who = k.participantPn || k.participantAlt || k.participant || ''
  return [k.fromMe ? 'true' : 'false', k.remoteJid, k.id, cus(who)].filter(Boolean).join('_')
}
function parts(m) {
  const c = normalizeMessageContent(m.message) || {}
  const text = c.conversation || (c.extendedTextMessage && c.extendedTextMessage.text) || (c.imageMessage && c.imageMessage.caption) || (c.videoMessage && c.videoMessage.caption) || (c.documentMessage && c.documentMessage.caption) || ''
  const media = c.imageMessage ? ['image', c.imageMessage] : c.documentMessage ? ['document', c.documentMessage] : c.videoMessage ? ['video', c.videoMessage] : null
  return { text, media }
}
async function toRow(m) {
  const { text, media } = parts(m)
  const k = m.key || {}
  const who = k.participantPn || k.participantAlt || k.participant || k.remoteJid
  const row = { source: 'whatsapp', group: GROUP, msg_id: msgId(m), sender_hash: hash(cus(who)), ts: new Date(toNum(m.messageTimestamp) * 1000).toISOString(), text, attachments: [] }
  if (media) {
    const [kind, mm] = media
    const size = toNum(mm.fileLength)
    if (size && size / 1e6 > MAX_MB) row.attachments.push({ name: mm.fileName, mime: mm.mimetype, skipped: 'too large or unavailable' })
    else {
      try {
        const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        const ext = String(mm.mimetype || 'application/bin').split('/')[1].split(';')[0]
        row.attachments.push({ name: mm.fileName || `${k.id}.${ext}`, mime: mm.mimetype, b64: buf.toString('base64'), sha256: crypto.createHash('sha256').update(buf).digest('hex') })
      } catch (e) { row.attachments.push({ name: mm.fileName, mime: mm.mimetype, error: String((e && e.message) || e).slice(0, 80), kind }) }
    }
  }
  return row
}
// Rows are sent one batch at a time, in order, so a burst of history does not open many requests at once.
let chain = Promise.resolve()
function handle(msgs, why) {
  const mine = msgs.filter((m) => m && m.message && m.key && groupId && m.key.remoteJid === groupId)
  if (!mine.length) return
  chain = chain.then(async () => {
    let added = 0, failed = 0
    for (let i = 0; i < mine.length; i += 10) {
      const rows = []
      for (const m of mine.slice(i, i + 10)) {
        const { text, media } = parts(m)
        if (!text && !media) continue          // reactions, protocol and system messages carry nothing to read
        try { rows.push(await toRow(m)) } catch (e) { failed++ }
      }
      if (!rows.length) continue
      try { const r = await ingest(rows); added += r.added || 0 } catch (e) { failed += rows.length; console.error('  ingest failed:', e.message || e) }
    }
    for (const m of mine) state.lastSeen = Math.max(state.lastSeen || 0, toNum(m.messageTimestamp) * 1000)
    save()
    console.log(`${new Date().toISOString()} ${why}: ${mine.length} message(s), ${added} new${failed ? `, ${failed} failed` : ''}`)
    if (Date.now() - lastBeat > 60000) beat()
  }).catch((e) => console.error('handle failed', e && (e.message || e)))
}

// ---- connection ---------------------------------------------------------------------------------
async function resolveGroup() {
  for (let i = 0; i < 8; i++) {
    try {
      const all = Object.values(await sock.groupFetchAllParticipating())
      if (LIST) {
        console.log(`\n${all.length} groups. Copy the name exactly into HE_GROUP_NAME (or the id into HE_GROUP_ID):\n`)
        all.sort((a, b) => String(a.subject).localeCompare(String(b.subject))).forEach((g) => console.log(`  ${g.subject}\n      ${g.id}`))
        return quit(0)
      }
      if (groupId) return groupId
      const exact = all.filter((g) => g.subject === GROUP)
      const loose = exact.length ? exact : all.filter((g) => norm(g.subject) === norm(GROUP))
      if (loose.length === 1) { groupId = loose[0].id; return groupId }
      console.error(loose.length ? `More than one group is called "${GROUP}". Put the right id in HE_GROUP_ID:` : `Group "${GROUP}" not found. Groups on this number:`)
      ;(loose.length ? loose : all).forEach((g) => console.error(`  ${g.subject}   ${g.id}`))
      setPhase('CONNECTED', 'group not found: set HE_GROUP_NAME or HE_GROUP_ID')
      return ''
    } catch (e) { await sleep(5000) }
  }
  return ''
}

async function connect() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH)
  let version
  try { version = (await fetchLatestBaileysVersion()).version } catch (e) { /* the library's bundled version is used */ }
  pairAsked = false
  // Browser identity: Browsers.macOS('Desktop') (the "full history" identity) made WhatsApp end the connection right after the
  // handshake, every time, before any QR or code (21 Nov 2026: "Connection Terminated (428)" on the VM and in the build session, 8 of 8).
  // A Chrome-on-Ubuntu identity gets the QR at once. A web-type link still receives the group's recent history once after the scan.
  const s = makeWASocket({
    auth: auth, ...(version ? { version } : {}), logger: pino({ level: 'silent' }), browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false, markOnlineOnConnect: false, printQRInTerminal: false, generateHighQualityLinkPreview: false,
  })
  sock = s
  s.ev.on('creds.update', saveCreds)
  s.ev.on('connection.update', async (u) => {
    if (s !== sock) return
    if (u.qr) {
      lastQr = u.qr; lastQrAt = Date.now(); open = false
      if (!needSince) needSince = Date.now()
      const ph = phoneNow()
      setPhase('QR', Date.now() - lastCodeAt < 170000 ? 'code ready: type it on the phone' : ph ? `logged out: a code is made for ${mask(ph)}` : 'logged out: type the WhatsApp number once in Admin to get a code')
      if (loggedFor !== s) { loggedFor = s; console.log(ph ? 'Logged out. A pairing code is asked for the saved number (Admin shows it).' : 'Logged out and no number saved: set it in Admin -> Progress -> Link WhatsApp, or HE_PAIR_PHONE.') }
      // Codes are asked for in the first 15 minutes after the link is lost and whenever an admin has the link panel open, never all night:
      // a code every 3 minutes for hours would look like abuse to WhatsApp. A new socket needs a new code; the same one is renewed after 150 s.
      const wanted = Date.now() < wantUntil || Date.now() - needSince < 15 * 60000
      if (ph && wanted && !s.authState.creds.registered && (!pairAsked || Date.now() - lastCodeAt > 150000)) { pairAsked = true; await askCode(ph) }
      else if (Date.now() < wantUntil || !qrSent) { qrSent = true; beat() }
    }
    if (u.connection === 'connecting') console.log('Connecting…')
    if (u.connection === 'open') {
      open = true; if (!note || /code|logged out|number/i.test(note)) note = phoneNow() ? `number saved (${mask(phoneNow())}): a lost link needs only a code` : 'no number saved: type it once in Admin so a lost link needs only a code'; lastQr = ''; lastCode = ''; needSince = 0; fast = 0; setPhase('CONNECTED'); console.log('Connected to WhatsApp')
      if (await resolveGroup()) console.log(`Group: ${GROUP} (${groupId})`)
      beat()
    }
    if (u.connection === 'close') {
      open = false
      const err = u.lastDisconnect && u.lastDisconnect.error
      const code = err && err.output ? err.output.statusCode : 0
      const why = `${(err && err.message) || 'closed'} (${code || 'no code'})`
      console.error('Connection closed:', why)
      if (code === DisconnectReason.loggedOut) return quit(0, 'WhatsApp ended this linked session (loggedOut). The login is cleared, a new QR follows', true)
      // 515 "restart required" is normal right after a scan: open the connection again with the saved login.
      setPhase('STARTING', 'reconnecting after: ' + why.slice(0, 80))
      if (code !== DisconnectReason.timedOut && ++fast > 8) return quit(1, 'Closed 8 times in a row, last: ' + why)
      await sleep(code === DisconnectReason.restartRequired ? 500 : Math.min(30000, 2000 * fast))
      if (!quitting) connect().catch((e) => quit(1, 'Reconnect failed: ' + ((e && e.message) || e)))
    }
  })
  // Live messages and the history WhatsApp sends once after a link (read only from 10 minutes before the last message the Sheet got).
  s.ev.on('messages.upsert', ({ messages, type }) => handle(messages, type === 'notify' ? 'live' : 'append'))
  s.ev.on('messaging-history.set', ({ messages, isLatest }) => {
    const since = lastMsgMs() ? lastMsgMs() - 10 * 60000 : 0
    const recent = (messages || []).filter((m) => toNum(m.messageTimestamp) * 1000 >= since)
    if (recent.length) { note = `history: ${recent.length} messages read`; handle(recent, 'history') }
    if (isLatest) console.log('History sync finished')
  })
}
async function askCode(phone) {
  try {
    lastCode = ''
    const c = await sock.requestPairingCode(phone)
    lastCode = String(c); lastCodeAt = Date.now(); note = 'pairing code ready'
    // Terminal only (not the log that goes to Admin): it is typed on the phone within a few minutes.
    const shown = lastCode.length === 8 ? lastCode.slice(0, 4) + '-' + lastCode.slice(4) : lastCode
    process.stdout.write(`\n  >>>  PAIRING CODE:  ${shown}   <<<\n  Phone: WhatsApp > Settings > Linked devices > Link a device > Link with phone number instead\n\n`)
    beat()
  } catch (e) { pairAsked = false; note = 'pairing code failed: ' + String((e && e.message) || e).slice(0, 80); console.error(note) }
}

// ---- check-in: every 5 minutes when connected, every 30 to 60 seconds while it is not ------------
async function beat() {
  if (beating || quitting) return
  beating = true
  try {
    const body = { source: 'whatsapp', group: GROUP, last_msg: lastMsgMs() ? new Date(lastMsgMs()).toISOString() : '', version: VERSION, state: open ? 'CONNECTED' : phase, note, log: logText() }
    if (!open && phase === 'QR' && lastQr && Date.now() - lastQrAt < 60000 && !phoneNow()) body.qr = lastQr   // a QR is only the fallback for a server with no number saved
    if (!open && phase === 'QR' && lastCode && Date.now() - lastCodeAt < 170000) body.code = lastCode
    const r = await post('heartbeat', body).catch((e) => { console.error('heartbeat failed:', e.message || e); return null })
    lastBeat = Date.now()
    if (r && r.want_qr) wantUntil = Date.now() + 180000
    if (r && r.cmd) { beating = false; return await command(String(r.cmd)) }
  } finally { beating = false }
}
function tick() {
  if (quitting) return
  const now = Date.now()
  if (open) { if (now - lastBeat >= 5 * 60000 - 5000) beat(); return }
  if (phase !== 'QR' && now - phaseAt > 20 * 60000) return quit(1, `Stuck in ${phase} for 20 minutes; restarting`)
  if (now - lastBeat >= (phase === 'QR' ? 30000 : 60000)) beat()
}
// Fixed words only: nothing typed in Admin is ever run here.
async function command(cmd) {
  console.log(new Date().toISOString(), 'Admin command:', cmd.replace(/\d{9,15}$/, '***'))   // the phone number is never logged
  const pair = /^pair:(\d{9,15})$/.exec(cmd)
  if (pair) {
    savePhone(pair[1])                       // kept, so the next lost link needs only a code
    if (open) { note = `number saved (${mask(pair[1])}); it is used if the link is ever lost`; return beat() }
    if (phase !== 'QR' || !sock || sock.authState.creds.registered) { note = `number saved (${mask(pair[1])}); the code follows when WhatsApp asks for a link`; return beat() }
    pairAsked = true; needSince = Date.now(); await askCode(pair[1]); return
  }
  if (cmd === 'restart') return quit(0, 'Restart asked from Admin')
  if (cmd === 'relink') return quit(0, 'Relink asked from Admin: the saved login is cleared, a new QR follows', true)
  if (cmd === 'catchup') { note = 'catch-up: WhatsApp sends the missed messages by itself after a link or a reconnect; use Restart to ask again'; return beat() }
  if (cmd === 'update') {
    quitting = true
    try { sock && sock.end(undefined) } catch (e) { /* closed */ }
    let out = ''
    try {
      out = execFileSync('git', ['-C', path.resolve(HERE, '../..'), 'pull', '--ff-only'], { timeout: 120000 }).toString().trim().split('\n').pop()
      execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: HERE, timeout: 600000, stdio: 'ignore' })
      out = 'updated: ' + out
    } catch (e) { out = 'update failed: ' + String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 100) }
    console.log(out)
    await post('heartbeat', { source: 'whatsapp', group: GROUP, last_msg: lastMsgMs() ? new Date(lastMsgMs()).toISOString() : '', version: VERSION, state: 'STARTING', note: out.slice(0, 140), log: logText() }).catch(() => {})
    process.exit(0)
  }
}

connect().catch((e) => quit(1, 'Start failed: ' + ((e && e.message) || e)))
if (!LIST) { beat(); setInterval(tick, 15000) }
