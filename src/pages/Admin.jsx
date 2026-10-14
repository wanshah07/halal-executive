import { useEffect, useState } from 'react'
import { adminPost, post, getSession, setSession } from '../lib/api'
import { API_URL } from '../lib/config'
import { t } from '../lib/i18n'
import { RefAdmin, EventsAdmin } from '../components/AdminExtra'
import { POSTER_ACCEPT, POSTER_MAX } from '../components/Poster'

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
        <div className="text-3xl mb-2" aria-hidden="true">🔒</div>
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
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  async function send(e) {
    e.preventDefault()
    if (!files.length && !note.trim()) return
    setBusy(true); setLog([])
    const items = files.length ? files : [null]
    for (const f of items) {
      const label = f ? f.name : t(lang, 'note_only')
      try {
        if (f && f.size > MAX_BYTES) throw new Error(t(lang, 'too_big'))
        const payload = { kind, note, name: f && f.name, mime: f && (f.type || ''), b64: f ? await toB64(f) : '' }
        await adminPost('manual_upload', payload)
        setLog((l) => [...l, { label, ok: true }])
      } catch (er) { setLog((l) => [...l, { label, ok: false, msg: er.message }]) }
    }
    setBusy(false); setFiles([]); setNote('')
    const input = document.getElementById('up-files'); if (input) input.value = ''
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
      <div className="flex items-center gap-3"><button className="btn-brand" disabled={busy || (!files.length && !note.trim())}>{busy ? '…' : t(lang, 'upload_send')}</button><span className="text-xs text-ink-400">{t(lang, 'upload_when')}</span></div>
      {!!log.length && <ul className="text-sm space-y-1">{log.map((x, i) => <li key={i} className={x.ok ? 'text-brand-700' : 'text-red-600'}>{x.ok ? '✓' : '✕'} {x.label}{x.msg ? ` · ${x.msg}` : ''}</li>)}</ul>}
    </form>
  )
}

// Drafts from the pipeline. Nothing the AI writes with less than high
// confidence reaches the public page until an admin publishes it here.
function ReviewBox({ lang, onChanged }) {
  const [drafts, setDrafts] = useState(null)
  const [open, setOpen] = useState([])
  const [msg, setMsg] = useState('')
  const load = () => adminPost('review_list').then((r) => { setDrafts(r.drafts); setOpen(r.to_confirm || []) }).catch((e) => setMsg(e.message))
  useEffect(() => { load() }, [])
  async function set(tab, id, status) {
    try { await adminPost('review_set', { tab, id, status }); await load(); onChanged && onChanged() } catch (e) { setMsg(e.message) }
  }
  const items = drafts ? Object.entries(drafts).flatMap(([tab, rows]) => rows.map((r) => ({ tab, r }))) : []
  const title = ({ tab, r }) => tab === 'FAQ' ? (r.question_en || r.question_bm) : tab === 'Certificates' ? r.company : r.title
  const body = ({ tab, r }) => tab === 'FAQ' ? (r.answer_formal_en || r.answer_layman_en) : tab === 'Events' ? `${r.date_start || ''} ${r.venue || ''} ${r.description || ''}` : tab === 'Certificates' ? `${r.scheme || ''} · ${r.valid_from || ''} → ${r.valid_to || ''}` : (r.summary_en || '')
  return (
    <div className="card p-5 mb-4 space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">{t(lang, 'review_title')} {drafts && <span className="text-ink-400 font-normal">({items.length})</span>}</h3><button className="btn" onClick={load}>⟳</button></div>
      <p className="text-sm text-ink-600">{t(lang, 'review_sub')}</p>
      {!drafts && !msg && <div className="text-sm text-ink-400">{t(lang, 'loading')}</div>}
      {drafts && !items.length && <div className="text-sm text-ink-400">{t(lang, 'review_empty')}</div>}
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.tab + it.r.id} className="py-3 flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink-400">{it.tab} · {it.r.id}{it.r.category ? ` · ${it.r.category}` : ''}{it.r.confidence ? ` · ${it.r.confidence}` : ''}</div>
              <div className="font-medium">{title(it)}</div>
              <div className="text-sm text-ink-600 line-clamp-3 whitespace-pre-wrap">{body(it)}</div>
            </div>
            <div className="flex gap-2 shrink-0"><button className="btn-brand" onClick={() => set(it.tab, it.r.id, 'published')}>{t(lang, 'publish')}</button><button className="btn" onClick={() => set(it.tab, it.r.id, 'hidden')}>{t(lang, 'hide')}</button></div>
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

      <ReviewBox lang={lang} onChanged={onSaved} />
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
            <label className="btn cursor-pointer whitespace-nowrap" title={t(lang, 'poster_formats')}>{upIdx === i ? '…' : `⬆ ${t(lang, 'upload')}`}<input type="file" accept={POSTER_ACCEPT} className="sr-only" disabled={upIdx >= 0} onChange={(e) => { uploadPoster(i, e.target.files[0]); e.target.value = '' }} /></label>
            <button className="btn" onClick={() => setPosters((ps) => ps.filter((_, j) => j !== i))}>✕</button>
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
