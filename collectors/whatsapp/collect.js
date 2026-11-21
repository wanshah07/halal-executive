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
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ingest, post, browserPath } from '../lib.js'

const { Client, LocalAuth, Chat } = pkg
const GROUP = (process.env.HE_GROUP_NAME || 'Halal Executive').trim()
const GROUP_ID = (process.env.HE_GROUP_ID || '').trim()
const SALT = process.env.HE_SALT || 'halal-executive'
const MAX_MB = Number(process.env.HE_MAX_MB || 15)
const BACKFILL_LIMIT = Number(process.env.HE_BACKFILL_LIMIT || 5000)
const BACKFILL = process.argv.includes('--backfill')
// --files-only: send only messages carrying a picture, PDF or document. Used to
// recover posters and certificates whose text was already imported from a
// chat-export .txt (which has no files): the Sheet adds each file to its row.
const FILES_ONLY = process.argv.includes('--files-only')
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
// ---- Runs by itself (Wan, 16 Nov 2026: "make whatsapp always run") ----------------------
// Twice in a week the collector sat `online` in pm2 doing nothing: once waiting on a QR
// nobody could see, once after a start that failed ("browser is already running") and was
// only logged. A service run (no flags, or --listen) now:
//   1. frees the login folder before it starts: a browser left by an earlier run is killed
//      and its lock files removed;
//   2. checks in from the first second with its real state (STARTING, QR, LINKED,
//      CONNECTED), not only once WhatsApp is ready, so Admin always knows what it is doing;
//   3. sends the QR code with that check-in, so it is scanned in Admin -> Progress, with no
//      terminal;
//   4. exits (pm2 starts it again) when the start fails, when it is stuck for 10 minutes,
//      when a QR went unscanned for 30 minutes, or when WhatsApp ends the session, clearing
//      the dead login so the next start shows a new QR;
//   5. takes three fixed commands from Admin with the check-in's answer: restart, update
//      (git pull + npm install of this repo, then restart) and relink (clear the login).
const HERE = path.dirname(fileURLToPath(import.meta.url))
const AUTH = path.resolve('.wwebjs_auth')            // where LocalAuth keeps the login (the folder pm2 starts in)
const SERVICE = !LIST && (!BACKFILL || process.argv.includes('--listen'))
// What happened, for Admin (Wan, 16 Nov 2026: it was logged out again within two hours and nothing said why): the last
// log lines travel with every check-in, and the reason a run ended is kept in a file the next start reports. The QR's
// ASCII art is left out. Nothing secret is logged here: no token, no message text.
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
const EXIT_FILE = path.join(HERE, '.last-exit.json')
let lastExit = null
try { lastExit = JSON.parse(fs.readFileSync(EXIT_FILE, 'utf8')) } catch (e) { /* first start */ }
const logText = () => LOG.slice(-25).join('\n').slice(-2400)
function freeProfile() {
  if (process.platform === 'win32') return
  const stuckDone = () => { for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) { try { fs.rmSync(path.join(AUTH, 'session', f), { force: true }) } catch (e) { /* not there */ } } }
  // TERM first and a few seconds to finish writing the login, then KILL: a hard kill in the middle of a write can
  // corrupt the saved WhatsApp session and force a new QR.
  for (const sig of ['-TERM', '-TERM', '-9', '-9']) {
    try { execFileSync('pkill', [sig, '-f', '--', '--user-data-dir=' + AUTH], { stdio: 'ignore' }) } catch (e) { return stuckDone() }
    try { execFileSync('sleep', [sig === '-TERM' ? '2' : '1']) } catch (e) { /* no sleep binary */ }
  }
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) { try { fs.rmSync(path.join(AUTH, 'session', f), { force: true }) } catch (e) { /* not there */ } }
}
if (SERVICE) freeProfile()

