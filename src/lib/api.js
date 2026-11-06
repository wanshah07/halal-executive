import { API_URL } from './config'

const CACHE_KEY = 'he:data:v1'
// A small key beside the saved copy: boot.js (src/boot.js) reads it (not the 2 MB
// copy) to skip the snapshot requests when this browser has a copy already.
const SAVED_FLAG = 'he:data:saved'

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
  if (!API_URL) { const sample = (await import('../data/sample.json')).default; return { ...sample, _source: 'sample', _fetched: new Date().toISOString() } }
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
  liveSaved = true
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); localStorage.setItem(SAVED_FLAG, '1') } catch { /* ignore */ }
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

// The snapshot comes split (Wan, 6 Nov 2026: "make faster to load";
// .github/split_feed.py): feed/core.json is the settings and run stamps (a few
// KB), every tab is a file of its own, and the FAQ answer texts (1.3 MB of the
// 2.2 MB) are in chunks of 50 rows fetched only when they are shown. A route
// waits only for the tabs it shows (ROUTE_PARTS; Admin and a route not listed
// wait for every tab); `_missing` lists the tabs not here yet. A deploy without feed/ (or a part that fails) falls
// back to the whole data.json, as before.
export const ROUTE_PARTS = { overview: ['faq', 'news', 'events', 'certificates', 'documents', 'guidelines', 'fhcb'], faq: ['faq'], certificates: ['certificates'], guidelines: ['guidelines'], references: ['references'], documents: ['documents'], events: ['events'], fhcb: ['fhcb', 'documents'], directory: ['directory'], news: ['news'], vacancies: ['vacancies'] }
export const routeParts = (route, all) => ROUTE_PARTS[route] || all
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }
const stamp = (d) => { d._source = 'sheet'; d._fetched = d.generated_at || new Date().toISOString(); d._stale = true; d._snapshot = true; return d }
// Saved like a live copy, so the next visit asks the Sheet instead of
// downloading the snapshot again; never over a live copy saved meanwhile.
let liveSaved = false
const saveSnapshot = (d) => { if (liveSaved) return; try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); localStorage.setItem(SAVED_FLAG, '1') } catch { /* ignore */ } }
async function wholeSnapshot(v) {
  try {
    const d = stripMarks(await getJson(`./data.json?t=${v}`))
    if (!d || !Array.isArray(d.faq)) return null
    stamp(d); saveSnapshot(d)
    return d
  } catch { return null }
}
// onData(d) is called with the snapshot so far each time a part lands; the
// promise resolves with the whole (answer texts aside) or null.
export async function snapshotData(route = 'overview', onData = () => {}) {
  if (!API_URL) return null
  // boot.js (src/boot.js) asked for the core and this route's parts already, while
  // this code was downloading; take its requests over when they match.
  const early = window.__heFeed && window.__heFeed.route === route ? window.__heFeed : null
  window.__heFeed = null
  const v = early ? early.v : Math.floor(Date.now() / 60000)
  let want = ROUTE_PARTS[route] || []
  const asked = {}
  const part = (p) => (asked[p] = asked[p] || (early && early.parts[p]) || getJson(`./feed/${p}.json?t=${v}`)).catch(() => null)
  want.forEach(part)
  feedV = v
  if (early && early.chunks[0]) takeChunk(0, early.chunks[0])
  if (route === 'faq') loadChunk(0)
  let core = null
  try { core = await (early ? early.core : getJson(`./feed/core.json?t=${v}`)) } catch { /* no split on this deploy */ }
  if (!core || !Array.isArray(core._parts) || !core._feed) { const d = await wholeSnapshot(v); if (d) onData(d); return d }
  splitting = true
  want = routeParts(route, core._parts)
  let d = stamp(stripMarks(core))
  d._missing = [...core._parts]
  onData(d)
  let failed = false
  const take = async (p) => {
    const rows = await part(p)
    if (!Array.isArray(rows)) { failed = true; return }
    d = { ...d, ...stripMarks({ [p]: rows }), _missing: d._missing.filter((x) => x !== p) }
    if (!failed) onData(d)
  }
  // This route's parts first; the others once its first screen (pictures
  // included) is drawn, so a phone's line carries what is on screen first.
  await Promise.all(core._parts.filter((p) => want.includes(p)).map(take))
  const rest = core._parts.filter((p) => !want.includes(p))
  if (rest.length && !failed) { await firstScreen(); await Promise.all(rest.map(take)) }
  if (failed) { const w = await wholeSnapshot(v); if (w) onData(w); wholeDone(w); return w }
  d = { ...d }; delete d._missing
  saveSnapshot(d)
  wholeDone(d)
  return d
}
// Resolves once the pictures on the first screen have loaded (at most 2.5 s
// after the page's own data), or at once when something needs every part:
// search, the Assistant and the export call wantEverything().
let hurry = () => {}
const hurried = new Promise((r) => { hurry = r })
function firstScreen() {
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  const pictures = async () => {
    // The page draws once its code and data are in: wait for its placeholder to go.
    for (let i = 0; i < 60 && (!document.querySelector('main') || document.querySelector('[data-skeleton]')); i++) await sleep(50)
    await frame(); await frame()
    const shown = [...document.querySelectorAll('main img')].filter((i) => !i.complete && i.getBoundingClientRect().top < innerHeight)
    await Promise.all(shown.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }) })))
  }
  return Promise.race([pictures(), sleep(2500), hurried])
}
let wholeDone = () => {}
const whole = new Promise((r) => { wholeDone = r })
let splitting = false
// The whole snapshot (answer texts aside) when it is still arriving, else null:
// the caller then has every part already.
export function wantEverything(d) {
  if (!d || !d._missing || !d._missing.length || !splitting) return Promise.resolve(null)
  hurry()
  return whole
}

