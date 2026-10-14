// Telegram collector. Create a bot with @BotFather, turn privacy mode OFF
// (/setprivacy → Disable) so it sees every group message, add it to the
// "Halal Executive" group, then:  TELEGRAM_BOT_TOKEN=… npm start
// The Bot API only delivers messages from the moment the bot joins; for
// history, export the chat from Telegram Desktop (JSON) and run
//   node collect.js --import result.json
import TelegramBot from 'node-telegram-bot-api'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { ingest } from '../lib.js'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const GROUP = process.env.HE_GROUP_NAME || 'Halal Executive'
const SALT = process.env.HE_SALT || 'halal-executive'
const hash = (s) => crypto.createHash('sha256').update(SALT + String(s)).digest('hex').slice(0, 16)

const imp = process.argv.indexOf('--import')
if (imp > 0) {
  const j = JSON.parse(fs.readFileSync(process.argv[imp + 1], 'utf8'))
  const rows = (j.messages || []).filter((m) => m.type === 'message').map((m) => ({ source: 'telegram', group: j.name || GROUP, msg_id: String(m.id), sender_hash: hash(m.from_id), ts: new Date(m.date).toISOString(), text: Array.isArray(m.text) ? m.text.map((t) => (typeof t === 'string' ? t : t.text)).join('') : m.text || '', attachments: m.file ? [{ name: m.file_name || m.file, mime: m.mime_type || '', note: 'exported file; attach by hand or re-share in the group' }] : [] }))
  for (let i = 0; i < rows.length; i += 25) console.log(await ingest(rows.slice(i, i + 25)))
  process.exit(0)
}

if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN missing'); process.exit(1) }
const bot = new TelegramBot(TOKEN, { polling: true })
console.log('Telegram polling…')

bot.on('message', async (m) => {
  try {
    if (!m.chat || !['group', 'supergroup'].includes(m.chat.type) || m.chat.title !== GROUP) return
    const row = { source: 'telegram', group: m.chat.title, msg_id: `${m.chat.id}:${m.message_id}`, sender_hash: hash(m.from && m.from.id), ts: new Date(m.date * 1000).toISOString(), text: m.text || m.caption || '', attachments: [] }
    const doc = m.document || (m.photo && m.photo[m.photo.length - 1])
    if (doc) {
      const link = await bot.getFileLink(doc.file_id)
      const buf = Buffer.from(await (await fetch(link)).arrayBuffer())
      row.attachments.push({ name: doc.file_name || `${doc.file_unique_id}.jpg`, mime: doc.mime_type || 'image/jpeg', b64: buf.toString('base64'), sha256: crypto.createHash('sha256').update(buf).digest('hex') })
    }
    console.log(new Date().toISOString(), await ingest([row]))
  } catch (e) { console.error('ingest failed', e.message || e) }
})
