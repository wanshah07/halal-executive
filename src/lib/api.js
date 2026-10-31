import { API_URL } from './config'
import sample from '../data/sample.json'

const CACHE_KEY = 'he:data:v1'

// Apps Script answers with Google's HTML "Page Not Found" (HTTP 404) or a 5xx
// page when it is busy or when many calls arrive at once, and the Admin page
// opens a dozen boxes together (18 Oct 2026: Sheet feed 404, AI model HTTP 404,
// Progress and Drafts never loading). So the page keeps at most 3 calls in
// flight, and a reply that is not JSON, or is 404/429/5xx, is asked again
// after a pause (reads only: an action that writes is never repeated).
const MAX_INFLIGHT = 3
let inflight = 0
const waiting = []
const enter = () => new Promise((res) => { if (inflight < MAX_INFLIGHT) { inflight++; res() } else waiting.push(res) })
const leave = () => { const next = waiting.shift(); if (next) next(); else inflight-- }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const busy = (status) => new Error(`Google is busy (HTTP ${status}). Wait a moment and try again.`)
const TRANSIENT = (status) => status === 404 || status === 429 || status >= 500
async function gate(fn) { await enter(); try { return await fn() } finally { leave() } }
// One request, returning the parsed JSON. `delays` are the pauses before each retry.
async function fetchJson(url, init, delays) {
  let last
  for (let i = 0; i <= delays.length; i++) {
    try {
      const r = await gate(() => fetch(url, { redirect: 'follow', ...init }))
      const j = await r.json().catch(() => null)
      if (j && typeof j === 'object') return j
      last = busy(r.status)
      if (!TRANSIENT(r.status) && r.status !== 200) break
    } catch (e) { last = e }
    if (i < delays.length) await sleep(delays[i])
  }
  throw last || busy(0)
}
const READ_ACTIONS = new Set(['pipeline_status', 'llm_config', 'llm_models', 'review_list', 'ref_list', 'event_list', 'vacancy_list', 'rows_list', 'cert_files', 'admins_get', 'whoami', 'raw_stats', 'img_config'])

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
  let raw
  try { raw = await fetchJson(`${API_URL}?action=data&t=${Date.now()}`, {}, [2000, 5000]) } catch (e) {
    // Google stayed busy: show the copy this browser saved, quietly, and let the
    // page ask again in 30 seconds. Only a first visit with nothing saved sees an error.
    const saved = savedData()
    if (saved) return { ...saved, _error: String(e.message || e) }
    throw e
  }
  if (raw.ok === false) throw new Error(raw.error || 'Sheet feed error')
  const data = stripMarks(raw)
  data._source = 'sheet'
  data._fetched = new Date().toISOString()
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
  return data
}

// What the page can show before the live feed answers: the copy this browser
// saved last time (any age), else the snapshot the deploy wrote next to the
// page (data.json, refreshed after every pipeline run). Both are replaced as
// soon as Apps Script answers, which takes a few seconds.
// Delete or Hide in Admin takes the row off every page at once: this browser's
// saved copy and the page in memory (App listens for "he:drop"), before Apps
// Script has even answered. If the server refuses, "he:refresh" reloads.
const TAB_KEY = { FAQ: 'faq', Guidelines: 'guidelines', Events: 'events', Certificates: 'certificates', Documents: 'documents', News: 'news', References: 'references', FHCB: 'fhcb', Directory: 'directory', Vacancies: 'vacancies' }
export function dropLocal(tab, id) {
  const key = TAB_KEY[tab] || tab
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (c && Array.isArray(c[key])) { c[key] = c[key].filter((r) => String(r.id) !== String(id)); localStorage.setItem(CACHE_KEY, JSON.stringify(c)) }
  } catch { /* ignore */ }
  dispatchEvent(new CustomEvent('he:drop', { detail: { key, id: String(id) } }))
}
export const refreshAll = () => dispatchEvent(new Event('he:refresh'))

export function savedData() {
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (c && c.faq) return { ...c, _stale: true } } catch { /* ignore */ }
  return null
}
// A snapshot younger than this stands in for the live feed on a first visit.
// The deploy rewrites data.json after every pipeline run (every 30 minutes,
// plus a few minutes to build), so a fresh one carries what the Sheet carries;
// an older one means the pipeline has stopped, and the live feed is asked.
export const SNAPSHOT_FRESH_MS = 45 * 60 * 1000
export const snapshotFresh = (d) => !!d && d._snapshot === true && Date.now() - Date.parse(d._fetched) < SNAPSHOT_FRESH_MS
export async function snapshotData() {
  if (!API_URL) return null
  try {
    const r = await fetch(`./data.json?t=${Math.floor(Date.now() / 60000)}`)
    if (!r.ok) return null
    const d = stripMarks(await r.json())
    if (!d || !Array.isArray(d.faq)) return null
    d._source = 'sheet'; d._fetched = d.generated_at || new Date().toISOString(); d._stale = true; d._snapshot = true
    // Saved like a live copy, so the next visit asks the Sheet instead of
    // downloading the snapshot again.
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
    return d
  } catch { return null }
}