// FAQ answer texts of a split snapshot, by FAQ id. Rows that lack them carry
// `_ac`, the chunk that holds them; withAnswers() fills what has arrived and
// "he:answers" tells the page more has.
const EMPTY_ANSWERS = { answer_formal_en: '', answer_layman_en: '', answer_formal_bm: '', answer_layman_bm: '' }
const answers = new Map()
const chunks = new Map()
let allAsked = null, allLoaded = false, notifyTimer = 0, feedV = ''
const notify = () => { if (!notifyTimer) notifyTimer = setTimeout(() => { notifyTimer = 0; dispatchEvent(new Event('he:answers')) }, 60) }
const hasAnswers = (r) => 'answer_formal_en' in r
function loadChunk(n) {
  if (!chunks.has(n)) takeChunk(n, getJson(`./feed/faq-a-${n}.json${feedV === '' ? '' : `?t=${feedV}`}`))
  return chunks.get(n)
}
function takeChunk(n, request) {
  if (!chunks.has(n)) {
    chunks.set(n, request.then((c) => {
      for (const id in c) answers.set(id, cleanRow(c[id]))
      notify()
      return true
    }).catch(() => { chunks.delete(n); return false }))
  }
}
const lite = (d) => !!d && Array.isArray(d.faq) && d.faq.some((r) => !hasAnswers(r))
// Every chunk: search, the Assistant and the FAQ export read every answer.
export function loadAllAnswers(d) {
  if (!lite(d)) return Promise.resolve()
  const n = (d._feed && d._feed.chunks) || Math.max(0, ...d.faq.map((r) => +r._ac || 0)) + 1
  // Once every chunk is in, a row none of them holds (a copy saved before the
  // last deploy) shows no answer rather than waiting for ever; the live feed
  // that follows carries it.
  if (!allAsked) allAsked = Promise.all(Array.from({ length: n }, (_, i) => loadChunk(i))).then((ok) => { if (ok.every(Boolean)) { allLoaded = true; notify() } else allAsked = null })
  return allAsked
}
// The chunks the given rows need. A chunk that did not hold a row it should
// have (a copy saved before the last deploy) means the numbering moved: then
// every chunk is fetched, since they are keyed by id.
export async function loadAnswers(d, rows) {
  const need = [...new Set((rows || []).filter((r) => !hasAnswers(r) && !answers.has(String(r.id)) && r._ac != null).map((r) => +r._ac))]
  if (!need.length) return
  const ok = await Promise.all(need.map((n) => loadChunk(n)))
  if (ok.every(Boolean) && rows.some((r) => !hasAnswers(r) && !answers.has(String(r.id)))) await loadAllAnswers(d)
}
export const answersPending = (d) => lite(withAnswers(d))
export function withAnswers(d) {
  if (!lite(d) || (!answers.size && !allLoaded)) return d
  let changed = false
  const faq = d.faq.map((r) => { if (hasAnswers(r)) return r; const a = answers.get(String(r.id)) || (allLoaded && EMPTY_ANSWERS); if (!a) return r; changed = true; return { ...r, ...a } })
  return changed ? { ...d, faq } : d
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
    data[k] = data[k].map(cleanRow)
  }
  return data
}
function cleanRow(r) {
  const o = { ...r }
  // WhatsApp message ids carry the group id, which is a phone number.
  delete o.source_refs; delete o.source_msg_id; delete o.sender_hash
  for (const f in o) {
    if (typeof o[f] !== 'string') continue
    if (o[f].includes('[')) o[f] = markText(o[f], f)
    if (/@(g|c)\.us|@lid\b/.test(o[f])) o[f] = ''
  }
  return o
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
