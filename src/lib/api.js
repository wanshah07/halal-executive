import { API_URL } from './config'
import sample from '../data/sample.json'

const CACHE_KEY = 'he:data:v1'

// Public read. GET <API_URL>?action=data returns every published tab in one
// JSON body (see apps-script/Code.gs). With no API_URL the page runs on the
// bundled sample so the layout can be reviewed before the Sheet exists.
export async function loadData({ force = false } = {}) {
  if (!API_URL) return { ...sample, _source: 'sample', _fetched: new Date().toISOString() }
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      if (c && Date.now() - Date.parse(c._fetched) < 5 * 60 * 1000) return c
    } catch { /* ignore */ }
  }
  const r = await fetch(`${API_URL}?action=data&t=${Date.now()}`, { redirect: 'follow' })
  if (!r.ok) throw new Error(`Sheet feed ${r.status}`)
  const data = await r.json()
  data._source = 'sheet'
  data._fetched = new Date().toISOString()
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
  return data
}

// Admin write. Apps Script web apps only accept text/plain bodies without a
// CORS preflight, so the JSON goes as text and the token travels in the body.
export async function adminPost(action, payload, token) {
  if (!API_URL) throw new Error('VITE_API_URL is not set; admin writes need the Apps Script endpoint.')
  const r = await fetch(API_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token, ...payload }),
  })
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
  if (!j.ok) throw new Error(j.error || 'Write failed')
  return j
}

// Chat. The page never holds an LLM key: Apps Script calls MIRELD / AFIQ with
// keys from Script Properties and the same alternation as the pipeline.
export async function askAssistant(question, lang, context) {
  if (!API_URL) return { answer: null, offline: true }
  const r = await fetch(API_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'chat', question, lang, context }),
  })
  return r.json()
}
