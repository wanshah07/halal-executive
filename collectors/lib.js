// Shared by the three collectors: one POST to the Apps Script ingest action
// with retry. Rows: {source, group, msg_id, sender_hash, ts, text, attachments}.
import fs from 'node:fs'
import path from 'node:path'

// Settings live in collectors/.env (copy .env.example, fill it in once), so
// nothing has to be retyped in each terminal. A value already set in the
// environment wins over the file.
const ENV_FILE = new URL('./.env', import.meta.url)
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    const v = m[2].replace(/^(["'])(.*)\1$/, '$2')
    if (process.env[m[1]] === undefined || process.env[m[1]] === '') process.env[m[1]] = v
  }
}

// Chrome for WhatsApp Web. Newer npm blocks puppeteer's own download, so use
// a browser already on the machine: HE_BROWSER if set, else Chrome, else Edge
// (every Windows 10/11 PC has Edge).
export function browserPath() {
  if (process.env.HE_BROWSER) return process.env.HE_BROWSER
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', local = process.env.LOCALAPPDATA || ''
  const c = [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'), path.join(pf86, 'Google/Chrome/Application/chrome.exe'), path.join(local, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'), path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ]
  return c.find((p) => { try { return fs.existsSync(p) } catch { return false } })
}

const API = process.env.HE_API_URL
const TOKEN = process.env.HE_INGEST_TOKEN

export async function post(action, payload) {
  if (!API || !TOKEN) throw new Error('HE_API_URL and HE_INGEST_TOKEN are missing. Put them in collectors/.env (see .env.example).')
  let last
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: TOKEN, ...payload }) })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      return j
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500 * 2 ** i)) }
  }
  throw last
}
export const ingest = (rows) => post('ingest', { rows })