// A small cloud server (1 GB) loads WhatsApp Web slowly; give the login and
// the first sync time instead of the library's short defaults.
// The library's default user agent is Chrome 101 on a Mac (April 2022). The browser here is far newer, and WhatsApp ended
// the linked session seconds after a scan (16 Nov 2026, log: "Disconnected: LOGOUT" 16 s after the last QR). A user agent
// that matches the installed browser is the one thing in our control that can look like an automated old client; it is
// built from `chromium --version`, and the library default is kept when that cannot be read.
function browserUA() {
  try {
    if (!exe) return undefined
    const m = /(\d+)\.\d+\.\d+\.\d+/.exec(execFileSync(exe, ['--version'], { timeout: 10000 }).toString())
    if (!m) return undefined
    const os = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'
    return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${m[1]}.0.0.0 Safari/537.36`
  } catch (e) { return undefined }
}
// Which user agent (HE_USER_AGENT): empty = the library's default (Chrome 101 on a Mac), "auto" = the installed browser's own
// version (`browserUA`), anything else = that exact string. 21 Nov 2026: the only link that ever held (16 Nov 05:52 to 07:21) was made
// with the library default; every link made with the matching-browser user agent (07:51, 09:10, 21 Nov 02:28) ended in LOGOUT, so the
// default is the library's again until the two are compared. Not proved: three attempts, one success.
const UA_MODE = String(process.env.HE_USER_AGENT || '').trim()
const UA = UA_MODE === 'auto' ? browserUA() : UA_MODE || undefined
console.log('User agent:', UA || 'library default')
const client = new Client({
  authStrategy: new LocalAuth(),
  ...(UA ? { userAgent: UA } : {}),
  authTimeoutMs: 180000,
  puppeteer: { headless: true, executablePath: exe, protocolTimeout: 300000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] },
})
// Progress after the QR is scanned, so a stall or a logout shows where it happened.
let phase = 'STARTING', phaseAt = Date.now(), note = '', ready = false, lastQr = '', lastQrAt = 0, wantUntil = 0, lastCode = '', lastCodeAt = 0
let quitting = false, beating = false, lastBeat = 0, bad = 0
if (lastExit) { note = `previous run ended ${String(lastExit.at).slice(0, 16)}Z after ${lastExit.ran_s}s: ${lastExit.why}`.slice(0, 140); console.log('Previous run:', JSON.stringify(lastExit)) }
const setPhase = (p, n = '') => { if (phase !== p) phaseAt = Date.now(); phase = p; note = n }
// Leave cleanly: close the browser (8 s at most), free the login folder, optionally clear a
// dead login, then exit so pm2 starts a fresh copy.
async function quit(code, why, wipe) {
  if (quitting) return
  quitting = true
  if (why) console.error(new Date().toISOString(), why)
  try { fs.writeFileSync(EXIT_FILE, JSON.stringify({ at: new Date().toISOString(), why: why || (wipe ? 'login cleared' : 'exit ' + code), code, wipe: !!wipe, ran_s: Math.round(process.uptime()) })) } catch (e) { /* read-only folder */ }
  await Promise.race([client.destroy().catch(() => {}), sleep(8000)])
  if (SERVICE) freeProfile()
  if (wipe) { for (const d of [AUTH, path.resolve('.wwebjs_cache')]) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) { /* in use */ } } }
  process.exit(code)
}
client.on('authenticated', () => { setPhase('LINKED', 'linked, loading chats'); lastQr = ''; console.log('Linked. Loading chats (a small server can take a few minutes)…') })
client.on('loading_screen', (pct, msg) => console.log(`Loading ${pct}% ${msg || ''}`))
client.on('change_state', (st) => console.log('State:', st))
// While a link is being made, record what WhatsApp Web itself does (its socket state and page changes), so the next
// "LOGOUT right after linking" shows where in the handshake it happened. Only state words and the page path are logged.
let watchingLink = false
function watchLink() {
  if (watchingLink || !client.pupPage) return
  watchingLink = true
  try { client.pupPage.on('framenavigated', (f) => { try { if (f === client.pupPage.mainFrame()) console.log('Page:', f.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 60)) } catch (e) { /* closed */ } }) } catch (e) { /* closed */ }
  let last = ''
  const iv = setInterval(async () => {
    if (ready || quitting) return clearInterval(iv)
    try {
      const st = await client.pupPage.evaluate(() => { try { return String(window.require('WAWebSocketModel').Socket.state) } catch (e) { return 'no-socket' } })
      if (typeof st === 'string' && st !== last) { last = st; console.log('Socket state:', st) }
    } catch (e) { /* page closed or reloading */ }
  }, 2000)
}
client.on('qr', (qr) => {
  watchLink()
  setPhase('QR', Date.now() - lastCodeAt < 170000 ? 'pairing code ready' : 'waiting for the QR to be scanned'); lastQr = qr; lastQrAt = Date.now()
  console.log('Scan with WhatsApp → Settings → Linked devices → Link a device (or in Admin → Progress → Link WhatsApp)'); qrcode.generate(qr, { small: true })
  if (SERVICE && Date.now() < wantUntil) beat()     // an admin has the link panel open: send each new code at once
  if (/^\d{9,15}$/.test(PAIR_PHONE) && !pairAsked) {
    pairAsked = true
    client.requestPairingCode(PAIR_PHONE, true).catch((e) => { pairAsked = false; console.error('Pairing code failed:', String((e && e.message) || e).slice(0, 100)) })
  }
})
// Link with a phone number instead of a QR (Wan, 16 Nov 2026: "still cannot link"): WhatsApp gives an 8-character code
// that is typed on the phone (Linked devices, Link a device, Link with phone number instead). It renews every ~3 minutes.
client.on('code', (c) => {
  lastCode = String(c); lastCodeAt = Date.now(); note = 'pairing code ready'; console.log('Pairing code received')
  // Printed on the terminal only (not through the log that goes to Admin): the code is typed on the phone within 3 minutes.
  const shown = lastCode.length === 8 ? lastCode.slice(0, 4) + '-' + lastCode.slice(4) : lastCode
  process.stdout.write(`\n  >>>  PAIRING CODE:  ${shown}   <<<\n  Phone: WhatsApp > Settings > Linked devices > Link a device > Link with phone number instead\n\n`)
  if (SERVICE) beat()
})
// From a terminal: HE_PAIR_PHONE=60123456789 node collect.js ...  asks for a code as soon as WhatsApp wants a link, so no QR has
// to be scanned (it renews every 20 seconds). The number is read from the environment only and never logged.
const PAIR_PHONE = String(process.env.HE_PAIR_PHONE || '').replace(/\D/g, '')
let pairAsked = false
client.on('auth_failure', (m) => { console.error('Login failed:', m); quit(1, 'Login failed: the saved login is cleared, a new QR follows', true) })
// WhatsApp logged this device out or the connection dropped: exit so pm2
// restarts the collector, which reconnects with the saved session.
client.on('disconnected', (reason) => {
  console.error('Disconnected:', reason)
  if (reason === 'LOGOUT') console.error('WhatsApp ended this linked session. A new QR follows: scan it in Admin → Progress → Link WhatsApp.')
  quit(1, 'Disconnected: ' + reason, reason === 'LOGOUT')
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
async function loadHistory(id, max = BACKFILL_LIMIT) {
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
  }, id, max).catch((e) => { console.warn('History load stopped:', e.message); return null })
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

// Catch-up (Wan, 16 Nov 2026: "extract the chat from the group"): messages sent while the collector was down are
// read again from WhatsApp Web's own history, newest first, from 10 minutes before the last one the Sheet got.
// It runs on every start that follows a silence, and when an admin presses Catch up in Admin -> Progress. The
// Sheet skips message ids it already has, so overlap costs time only, never duplicates.
let catching = false
const lastMsgMs = () => state.lastSeen || state.lastTs || 0
async function catchUp(why) {
  if (catching || !groupId || quitting) return
  catching = true
  const since = lastMsgMs() ? lastMsgMs() - 10 * 60000 : 0
  try {
    note = `catching up (${why})…`
    const chat = new Chat(client, { id: { _serialized: groupId }, formattedTitle: GROUP, isGroup: true })
    await loadHistory(groupId, 1000)
    const all = await chat.fetchMessages({ limit: 1000 })
    const msgs = all.filter((m) => m.timestamp * 1000 >= since)
    let added = 0, failed = 0
    for (let i = 0; i < msgs.length; i += 10) {
      const rows = []
      for (const m of msgs.slice(i, i + 10)) { try { rows.push(await toRow(m)) } catch (e) { failed++ } }
      try { const r = await ingest(rows); added += r.added } catch (e) { failed += rows.length; console.error('  catch-up batch failed:', e.message) }
    }
    for (const m of msgs) state.lastSeen = Math.max(state.lastSeen || 0, m.timestamp * 1000)
    save()
    note = `catch-up ${new Date().toISOString().slice(0, 16)}Z (${why}): ${msgs.length} messages read, ${added} new${failed ? `, ${failed} failed` : ''}`
    console.log(note)
  } catch (e) { note = 'catch-up failed: ' + String((e && e.message) || e).slice(0, 100); console.error(note) }
  finally { catching = false; beat() }
}

client.on('ready', async () => {
  try {
    ready = true; setPhase('CONNECTED'); lastQr = ''
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
      let msgs = await chat.fetchMessages({ limit: BACKFILL_LIMIT })
      if (FILES_ONLY) { msgs = msgs.filter((m) => m.hasMedia && ['image', 'document'].includes(m.type)); console.log(`Files only: ${msgs.length} messages with a picture or document (videos and stickers skipped)`) }
      const ids = new Set(msgs.map(msgIdOf))
      if (ids.size < msgs.length) console.warn(`Warning: ${msgs.length - ids.size} messages share an id; tell Claude.`)
      console.log(`Backfill: ${msgs.length} messages, sending to the Sheet in batches of 10`)
      let added = 0, skipped = 0, failed = 0, filled = 0, nofile = 0
      const STEP = FILES_ONLY ? 3 : 10 // files are big: fewer per request
      for (let i = 0; i < msgs.length; i += STEP) {
        const rows = []
        for (const m of msgs.slice(i, i + STEP)) {
          try {
            const row = await toRow(m)
            // WhatsApp keeps old media on its servers for a limited time; past
            // that, the file cannot be downloaded from a linked device.
            if (m.hasMedia && !row.attachments.some((a) => a.b64)) nofile++
            rows.push(row)
          } catch (e) { failed++ }
        }
        try { const r = await ingest(rows); added += r.added; skipped += r.skipped; filled += r.filled || 0 } catch (e) { failed += rows.length; console.error('  batch failed:', e.message) }
        console.log(`  ${Math.min(i + STEP, msgs.length)}/${msgs.length}  added ${added}  files added to existing ${filled}  already there ${skipped}  file not downloadable ${nofile}  failed ${failed}`)
      }
      state.lastTs = Date.now(); for (const m of msgs) state.lastSeen = Math.max(state.lastSeen || 0, m.timestamp * 1000); save()
      console.log(`Backfill done: ${added} new rows, ${filled} files added to rows already in the Raw tab.`)
      if (nofile) console.log(`${nofile} files could not be downloaded (WhatsApp no longer holds old media for linked devices). Get them from the phone: Export chat → Include media, then npm run import-files -- <zip>.`)
      if (!process.argv.includes('--listen')) { await client.destroy(); process.exit(failed ? 1 : 0) }
    }
    if (SERVICE) beat()
    console.log('Listening for new messages… (Ctrl+C to stop)')
    // A start after a silence reads what was missed (a quiet group needs no catch-up: nothing newer than 15 minutes).
    if (SERVICE && !BACKFILL && Date.now() - lastMsgMs() > 15 * 60000) catchUp('start')
  } catch (e) {
    console.error('Stopped:', e && (e.message || e)); await quit(1)
  }
})

// ---- Check-in: every 5 minutes when connected, every 30 to 60 seconds while it is not ----
// The answer can carry `want_qr` (an admin has the link panel open) and one command.
async function beat() {
  if (beating || quitting) return
  beating = true
  try {
    let st = phase
    if (ready) {
      st = 'UNKNOWN'
      try { st = String(await Promise.race([client.getState(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000))]) || 'UNKNOWN') } catch (e) { st = 'UNKNOWN' }
      bad = st === 'CONNECTED' ? 0 : bad + 1
    }
    const body = { source: 'whatsapp', group: GROUP, last_msg: lastMsgMs() ? new Date(lastMsgMs()).toISOString() : '', version: 'collector-5', state: st, note, log: logText() }
    if (!ready && phase === 'QR' && lastQr && Date.now() - lastQrAt < 60000) body.qr = lastQr
    if (!ready && phase === 'QR' && lastCode && Date.now() - lastCodeAt < 170000) body.code = lastCode
    const r = await post('heartbeat', body).catch((e) => { console.error('heartbeat failed:', e.message || e); return null })
    lastBeat = Date.now()
    if (r && r.want_qr) wantUntil = Date.now() + 180000
    if (r && r.cmd) { beating = false; return await command(String(r.cmd)) }
    // Two checks in a row that are not CONNECTED: start again with the saved login.
    if (ready && bad >= 3) await quit(1, `WhatsApp state ${st} three times in a row; restarting`)
  } finally { beating = false }
}
function tick() {
  if (quitting) return
  const now = Date.now()
  if (ready) { if (now - lastBeat >= (bad ? 60000 : 5 * 60000 - 5000)) beat(); return }   // a doubtful state is checked again after a minute
  if (phase !== 'QR' && now - phaseAt > 20 * 60000) return quit(1, `Stuck in ${phase} for 20 minutes; restarting`)
  if (phase === 'QR' && now - phaseAt > 30 * 60000 && now > wantUntil) return quit(1, 'The QR was not scanned for 30 minutes; restarting for a fresh one')
  if (now - lastBeat >= (phase === 'QR' ? 30000 : 60000)) beat()
}
// Commands an admin sends from Admin → Progress. Fixed words only: nothing typed in Admin is ever run here.
async function command(cmd) {
  console.log(new Date().toISOString(), 'Admin command:', cmd.replace(/\d{9,15}$/, '***'))   // the phone number is never logged
  const pair = /^pair:(\d{9,15})$/.exec(cmd)
  if (pair) {
    if (phase !== 'QR' || ready) { note = 'pairing code: not waiting for a link now'; return }
    try { lastCode = ''; const c = await client.requestPairingCode(pair[1], true); if (c) { lastCode = String(c); lastCodeAt = Date.now(); note = 'pairing code ready' } }
    catch (e) { note = 'pairing code failed: ' + String((e && e.message) || e).slice(0, 80); console.error(note) }
    return beat()
  }
  if (cmd === 'restart') return quit(0, 'Restart asked from Admin')
  if (cmd === 'catchup') { await catchUp('Admin'); return }
  if (cmd === 'relink') return quit(0, 'Relink asked from Admin: the saved login is cleared, a new QR follows', true)
  if (cmd === 'update') {
    quitting = true
    await Promise.race([client.destroy().catch(() => {}), sleep(8000)]); freeProfile()   // the browser's memory is needed for npm
    let out = ''
    try {
      out = execFileSync('git', ['-C', path.resolve(HERE, '../..'), 'pull', '--ff-only'], { timeout: 120000 }).toString().trim().split('\n').pop()
      execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: HERE, timeout: 600000, stdio: 'ignore' })
      out = 'updated: ' + out
    } catch (e) { out = 'update failed: ' + String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 100) }
    console.log(out)
    await post('heartbeat', { source: 'whatsapp', group: GROUP, last_msg: lastMsgMs() ? new Date(lastMsgMs()).toISOString() : '', version: 'collector-5', state: 'STARTING', note: out.slice(0, 140), log: logText() }).catch(() => {})
    process.exit(0)
  }
}

// Live messages: matched on the chat id carried by the message itself
// (m.id.remote), so no chat lookup is needed.
client.on('message_create', async (m) => {
  try {
    if (!groupId || remoteOf(m) !== groupId) return
    const r = await ingest([await toRow(m)])
    state.lastTs = Date.now(); state.lastSeen = Math.max(state.lastSeen || 0, m.timestamp * 1000); save()
    console.log(new Date().toISOString(), 'saved', r.added ? 'new' : 'already there')
    if (SERVICE && Date.now() - lastBeat > 60000) beat()   // Admin shows the new "last message" within a minute
  } catch (e) { console.error('ingest failed', e.message || e) }
})

// A start that fails (no browser, the login folder in use) must end the process: logged only,
// it used to leave a copy that pm2 showed as online and that never read a message.
client.initialize().catch((e) => quit(1, 'Start failed: ' + ((e && e.message) || e)))
if (SERVICE) { beat(); setInterval(tick, 15000) }