// A [SAHKAN: …] marker is a note for the pipeline, not for readers: the
// pipeline fills it from the references library or takes it out (Code.gs does
// the same before sending: a long text gets a plain request to find the
// guideline and page instead, Wan 19 Oct 2026). This catches any that slip
// through, with the same wording.
const MARK = /\s*\[SAHKAN\s*:?([^\]]*)\]/gi
const VERIFY_LONG = /(answer|summary|description|details|scope|body|note)/i
const VERIFY_EMPTY = /^(what to verify|apa yang perlu disahkan|\.\.\.|…|sahkan|verify|tbc)?$/i
export function verifyAsk(body, bm) {
  let what = String(body || '').replace(/^[\s:-]+/, '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
  if (what.length > 100 || what.length < 4 || VERIFY_EMPTY.test(what)) what = ''
  if (bm) return what ? `Perlu disahkan: ${what}. Cari garis panduan dan muka surat khusus yang menyatakannya, kemudian semak dengan Pembantu.` : 'Cari garis panduan dan muka surat khusus yang menyatakannya, kemudian semak dengan Pembantu.'
  return what ? `To confirm: ${what}. Find the specific guideline and page that state it, then check it with the Assistant.` : 'Find the specific guideline and page that state this, then check it with the Assistant.'
}
export function markText(text, key) {
  const long = VERIFY_LONG.test(key), bm = /(^|_)bm($|_)/.test(key), asks = []
  const clean = String(text).replace(MARK, (m, body) => { if (long) { const line = verifyAsk(body, bm); if (!asks.includes(line)) asks.push(line) } return '' })
    .replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim()
  return asks.length ? (clean + ' ' + asks.join(' ')).trim() : clean
}
export function stripMarks(data) {
  // A certificate whose Drive file is gone is off the site (Wan, 31 Oct 2026); Admin still lists it. An older Code.gs still sends it, so the page drops it too.
  if (Array.isArray(data.certificates)) data.certificates = data.certificates.filter((c) => c.status !== 'nofile')
  for (const k of ['faq', 'guidelines', 'events', 'documents', 'certificates', 'news']) {
    if (!Array.isArray(data[k])) continue
    data[k] = data[k].map((r) => {
      const o = { ...r }
      // WhatsApp message ids carry the group id, which is a phone number.
      delete o.source_refs; delete o.source_msg_id; delete o.sender_hash
      for (const f in o) {
        if (typeof o[f] !== 'string') continue
        if (o[f].includes('[')) o[f] = markText(o[f], f)
        if (/@(g|c)\.us|@lid\b/.test(o[f])) o[f] = ''
      }
      return o
    })
  }
  return data
}

// Apps Script web apps only accept text/plain bodies without a CORS
// preflight, so the JSON goes as text and the session travels in the body.
export async function post(action, payload = {}) {
  if (!API_URL) throw new Error('The site is not connected to the Sheet yet (VITE_API_URL is empty).')
  const j = await fetchJson(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  }, READ_ACTIONS.has(action) ? [1500, 4000] : [])
  if (!j.ok) { const e = new Error(j.error || 'Request failed'); e.code = j.error; throw e }
  return j
}

// Admin session: a one-time code sent to a registered email gives a session
// id kept in this browser's localStorage, so every tab shares it. It lasts 7
// days from the last use (the server slides it too), until Sign out.
export const SESSION_MS = 7 * 24 * 3600 * 1000
const SKEY = 'he:session'
export const getSession = () => { try { return JSON.parse(localStorage.getItem(SKEY) || 'null') } catch { return null } }
export const setSession = (s) => { try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY) } catch { /* ignore */ } }
export async function adminPost(action, payload = {}) {
  const s = getSession()
  try {
    const r = await post(action, { ...payload, session: s && s.session })
    if (s) setSession({ ...s, until: Date.now() + SESSION_MS })
    return r
  } catch (e) { if (e.code === 'unauthorised' || /Sign in/.test(e.message)) setSession(null); throw e }
}

// Certificate preview, read by Apps Script with the owner's Drive rights.
const thumbs = new Map()
export async function certThumb(id) {
  if (!API_URL || !id) return null
  if (thumbs.has(id)) return thumbs.get(id)
  // A file filed minutes ago may have no Drive preview yet: ask again after
  // 20 s and 60 s instead of remembering "no preview" for the whole visit.
  // A file Drive says does not exist (missing) is not asked for again: waiting
  // does not bring it back.
  const once = () => fetchJson(`${API_URL}?action=thumb&id=${encodeURIComponent(id)}`, {}, [])
    .then((j) => (j.ok ? { data: j.data } : { gone: !!j.missing })).catch(() => ({}))
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const p = once().then((r) => (r.data || r.gone ? r : wait(20000).then(once))).then((r) => (r.data || r.gone ? r : wait(40000).then(once)))
    .then((r) => { if (!r.data && !r.gone) thumbs.delete(id); return r.data || null })
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

// Question to the references library. Answers are cached on the server for
// 6 hours; this browser keeps the last 20 too, so a repeat is instant.
const asked = new Map()
export async function askRefs(question, lang) {
  const k = lang + '|' + question.trim().toLowerCase()
  if (asked.has(k)) return { ...asked.get(k), cached: true, ms: 0 }
  const r = await post('ask', { question, lang })
  asked.set(k, r); if (asked.size > 20) asked.delete(asked.keys().next().value)
  return r
}

// Settings only (small and quick): the popup notice uses it so a change made
// in Admin shows on the next refresh even while the full feed is loading.
export async function loadSettings() {
  if (!API_URL) return null
  try {
    const j = await fetchJson(`${API_URL}?action=settings&t=${Date.now()}`, {}, [1500])
    return j && j.ok ? j.settings : null
  } catch { return null }
}

// AI team status (cached 5 minutes on the server).
export async function aiStatus() {
  if (!API_URL) return null
  return fetchJson(`${API_URL}?action=status`, {}, [2000, 5000])
}
