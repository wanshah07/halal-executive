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

// Apps Script web apps only accept text/plain bodies without a CORS
// preflight, so the JSON goes as text and the session travels in the body.
export async function post(action, payload = {}) {
  if (!API_URL) throw new Error('The site is not connected to the Sheet yet (VITE_API_URL is empty).')
  const r = await fetch(API_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  })
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
  if (!j.ok) { const e = new Error(j.error || 'Request failed'); e.code = j.error; throw e }
  return j
}

// Admin session: a one-time code sent to a registered email gives a 6-hour
// session id, kept only in this browser.
const SKEY = 'he:session'
export const getSession = () => { try { return JSON.parse(localStorage.getItem(SKEY) || 'null') } catch { return null } }
export const setSession = (s) => { try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY) } catch { /* ignore */ } }
export async function adminPost(action, payload = {}) {
  const s = getSession()
  try { return await post(action, { ...payload, session: s && s.session }) }
  catch (e) { if (e.code === 'unauthorised' || /Sign in/.test(e.message)) setSession(null); throw e }
}

// Certificate preview, read by Apps Script with the owner's Drive rights.
const thumbs = new Map()
export async function certThumb(id) {
  if (!API_URL || !id) return null
  if (thumbs.has(id)) return thumbs.get(id)
  const p = fetch(`${API_URL}?action=thumb&id=${encodeURIComponent(id)}`, { redirect: 'follow' })
    .then((r) => r.json()).then((j) => (j.ok ? j.data : null)).catch(() => null)
  thumbs.set(id, p)
  return p
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
