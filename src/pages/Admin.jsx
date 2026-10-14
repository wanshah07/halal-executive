import { useEffect, useState } from 'react'
import { adminPost, post, getSession, setSession, dropLocal, refreshAll } from '../lib/api'
import { API_URL } from '../lib/config'
import { t } from '../lib/i18n'
import { fmtDateTime } from '../lib/util'
import { safeUrl } from '../lib/safe'
import { RefAdmin, EventsAdmin, ContentManager, deleteForGood } from '../components/AdminExtra'
import { POSTER_ACCEPT, POSTER_MAX } from '../components/Poster'
import { ICON, Lock, RefreshCw, Upload, X, Play } from '../components/Icon'
import { subscribe, enqueue, retry, forget } from '../lib/uploadQueue'

// Admin panel, locked. A registered email asks for a code, the code arrives
// by email from the Sheet's Apps Script, and the session lasts 6 hours.
// Only emails in ADMIN_EMAILS (managed below) can get a code.
const FIELDS = [
  ['hero_title', 'hero_title'], ['hero_subtitle', 'hero_sub'], ['hero_subtitle_bm', 'hero_sub'], ['hero_image', 'hero_image'], ['hero_cta', 'hero_cta'], ['hero_cta_url', 'hero_cta_url'],
]

function SignIn({ lang, onIn }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('email')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function send(e) {
    e.preventDefault(); setBusy(true); setMsg('')
    try { const r = await post('login_request', { email }); setMsg(r.message); setStep('code') } catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }
  async function verify(e) {
    e.preventDefault(); setBusy(true); setMsg('')
    try { const r = await post('login_verify', { email, code }); const s = { session: r.session, email: r.email, until: Date.now() + r.expires_in * 1000 }; setSession(s); onIn(s) } catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }
  return (
    <div className="max-w-md">
      <div className="card p-6">
        <div className="mb-3 text-ink-900"><Lock {...ICON} size={32} /></div>
        <h2 className="text-xl font-bold">{t(lang, 'admin_locked')}</h2>
        <p className="text-sm text-ink-600 mt-1 mb-4">{t(lang, 'admin_locked_sub')}</p>
        {!API_URL && <div className="card p-3 mb-4 text-sm bg-amber-50 border-amber-200">{t(lang, 'not_connected')}</div>}
        {step === 'email' && (
          <form onSubmit={send} className="space-y-3">
            <div><label className="label" htmlFor="adm-email">{t(lang, 'email')}</label><input id="adm-email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <button className="btn-brand" disabled={busy || !API_URL}>{busy ? '…' : t(lang, 'send_code')}</button>
          </form>
        )}
        {step === 'code' && (
          <form onSubmit={verify} className="space-y-3">
            <div><label className="label" htmlFor="adm-code">{t(lang, 'code')} ({email})</label><input id="adm-code" className="input tracking-[0.4em] text-lg" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <div className="flex gap-2"><button className="btn-brand" disabled={busy}>{busy ? '…' : t(lang, 'sign_in')}</button><button type="button" className="btn" onClick={() => { setStep('email'); setCode(''); setMsg('') }}>{t(lang, 'other_email')}</button></div>
          </form>
        )}
        {msg && <p className="text-sm text-ink-600 mt-3" role="status">{msg}</p>}
      </div>
    </div>
  )
}

// Upload screenshots or files for the AI to read. Each file becomes a Raw
// row (source "manual"); the next pipeline run reads its text (OCR for
// images and scans, Word, Excel, PowerPoint, PDF) and writes FAQ entries,
// or files it as a halal certificate when marked as one.
const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.odt,.ods,.odp,.rtf'
const MAX_BYTES = 10 * 1024 * 1024
const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(file) })

