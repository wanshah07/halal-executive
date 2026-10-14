// Import a WhatsApp "Export chat" file: the way to get a group's FULL history.
// A linked device (the live collector) only sees what the phone has synced,
// often just the last few dozen messages.
//
// On the phone: open the group → ⋮ (or the group name on iPhone) → More →
// Export chat → Include media → save/send the .zip to this PC. Then:
//
//   npm run import -- "C:\Users\Muham\Downloads\WhatsApp Chat with HE Malaysia.zip"
//
// It also takes the unzipped folder or the bare _chat.txt / .txt file.
// Re-running the same export adds nothing twice (each message id is a hash
// of its time, sender and text). Sender names are hashed before upload.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { ingest } from '../lib.js'

const GROUP = (process.env.HE_GROUP_NAME || 'Halal Executive').trim()
const SALT = process.env.HE_SALT || 'halal-executive'
const MAX_MB = Number(process.env.HE_MAX_MB || 15)
const SINCE = process.env.HE_IMPORT_SINCE ? new Date(process.env.HE_IMPORT_SINCE) : null
const hash = (s) => crypto.createHash('sha256').update(SALT + String(s)).digest('hex').slice(0, 16)

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', csv: 'text/csv', mp4: 'video/mp4', opus: 'audio/ogg', mp3: 'audio/mpeg', vcf: 'text/vcard' }
const SKIP_MEDIA = /\.(opus|mp3|m4a|aac|mp4|3gp|mov|webm|vcf)$/i // voice notes, video, contacts: no text to read

// ---- read the export: { text, files: Map(name -> Buffer) } ----
function readExport(p) {
  const files = new Map()
  let text = ''
  const st = fs.statSync(p)
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) {
      const full = path.join(p, f)
      if (/\.txt$/i.test(f) && !text) text = fs.readFileSync(full, 'utf8')
      else if (fs.statSync(full).isFile()) files.set(f, () => fs.readFileSync(full))
    }
  } else if (/\.zip$/i.test(p)) {
    const zip = new AdmZip(p)
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue
      const name = path.basename(e.entryName)
      if (/\.txt$/i.test(name) && !text) text = e.getData().toString('utf8')
      else files.set(name, () => e.getData())
    }
  } else text = fs.readFileSync(p, 'utf8')
  if (!text) throw new Error('No chat .txt found in ' + p)
  return { text: text.replace(/^\uFEFF/, ''), files }
}

// ---- parse lines ----
// Android: 14/10/2026, 10:23 - Name: message     (also 10:23 am / pm)
// iPhone : [14/10/2026, 10:23:45] Name: message  (also [14/10/26, 10:23:45 AM])
const LINE = /^\u200e?\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP]\.?\s?[mM]\.?)?\]?\s*(?:-\s)?(.*)$/
function toDate(d, mo, y, h, mi, se, ap) {
  let Y = Number(y); if (Y < 100) Y += 2000
  let H = Number(h); const pm = ap && /p/i.test(ap); const am = ap && /a/i.test(ap)
  if (pm && H < 12) H += 12; if (am && H === 12) H = 0
  // Malaysian exports are day/month. If the first number cannot be a day of
  // a month (>12 in the second slot means month/day), swap.
  let D = Number(d), M = Number(mo)
  if (M > 12 && D <= 12) [D, M] = [M, D]
  return new Date(Date.UTC(Y, M - 1, D, H - 8, Number(mi), Number(se || 0))) // MYT → UTC
}
function parse(text) {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(LINE)
    if (m) {
      const rest = m[8]
      const c = rest.indexOf(': ')
      if (c < 0) { out.push({ ts: toDate(m[1], m[2], m[3], m[4], m[5], m[6], m[7]), sender: '', text: rest, system: true }); continue }
      out.push({ ts: toDate(m[1], m[2], m[3], m[4], m[5], m[6], m[7]), sender: rest.slice(0, c), text: rest.slice(c + 2), system: false })
    } else if (out.length) out[out.length - 1].text += '\n' + raw
  }
  return out.filter((x) => !x.system)
}

// Attachment references in the message text
const ATT = [/<attached:\s*([^>]+)>/i, /^\u200e?(.+?\.[A-Za-z0-9]{2,5})\s*\((?:file attached|fail dilampirkan)\)/im]
function attachmentName(t) { for (const r of ATT) { const m = t.match(r); if (m) return m[1].trim() } return null }

async function main() {
  const p = process.argv[2]
  if (!p) { console.error('Usage: npm run import -- "<path to the .zip, folder or .txt>"'); process.exit(1) }
  const { text, files } = readExport(p)
  let msgs = parse(text)
  if (SINCE) msgs = msgs.filter((m) => m.ts >= SINCE)
  console.log(`${msgs.length} messages from ${msgs[0]?.ts.toISOString().slice(0, 10)} to ${msgs.at(-1)?.ts.toISOString().slice(0, 10)}, ${files.size} files in the export`)
  let added = 0, skipped = 0, failed = 0, media = 0
  const toRow = (m) => {
    const row = { source: 'whatsapp', group: GROUP, msg_id: 'exp-' + hash(m.ts.toISOString() + '|' + m.sender + '|' + m.text), sender_hash: hash(m.sender), ts: m.ts.toISOString(), text: m.text.replace(/<attached:[^>]+>/gi, '').replace(/^\u200e?.+?\.[A-Za-z0-9]{2,5}\s*\((?:file attached|fail dilampirkan)\)\s*$/gim, '').replace(/[\u200e\u200f]/g, '').trim(), attachments: [] }
    const an = attachmentName(m.text)
    if (an && files.has(an) && !SKIP_MEDIA.test(an)) {
      const buf = files.get(an)()
      if (buf.length / 1e6 <= MAX_MB) {
        row.attachments.push({ name: an, mime: MIME[an.split('.').pop().toLowerCase()] || 'application/octet-stream', b64: buf.toString('base64'), sha256: crypto.createHash('sha256').update(buf).digest('hex') }); media++
      } else row.attachments.push({ name: an, skipped: 'too large' })
    } else if (an) row.attachments.push({ name: an, skipped: files.has(an) ? 'voice/video' : 'not in export' })
    if (/^<Media omitted>$|^<Media tidak disertakan>$/i.test(row.text)) row.text = ''
    return row
  }
  // Batches stay small when they carry files, so each upload is well under
  // Apps Script's request limit.
  let batch = [], size = 0
  const flush = async () => {
    if (!batch.length) return
    try { const r = await ingest(batch); added += r.added; skipped += r.skipped } catch (e) { failed += batch.length; console.error('  batch failed:', e.message) }
    batch = []; size = 0
  }
  for (let i = 0; i < msgs.length; i++) {
    const row = toRow(msgs[i])
    if (!row.text && !row.attachments.length) continue
    const s = JSON.stringify(row).length
    if (batch.length >= 25 || size + s > 8e6) await flush()
    batch.push(row); size += s
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${msgs.length}  added ${added}  already there ${skipped}  failed ${failed}`)
  }
  await flush()
  console.log(`Import done: ${added} new rows (${media} with a file), ${skipped} already there, ${failed} failed.`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e.message || e); process.exit(1) })
