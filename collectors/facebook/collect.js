// Facebook group collector. Read collectors/README.md §Facebook first.
//
//   npm run login      opens a real browser once; log in; close it
//   npm start          headless, scrolls the group feed until no new posts
//                      appear, ingests them, exits. Run once a day.
//   node collect.js --import <download.json>   ingest a Facebook data export
//
// Env: FB_GROUP_URL (https://www.facebook.com/groups/<id>), HE_API_URL,
// HE_INGEST_TOKEN. The browser profile lives in .fb-session/ (git-ignored).
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { ingest } from '../lib.js'

const URL = process.env.FB_GROUP_URL
const GROUP = process.env.HE_GROUP_NAME || 'Halal Executive'
const SALT = process.env.HE_SALT || 'halal-executive'
const PROFILE = new URL('./.fb-session', import.meta.url).pathname
const MAX_MIN = Number(process.env.FB_MAX_MINUTES || 60)
const hash = (s) => crypto.createHash('sha256').update(SALT + String(s)).digest('hex').slice(0, 16)

const imp = process.argv.indexOf('--import')
if (imp > 0) {
  const j = JSON.parse(fs.readFileSync(process.argv[imp + 1], 'utf8'))
  const posts = Array.isArray(j) ? j : j.group_posts || j.posts || []
  const rows = posts.map((p, i) => ({ source: 'facebook', group: GROUP, msg_id: String(p.id || p.timestamp || i), sender_hash: hash(p.author || ''), ts: new Date((p.timestamp || 0) * 1000).toISOString(), text: (p.data || []).map((d) => d.post).filter(Boolean).join('\n') || p.title || '', attachments: [] }))
  for (let i = 0; i < rows.length; i += 25) console.log(await ingest(rows.slice(i, i + 25)))
  process.exit(0)
}

if (!URL) { console.error('FB_GROUP_URL missing'); process.exit(1) }
const login = process.argv.includes('--login')
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: !login, viewport: { width: 1280, height: 900 } })
const page = ctx.pages()[0] || (await ctx.newPage())
await page.goto(URL, { waitUntil: 'domcontentloaded' })
if (login) { console.log('Log in, make sure the group feed is visible, then close the browser.'); await page.waitForEvent('close', { timeout: 0 }).catch(() => {}); process.exit(0) }

const seen = new Set(), deadline = Date.now() + MAX_MIN * 60e3
let idle = 0
while (Date.now() < deadline && idle < 6) {
  const posts = await page.$$eval('div[role="article"]', (els) => els.map((el) => {
    const link = el.querySelector('a[href*="/posts/"], a[href*="permalink"]')
    const t = el.querySelector('abbr, a[aria-label][href*="/posts/"] span')
    return { id: link ? link.getAttribute('href') : null, text: el.innerText.slice(0, 4000), when: t ? t.getAttribute('title') || t.textContent : '' }
  }))
  const fresh = posts.filter((p) => p.id && !seen.has(p.id))
  fresh.forEach((p) => seen.add(p.id))
  if (fresh.length) {
    const rows = fresh.map((p) => ({ source: 'facebook', group: GROUP, msg_id: p.id.replace(/^https?:\/\/[^/]+/, ''), sender_hash: hash(p.text.split('\n')[0]), ts: new Date().toISOString(), text: p.text, attachments: [] }))
    console.log(new Date().toISOString(), await ingest(rows)); idle = 0
  } else idle++
  await page.mouse.wheel(0, 2400); await page.waitForTimeout(2500)
  if (await page.$('text=/checkpoint|confirm your identity|temporarily blocked/i')) { console.error('Facebook checkpoint shown; stopping.'); break }
}
await ctx.close()
console.log(`done, ${seen.size} posts seen`)