function UploadBox({ lang }) {
  const [kind, setKind] = useState('faq')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])
  const [queue, setQueue] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => subscribe(setQueue), [])
  async function send(e) {
    e.preventDefault()
    if (!files.length && !note.trim()) return
    const big = files.find((f) => f.size > MAX_BYTES)
    if (big) { setErr(`${big.name}: ${t(lang, 'too_big')}`); return }
    setErr('')
    await enqueue({ kind, note, files })
    setFiles([]); setNote('')
    const input = document.getElementById('up-files'); if (input) input.value = ''
  }
  const line = (x) => {
    if (x.state === 'sent') {
      const r = x.result || {}
      return [r.chat ? t(lang, 'chat_imported').replace('{n}', r.messages).replace('{a}', r.added).replace('{s}', r.skipped) : t(lang, 'q_sent'), r.run === 'started' ? t(lang, 'ai_started') : t(lang, 'q_next_run')].join(' · ')
    }
    return x.state === 'failed' ? x.msg : x.state === 'sending' ? t(lang, 'q_sending') : t(lang, 'q_waiting') + (x.msg ? ` (${x.msg})` : '')
  }
  return (
    <form onSubmit={send} className="card p-5 mb-4 space-y-3">
      <h3 className="font-semibold">{t(lang, 'upload_title')}</h3>
      <p className="text-sm text-ink-600">{t(lang, 'upload_sub')}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="up-kind">{t(lang, 'upload_kind')}</label>
          <select id="up-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="faq">{t(lang, 'kind_faq')}</option>
            <option value="certificate">{t(lang, 'kind_cert')}</option>
            <option value="guideline">{t(lang, 'kind_guideline')}</option>
            <option value="event">{t(lang, 'kind_event')}</option>
          </select></div>
        <div><label className="label" htmlFor="up-files">{t(lang, 'upload_files')}</label>
          <input id="up-files" type="file" multiple accept={ACCEPT} className="input" onChange={(e) => setFiles(Array.from(e.target.files || []))} /></div>
      </div>
      <div><label className="label" htmlFor="up-note">{t(lang, 'upload_note')}</label><textarea id="up-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t(lang, 'upload_note_ph')} /></div>
      {!!files.length && <div className="text-xs text-ink-600">{files.map((f) => `${f.name} (${Math.round(f.size / 1024)} KB)`).join(' · ')}</div>}
      <div className="flex items-center gap-3"><button className="btn-brand" disabled={!files.length && !note.trim()}>{t(lang, 'upload_send')}</button><span className="text-xs text-ink-400">{t(lang, 'q_note')}</span></div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {!!queue.length && (
        <ul className="text-sm space-y-1">
          {queue.slice().reverse().map((x) => (
            <li key={x.id} className={`flex flex-wrap items-center gap-x-2 ${x.state === 'failed' ? 'text-red-600' : x.state === 'sent' ? 'text-brand-700' : 'text-ink-600'}`}>
              <span>{x.state === 'sent' ? '✓' : x.state === 'failed' ? '✕' : '⏳'} {x.name || t(lang, 'note_only')} · {t(lang, 'kind_' + (x.kind === 'certificate' ? 'cert' : x.kind))}</span>
              <span className="text-ink-400">· {line(x)}</span>
              {x.state === 'failed' && <button type="button" className="underline" onClick={() => retry(x.id)}>{t(lang, 'q_retry')}</button>}
              {(x.state === 'failed' || x.state === 'sent') && <button type="button" className="underline text-ink-400" onClick={() => forget(x.id)}>{t(lang, 'q_clear')}</button>}
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

// Drafts from the pipeline. Nothing the AI writes with less than high
// confidence reaches the public page until an admin publishes it here.
// Start the pipeline now instead of waiting for the next :10 / :40 slot.
const RUN_JOBS = ['process_whatsapp', 'uploads', 'references', 'sahkan', 'news', 'organise', 'process_facebook']
function RunNow({ lang, runs, stats }) {
  const [job, setJob] = useState('process_whatsapp')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const last = (runs || [])[0]
  async function go() {
    setBusy(true); setMsg('')
    try { const r = await adminPost('run_now', { job }); setMsg(r.message) } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="card p-5 mb-4 space-y-3">
      <h3 className="font-semibold">{t(lang, 'run_now_title')}</h3>
      <p className="text-sm text-ink-600">{t(lang, 'run_now_sub')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={job} onChange={(e) => setJob(e.target.value)} aria-label={t(lang, 'run_now_title')}>
          {RUN_JOBS.map((j) => <option key={j} value={j}>{t(lang, 'job_' + j)}</option>)}
        </select>
        <button className="btn-brand" onClick={go} disabled={busy}><Play {...ICON} size={16} />{busy ? '…' : t(lang, 'run_now')}</button>
        {msg && <span className="text-sm text-ink-600">{msg}</span>}
      </div>
      {stats && (() => {
        const waiting = stats.new || 0, done = stats.processed || 0, skipped = stats.skipped || 0, all = waiting + done + skipped
        return (
          <div className="text-sm">
            <div className="flex justify-between text-ink-600"><span>{t(lang, 'ai_queue')}: <b>{waiting.toLocaleString()}</b> {t(lang, 'waiting')} · {done.toLocaleString()} {t(lang, 'read_done')} · {skipped.toLocaleString()} {t(lang, 'filtered')}</span></div>
            <div className="h-1.5 bg-line rounded-full mt-1 overflow-hidden"><div className="h-full bg-brand-600" style={{ width: all ? `${Math.round(((done + skipped) / all) * 100)}%` : '0%' }} /></div>
          </div>
        )
      })()}
      {last && <p className="text-xs text-ink-400">{t(lang, 'last_run')}: {last.job} · {fmtDateTime(last.ts, lang)} · {last.ok === false || last.ok === 'FALSE' ? '✕' : '✓'} {last.provider || ''}</p>}
    </div>
  )
}

// What is running now: the live log the pipeline writes phase by phase, the
// GitHub runs, the AI queue and whether WhatsApp is linked. Refreshes every
// 20 seconds while the tab is open. The work itself runs on GitHub and Apps
// Script, so it carries on with this page (or the PC) closed.
const ago = (iso, lang) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (!(m >= 0)) return ''
  if (m < 1) return lang === 'bm' ? 'baru tadi' : 'just now'
  if (m < 60) return lang === 'bm' ? `${m} min lalu` : `${m} min ago`
  const h = Math.floor(m / 60)
  return lang === 'bm' ? `${h} jam lalu` : `${h} h ago`
}
function ProgressBox({ lang }) {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState('')
  const load = () => adminPost('pipeline_status').then((r) => { setSt(r); setErr('') }).catch((e) => setErr(e.message))
  useEffect(() => {
    load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, 20000)
    return () => clearInterval(id)
  }, [])
  const wa = st && st.collectors && st.collectors.whatsapp
  const waAge = wa ? (Date.now() - Date.parse(wa.ts)) / 60000 : Infinity
  const waOk = waAge <= 15 && (!wa.state || wa.state === 'CONNECTED')
  const raw = (st && st.raw) || {}
  const waiting = raw.new || 0, done = raw.processed || 0, skipped = raw.skipped || 0, failedRows = raw.error || 0, all = waiting + done + skipped + failedRows
  const runs = (st && st.github && st.github.runs) || []
  const running = runs.find((r) => r.status === 'in_progress')
  const queued = runs.filter((r) => r.status === 'queued' || r.status === 'pending' || r.status === 'waiting').length
  const watch = (st && st.watch) || {}
  const badge = (r) => r.status !== 'completed' ? (r.status === 'in_progress' ? ['bg-amber-100 text-amber-800', t(lang, 'p_running')] : ['bg-muted text-ink-600', t(lang, 'p_queued')])
    : r.conclusion === 'success' ? ['bg-brand-50 text-brand-700', t(lang, 'p_ok')] : r.conclusion === 'cancelled' ? ['bg-muted text-ink-600', t(lang, 'p_cancelled')] : ['bg-red-50 text-red-700', t(lang, 'p_failed')]
  return (
    <div className="card p-5 mb-4 space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">{t(lang, 'p_title')}</h3><button className="btn" onClick={load} aria-label="refresh"><RefreshCw {...ICON} size={16} /></button></div>
      <p className="text-sm text-ink-600">{t(lang, 'p_sub')}</p>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {!st && !err && <div className="text-sm text-ink-400">{t(lang, 'loading')}</div>}
      {st && (<>
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div className={`rounded-lg border p-3 ${waOk ? 'border-brand-200 bg-brand-50' : 'border-red-200 bg-red-50'}`}>
            <div className="text-xs text-ink-400">WhatsApp</div>
            <div className="font-semibold">{waOk ? t(lang, 'p_wa_ok') : t(lang, 'p_wa_bad')}</div>
            <div className="text-xs text-ink-600">{wa ? `${t(lang, 'p_heartbeat')} ${ago(wa.ts, lang)}${wa.state ? ` · ${wa.state}` : ''}` : t(lang, 'p_never')}</div>
          </div>
          <div className="rounded-lg border border-line p-3">
            <div className="text-xs text-ink-400">{t(lang, 'p_now')}</div>
            <div className="font-semibold">{running ? `#${running.n} ${t(lang, 'job_' + running.job) || running.job}` : t(lang, 'p_idle')}</div>
            <div className="text-xs text-ink-600">{running ? `${t(lang, 'p_since')} ${ago(running.started, lang)}` : ''}{queued ? ` · ${queued} ${t(lang, 'p_in_line')}` : ''}</div>
          </div>
          <div className="rounded-lg border border-line p-3">
            <div className="text-xs text-ink-400">{t(lang, 'ai_queue')}</div>
            <div className="font-semibold">{waiting.toLocaleString()} {t(lang, 'waiting')}</div>
            <div className="h-1.5 bg-line rounded-full mt-1 overflow-hidden"><div className="h-full bg-brand-600" style={{ width: all ? `${Math.round(((all - waiting) / all) * 100)}%` : '0%' }} /></div>
            <div className="text-xs text-ink-600 mt-1">{done.toLocaleString()} {t(lang, 'read_done')} · {skipped.toLocaleString()} {t(lang, 'filtered')}{failedRows ? ` · ${failedRows} ${t(lang, 'p_row_errors')}` : ''}</div>
          </div>
        </div>
        {(watch.whatsapp || watch.pipeline) && (
          <ul className="text-sm text-red-700 space-y-1">{['whatsapp', 'pipeline'].filter((k) => watch[k]).map((k) => <li key={k}>⚠ {watch[k].msg} <span className="text-ink-400">({t(lang, 'p_since')} {ago(watch[k].since, lang)})</span></li>)}</ul>
        )}
        {!!runs.length && (
          <div>
            <h4 className="text-sm font-semibold mb-1">{t(lang, 'p_runs')}</h4>
            <ul className="text-sm divide-y divide-line">
              {runs.map((r) => { const [cls, word] = badge(r); return (
                <li key={r.n} className="py-1.5 flex flex-wrap items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{word}</span>
                  <span>#{r.n} {t(lang, 'job_' + r.job) || r.job}</span>
                  <span className="text-ink-400 text-xs">{fmtDateTime(r.started, lang)}</span>
                  <a className="text-xs underline text-ink-400 ml-auto" href={r.url} target="_blank" rel="noopener noreferrer">{t(lang, 'p_log')}</a>
                </li>) })}
            </ul>
          </div>
        )}
        {st.github && st.github.error && <div className="text-xs text-ink-400">GitHub: {st.github.error}</div>}
        <div>
          <h4 className="text-sm font-semibold mb-1">{t(lang, 'p_live_log')}</h4>
          <ol className="text-xs font-mono bg-muted rounded-lg p-3 max-h-72 overflow-auto space-y-0.5">
            {(st.log || []).slice().reverse().map((l, i) => (
              <li key={i} className={l.state === 'failed' ? 'text-red-700' : l.state === 'done' ? 'text-brand-700' : 'text-ink-900'}>
                <span className="text-ink-400">{fmtDateTime(l.ts, lang)}</span> [{l.job}] {l.text}{l.left !== undefined && l.state === 'running' ? ` · ${l.left.toLocaleString()} ${t(lang, 'waiting')}` : ''}
              </li>))}
            {!(st.log || []).length && <li className="text-ink-400">{t(lang, 'p_no_log')}</li>}
          </ol>
        </div>
      </>)}
    </div>
  )
}

function ReviewBox({ lang, onChanged }) {
  const [drafts, setDrafts] = useState(null)
  const [open, setOpen] = useState([])
  const [shown, setShown] = useState({})
  const [msg, setMsg] = useState('')
  const load = () => adminPost('review_list').then((r) => { setDrafts(r.drafts); setOpen(r.to_confirm || []) }).catch((e) => setMsg(e.message))
  useEffect(() => { load() }, [])
  // The row leaves the list at once; the server write follows.
  const without = (tab, id) => setDrafts((d) => (d ? { ...d, [tab]: (d[tab] || []).filter((r) => r.id !== id) } : d))
  async function set(tab, id, status) {
    without(tab, id); if (status === 'hidden') dropLocal(tab, id)
    try { await adminPost('review_set', { tab, id, status }); onChanged && onChanged() } catch (e) { setMsg(e.message); load(); refreshAll() }
  }
  const items = drafts ? Object.entries(drafts).flatMap(([tab, rows]) => rows.map((r) => ({ tab, r }))) : []
  const title = ({ tab, r }) => tab === 'FAQ' ? (r.question_en || r.question_bm) : tab === 'Certificates' ? r.company : r.title
  // Every field the draft carries, so it can be read in full before publishing.
  const FULL = {
    FAQ: [['question_en', 'Question (EN)'], ['question_bm', 'Soalan (BM)'], ['answer_formal_en', 'Answer, formal (EN)'], ['answer_layman_en', 'Answer, simple (EN)'], ['answer_formal_bm', 'Jawapan, rasmi (BM)'], ['answer_layman_bm', 'Jawapan, mudah (BM)'], ['subcategory', 'Subcategory']],
    Events: [['title', 'Title'], ['title_bm', 'Tajuk (BM)'], ['date_start', 'Date'], ['venue', 'Venue'], ['link', 'Link'], ['description', 'Description']],
    Guidelines: [['title', 'Title'], ['title_bm', 'Tajuk (BM)'], ['issuer', 'Issuer'], ['summary_en', 'Summary (EN)'], ['summary_bm', 'Ringkasan (BM)'], ['link', 'Link']],
    Certificates: [['company', 'Company'], ['cert_no', 'Certificate no.'], ['scheme', 'Scheme'], ['state', 'State'], ['valid_from', 'Valid from'], ['valid_to', 'Valid to'], ['products', 'Products'], ['drive_url', 'File']],
  }
  const body = ({ tab, r }) => tab === 'FAQ' ? (r.answer_formal_en || r.answer_layman_en) : tab === 'Events' ? `${r.date_start || ''} ${r.venue || ''} ${r.description || ''}` : tab === 'Certificates' ? `${r.scheme || ''} · ${r.valid_from || ''} → ${r.valid_to || ''}` : (r.summary_en || '')
  return (
    <div className="card p-5 mb-4 space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">{t(lang, 'review_title')} {drafts && <span className="text-ink-400 font-normal">({items.length})</span>}</h3><button className="btn" onClick={load} aria-label="refresh"><RefreshCw {...ICON} size={16} /></button></div>
      <p className="text-sm text-ink-600">{t(lang, 'review_sub')}</p>
      {!drafts && !msg && <div className="text-sm text-ink-400">{t(lang, 'loading')}</div>}
      {drafts && !items.length && <div className="text-sm text-ink-400">{t(lang, 'review_empty')}</div>}
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.tab + it.r.id} className="py-3 flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink-400">{it.tab} · {it.r.id}{it.r.category ? ` · ${it.r.category}` : ''}{it.r.confidence ? ` · ${it.r.confidence}` : ''}</div>
              <button type="button" className="font-medium text-left hover:underline" aria-expanded={!!shown[it.tab + it.r.id]} onClick={() => setShown((x) => ({ ...x, [it.tab + it.r.id]: !x[it.tab + it.r.id] }))}>{title(it)}</button>
              {shown[it.tab + it.r.id] ? (
                <dl className="mt-2 space-y-2 text-sm">
                  {(FULL[it.tab] || []).filter(([k]) => it.r[k]).map(([k, label]) => (
                    <div key={k}><dt className="text-xs text-ink-400">{label}</dt>
                      <dd className="whitespace-pre-wrap break-words text-ink-900">{/^https?:\/\//.test(String(it.r[k])) ? <a className="underline text-brand-700" href={safeUrl(it.r[k])} target="_blank" rel="noopener noreferrer">{it.r[k]}</a> : String(it.r[k])}</dd></div>
                  ))}
                </dl>
              ) : (
                <button type="button" className="w-full text-left text-sm text-ink-600 line-clamp-3 whitespace-pre-wrap" onClick={() => setShown((x) => ({ ...x, [it.tab + it.r.id]: true }))}>{body(it)} <span className="text-brand-700">{t(lang, 'read_full')}</span></button>
              )}
            </div>
            <div className="flex gap-2 shrink-0"><button className="btn-brand" onClick={() => set(it.tab, it.r.id, 'published')}>{t(lang, 'publish')}</button><button className="btn" onClick={() => set(it.tab, it.r.id, 'hidden')}>{t(lang, 'hide')}</button><button className="btn text-red-700" onClick={() => deleteForGood(lang, it.tab, it.r.id, title(it), () => without(it.tab, it.r.id)).catch((e) => { setMsg(e.message); load() })}>{t(lang, 'delete')}</button></div>
          </li>
        ))}
      </ul>
      {!!open.length && (
        <div className="pt-3 border-t border-line">
          <h4 className="font-semibold text-sm">{t(lang, 'to_confirm')} <span className="text-ink-400 font-normal">({open.reduce((n, r) => n + r.notes.length, 0)})</span></h4>
          <p className="text-sm text-ink-600 mb-2">{t(lang, 'to_confirm_sub')}</p>
          <ul className="space-y-2 text-sm">
            {open.map((r) => (
              <li key={r.id}><div className="font-medium">{lang === 'bm' ? r.question_bm || r.question_en : r.question_en || r.question_bm}</div>
                <ul className="list-disc pl-5 text-ink-600">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></li>
            ))}
          </ul>
        </div>
      )}
      {msg && <div className="text-sm text-red-600">{msg}</div>}
    </div>
  )
}

export default function Admin({ lang, data, onSaved, onSession }) {
  const [sess, setSess] = useState(() => { const s = getSession(); return s && s.until > Date.now() ? s : null })
  // Signing in or out in another tab applies here too.
  useEffect(() => {
    const h = (e) => { if (e.key === 'he:session') { const s = getSession(); setSess(s && s.until > Date.now() ? s : null) } }
    addEventListener('storage', h); return () => removeEventListener('storage', h)
  }, [])
  const [s, setS] = useState({})
  const [posters, setPosters] = useState([])
  const [upIdx, setUpIdx] = useState(-1)
  // A poster file goes to Drive straight away; the row keeps its preview
  // image and the original file, and Save writes the list to the Sheet.
  async function uploadPoster(i, f) {
    if (!f) return
    if (f.size > POSTER_MAX) { setMsg(t(lang, 'too_big_10')); return }
    setUpIdx(i); setMsg('')
    try { const r = await adminPost('poster_upload', { name: f.name, mime: f.type || '', b64: await toB64(f) }); setPosters((ps) => ps.map((x, j) => j === i ? { ...x, url: r.url, file: r.file } : x)); setMsg(t(lang, 'poster_uploaded')) }
    catch (er) { setMsg(er.message) } finally { setUpIdx(-1) }
  }
  const [admins, setAdmins] = useState([])
  const [owner, setOwner] = useState('')
  const [newAdmin, setNewAdmin] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { onSession && onSession(!!sess) }, [sess, onSession])
  useEffect(() => {
    const st = data.settings || {}
    setS(st)
    try { setPosters(JSON.parse(st.posters || '[]')) } catch { setPosters([]) }
  }, [data])
  useEffect(() => {
    if (!sess) return
    adminPost('admins_get').then((r) => { setAdmins(r.emails); setOwner(r.owner) }).catch(() => { setSess(null) })
  }, [sess])

  if (!sess) return <SignIn lang={lang} onIn={setSess} />

  const set = (k, v) => setS((x) => ({ ...x, [k]: v }))
  async function save() {
    setBusy(true); setMsg('')
    try {
      await adminPost('settings', { settings: { ...s, posters: JSON.stringify(posters.filter((p) => p.url)) } })
      setMsg(t(lang, 'saved')); onSaved && onSaved()
    } catch (e) { setMsg(e.message); if (!getSession()) setSess(null) } finally { setBusy(false) }
  }
  async function saveAdmins(list) {
    try { const r = await adminPost('admins_set', { emails: list }); setAdmins(r.emails); setNewAdmin('') } catch (e) { setMsg(e.message) }
  }
  async function signOut() { try { await post('logout', { session: sess.session }) } catch { /* ignore */ } setSession(null); setSess(null) }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-xl font-bold">{t(lang, 'admin')}</h2>
        <div className="text-sm text-ink-600">{t(lang, 'signed_in_as')} <b>{sess.email}</b> · <button className="text-brand-600 hover:underline" onClick={signOut}>{t(lang, 'sign_out')}</button></div>
      </div>
      <p className="text-sm text-ink-600 mb-4">{t(lang, 'admin_intro')}</p>

      <RunNow lang={lang} runs={data && data.runs} stats={data && data.raw_stats} />
      <ProgressBox lang={lang} />
      <ReviewBox lang={lang} onChanged={onSaved} />
      <ContentManager lang={lang} data={data} onChanged={onSaved} />
      <UploadBox lang={lang} />
      <RefAdmin lang={lang} />
      <EventsAdmin lang={lang} onChanged={onSaved} />

      <div className="card p-5 mb-4 space-y-3">
        <h3 className="font-semibold">Hero</h3>
        {FIELDS.map(([k, label]) => (
          <div key={k}><label className="label" htmlFor={'f-' + k}>{t(lang, label)} <span className="text-ink-400">({k})</span></label><input id={'f-' + k} className="input" value={s[k] || ''} onChange={(e) => set(k, e.target.value)} /></div>
        ))}
      </div>

      <div className="card p-5 mb-4 space-y-3">
        <h3 className="font-semibold">{t(lang, 'notice')}</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={String(s.notice_enabled) === 'true'} onChange={(e) => set('notice_enabled', e.target.checked ? 'true' : 'false')} /> {t(lang, 'notice_enabled')}</label>
        <div><label className="label" htmlFor="f-nt">{t(lang, 'notice_title')}</label><input id="f-nt" className="input" value={s.notice_title || ''} onChange={(e) => set('notice_title', e.target.value)} /></div>
        <div><label className="label" htmlFor="f-nb">{t(lang, 'notice_body')} (EN)</label><textarea id="f-nb" className="input" rows={3} value={s.notice_body || ''} onChange={(e) => set('notice_body', e.target.value)} /></div>
        <div><label className="label" htmlFor="f-nbm">{t(lang, 'notice_body')} (BM)</label><textarea id="f-nbm" className="input" rows={3} value={s.notice_body_bm || ''} onChange={(e) => set('notice_body_bm', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="f-nl">{t(lang, 'notice_level')}</label><select id="f-nl" className="input" value={s.notice_level || 'info'} onChange={(e) => set('notice_level', e.target.value)}><option value="info">info</option><option value="warning">warning</option><option value="danger">danger</option></select></div>
          <div><label className="label" htmlFor="f-nu">{t(lang, 'notice_until')}</label><input id="f-nu" className="input" value={s.notice_until || ''} onChange={(e) => set('notice_until', e.target.value)} placeholder="2026-12-31" /></div>
        </div>
      </div>

      <div className="card p-5 mb-4 space-y-3">
        <div className="flex justify-between items-center"><h3 className="font-semibold">{t(lang, 'posters')}</h3><button className="btn" onClick={() => setPosters((p) => [...p, { title: '', url: '', link: '' }])}>+ {t(lang, 'add_poster')}</button></div>
        {posters.map((p, i) => (
          <div key={i} className="grid md:grid-cols-[1fr_2fr_2fr_auto_auto] gap-2 items-start">
            <input className="input" placeholder="Title" value={p.title} onChange={(e) => setPosters((ps) => ps.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
            <input className="input" placeholder="Image URL" value={p.url} onChange={(e) => setPosters((ps) => ps.map((x, j) => j === i ? { ...x, url: e.target.value, file: '' } : x))} />
            <input className="input" placeholder="Click-through link" value={p.link} onChange={(e) => setPosters((ps) => ps.map((x, j) => j === i ? { ...x, link: e.target.value } : x))} />
            <label className="btn cursor-pointer whitespace-nowrap" title={t(lang, 'poster_formats')}>{upIdx === i ? '…' : <><Upload {...ICON} size={16} /> {t(lang, 'upload')}</>}<input type="file" accept={POSTER_ACCEPT} className="sr-only" disabled={upIdx >= 0} onChange={(e) => { uploadPoster(i, e.target.files[0]); e.target.value = '' }} /></label>
            <button className="btn" onClick={() => setPosters((ps) => ps.filter((_, j) => j !== i))} aria-label="remove"><X {...ICON} size={16} /></button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-8">
        <button className="btn-brand" onClick={save} disabled={busy}>{busy ? '…' : t(lang, 'save')}</button>
        {msg && <span className="text-sm text-ink-600">{msg}</span>}
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">{t(lang, 'registered_emails')}</h3>
        <p className="text-sm text-ink-600">{t(lang, 'registered_emails_sub')}</p>
        <ul className="divide-y divide-line">
          {admins.map((e) => (
            <li key={e} className="py-2 flex items-center justify-between text-sm">
              <span>{e}{e === owner && <span className="chip bg-brand-100 text-brand-700 ml-2">{t(lang, 'owner')}</span>}</span>
              {e !== owner && <button className="btn" onClick={() => saveAdmins(admins.filter((x) => x !== e))}>{t(lang, 'remove')}</button>}
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newAdmin) saveAdmins([...admins, newAdmin]) }}>
          <input id="adm-new" className="input" type="email" placeholder="name@example.com" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} aria-label={t(lang, 'add_email')} />
          <button className="btn">{t(lang, 'add_email')}</button>
        </form>
      </div>
    </div>
  )
}
