import { useEffect, useState } from 'react'
import { adminPost, dropLocal, refreshAll } from '../lib/api'
import { imageUrl, safeUrl } from '../lib/safe'
import { CATEGORIES, EVENT_KINDS } from '../lib/config'
import { ICON, Sparkles } from './Icon'
import { t } from '../lib/i18n'
import { fmtDateTime, fmtDate } from '../lib/util'
import { filedDocs, certStatus } from '../lib/certs'
import { qrLinks } from '../lib/qr'
import Stamps from './Stamps'
import { POSTER_ACCEPT, POSTER_MAX } from './Poster'

// Delete for good: the row, and its Drive file where it owns one (Code.gs
// adminDelete). Asks first, because nothing can bring it back.
export async function deleteForGood(lang, tab, id, label, onGone) {
  if (!window.confirm(t(lang, 'delete_confirm').replace('{x}', label || id))) return false
  dropLocal(tab, id); onGone && onGone() // gone from every page now; the server catches up below
  try { await adminPost('admin_delete', { tab, id }) } catch (e) {
    if (/not found/i.test(e.message)) return true // already deleted
    refreshAll(); throw e
  }
  refreshAll()
  return true
}

const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(file) })

// References library: upload a manual, standard or circular. The next
// pipeline run (every 30 min, or Actions → Pipeline → references) reads it page
// by page and it becomes searchable in the References tab.
export function RefAdmin({ lang }) {
  const [rows, setRows] = useState(null)
  const [f, setF] = useState({ title: '', issuer: '', edition: '', category: 'halal' })
  const [file, setFile] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => adminPost('ref_list').then((r) => setRows(r.rows)).catch((e) => setMsg(e.message))
  useEffect(() => { load() }, [])
  async function upload(e) {
    e.preventDefault(); if (!file) return
    if (file.size > 25 * 1024 * 1024) { setMsg(t(lang, 'too_big_25')); return }
    setBusy(true); setMsg('')
    try { await adminPost('ref_upload', { ...f, name: file.name, mime: file.type || '', b64: await toB64(file) }); setMsg(t(lang, 'ref_queued')); setFile(null); setF({ title: '', issuer: '', edition: '', category: f.category }); const i = document.getElementById('ref-file'); if (i) i.value = ''; load() }
    catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }
  const set = (id, status) => adminPost('ref_set', { id, status })
    .then((r) => { setMsg(status === 'pending' ? (r.run === 'started' ? t(lang, 'reread_started') : t(lang, 'reread_queued')) : ''); load() })
    .catch((e) => setMsg(e.message))
  const tone = { indexed: 'bg-brand-100 text-brand-700', pending: 'bg-amber-100 text-amber-800', error: 'bg-red-100 text-red-700', hidden: 'bg-paper text-ink-400 border border-line' }
  return (
    <div className="card p-5 mb-4 space-y-3">
      <h3 className="font-semibold">{t(lang, 'ref_admin')}</h3>
      <p className="text-sm text-ink-600">{t(lang, 'ref_admin_sub')}</p>
      <form onSubmit={upload} className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label className="label" htmlFor="ref-title">{t(lang, 'title')}</label><input id="ref-title" className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Manual Prosedur Pensijilan Halal Malaysia (Domestik) 2020" /></div>
        <div><label className="label" htmlFor="ref-issuer">{t(lang, 'issuer')}</label><input id="ref-issuer" className="input" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="JAKIM" /></div>
        <div><label className="label" htmlFor="ref-ed">{t(lang, 'edition')}</label><input id="ref-ed" className="input" value={f.edition} onChange={(e) => setF({ ...f, edition: e.target.value })} placeholder="2020" /></div>
        <div><label className="label" htmlFor="ref-cat">{t(lang, 'category')}</label><select id="ref-cat" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c[lang] || c.en}</option>)}</select></div>
        <div><label className="label" htmlFor="ref-file">{t(lang, 'upload_files')} (PDF, Word, Excel, PowerPoint, TXT · 25 MB)</label><input id="ref-file" type="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.odt" className="input" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
        <div className="sm:col-span-2 flex items-center gap-3"><button className="btn-brand" disabled={busy || !file}>{busy ? '…' : t(lang, 'ref_add')}</button>{msg && <span className="text-sm text-ink-600">{msg}</span>}</div>
      </form>
      <ul className="divide-y divide-line">
        {(rows || []).map((r) => (
          <li key={r.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
            <div className="min-w-0 flex-1"><span className={`chip ${tone[r.status] || ''} mr-2`}>{r.status}</span><b>{r.title}</b> <span className="text-ink-400">{[r.issuer, r.edition].filter(Boolean).join(' · ')}{r.chunks ? ` · ${r.pages} ${t(lang, 'pages')}, ${r.chunks} ${t(lang, 'passages')}` : ''}{r.error ? ` · ${r.error}` : ''}</span></div>
            <div className="flex gap-2 shrink-0">
              <button className="btn" onClick={() => set(r.id, 'pending')}>{t(lang, 'reindex')}</button>
              {r.status !== 'hidden' ? <button className="btn" onClick={() => set(r.id, 'hidden')}>{t(lang, 'hide')}</button> : <button className="btn" onClick={() => set(r.id, 'pending')}>{t(lang, 'restore')}</button>}
              <button className="btn text-red-700" onClick={() => deleteForGood(lang, 'References', r.id, r.title, () => setRows((rs) => (rs || []).filter((x) => x.id !== r.id))).catch((e) => { setMsg(e.message); load() })}>{t(lang, 'delete')}</button>
            </div>
          </li>
        ))}
        {rows && !rows.length && <li className="py-2 text-sm text-ink-400">{t(lang, 'library_empty')}</li>}
      </ul>
    </div>
  )
}

// Events added by hand, with an optional poster: a picture, PDF, PowerPoint or
// Word file, or a link (a Google Drive share link works too).
const EMPTY = { id: '', title: '', title_bm: '', date_start: '', date_end: '', venue: '', link: '', description: '', poster_url: '', poster_file: '', kind: 'other' }
export function EventsAdmin({ lang, onChanged }) {
  const [rows, setRows] = useState(null)
  const [e, setE] = useState(EMPTY)
  const [poster, setPoster] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => adminPost('event_list').then((r) => setRows(r.rows.sort((a, b) => Date.parse(b.date_start || 0) - Date.parse(a.date_start || 0)))).catch((er) => setMsg(er.message))
  useEffect(() => { load() }, [])
  const local = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16) }
  async function save(ev) {
    ev.preventDefault(); setBusy(true); setMsg('')
    try {
      const payload = { event: { ...e, date_start: e.date_start ? new Date(e.date_start).toISOString() : '', date_end: e.date_end ? new Date(e.date_end).toISOString() : '' } }
      if (poster) { if (poster.size > POSTER_MAX) throw new Error(t(lang, 'too_big_10')); Object.assign(payload, { poster_b64: await toB64(poster), poster_name: poster.name, poster_mime: poster.type }) }
      await adminPost('event_save', payload); setMsg(t(lang, 'saved')); setE(EMPTY); setPoster(null); const i = document.getElementById('ev-poster'); if (i) i.value = ''; load(); onChanged && onChanged()
    } catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }
  // Choosing a poster: it is stored in Drive and the AI reads it and fills the
  // form, like an uploaded halal certificate. Fields already typed are kept.
  async function readPoster(f) {
    if (!f) return
    if (f.size > POSTER_MAX) { setMsg(t(lang, 'too_big_10')); return }
    setBusy(true); setMsg(t(lang, 'reading_poster'))
    try {
      // The QR code is read in the browser, from the picture itself, while the
      // AI reads the words; a PDF or Office poster is read from its preview.
      const qrNow = /^image\//.test(f.type || '') ? qrLinks(f).catch(() => []) : Promise.resolve([])
      const r = await adminPost('event_from_poster', { b64: await toB64(f), name: f.name, mime: f.type || '' })
      setPoster(null)
      let qr = (await qrNow)[0]
      if (!qr && r.qr_image) qr = (await qrLinks(r.qr_image).catch(() => []))[0]
      let kept = ''
      setE((cur) => {
        const next = { ...cur, poster_url: r.poster_url, poster_file: r.poster_file }
        Object.entries(r.fields || {}).forEach(([k, v]) => { if (!cur[k]) next[k] = v })
        // The code on the poster is the registration link: it beats a link the AI
        // guessed from the words, but never a link already typed in the form.
        if (qr) { if (cur.link && cur.link !== qr) kept = qr; else next.link = qr }
        return next
      })
      const base = r.note || (r.is_event === false ? t(lang, 'poster_not_event') : t(lang, 'poster_read'))
      setMsg(qr ? `${base} ${kept ? t(lang, 'qr_kept').replace('{u}', kept) : t(lang, 'qr_found').replace('{u}', qr)}` : base)
    } catch (er) { setMsg(er.message) } finally { setBusy(false); const i = document.getElementById('ev-poster'); if (i) i.value = '' }
  }
  async function remove(r) { try { if (await deleteForGood(lang, 'Events', r.id, r.title, () => setRows((rs) => (rs || []).filter((x) => x.id !== r.id)))) onChanged && onChanged() } catch (er) { setMsg(er.message); load() } }
  async function hide(r) {
    setRows((rs) => (rs || []).filter((x) => x.id !== r.id)); dropLocal('Events', r.id)
    try { await adminPost('event_save', { event: { ...r, status: 'hidden' } }); onChanged && onChanged() } catch (er) { setMsg(er.message); load(); refreshAll() }
  }
  return (
    <div className="card p-5 mb-4 space-y-3">
      <h3 className="font-semibold">{t(lang, 'events_admin')}</h3>
      <form id="event-form" onSubmit={save} className="grid sm:grid-cols-2 gap-3 scroll-mt-32">
        <div><label className="label" htmlFor="ev-t">{t(lang, 'title')} (EN)</label><input id="ev-t" className="input" required value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-tb">{t(lang, 'title')} (BM)</label><input id="ev-tb" className="input" value={e.title_bm} onChange={(x) => setE({ ...e, title_bm: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-k">{t(lang, 'event_kind')}</label><select id="ev-k" className="input" value={e.kind || 'other'} onChange={(x) => setE({ ...e, kind: x.target.value })}>{EVENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k[lang] || k.en}</option>)}</select></div>
        <div><label className="label" htmlFor="ev-s">{t(lang, 'starts')}</label><input id="ev-s" type="datetime-local" className="input" required value={local(e.date_start)} onChange={(x) => setE({ ...e, date_start: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-e">{t(lang, 'ends')}</label><input id="ev-e" type="datetime-local" className="input" value={local(e.date_end)} onChange={(x) => setE({ ...e, date_end: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-v">{t(lang, 'venue')}</label><input id="ev-v" className="input" value={e.venue} onChange={(x) => setE({ ...e, venue: x.target.value })} placeholder="Online / Shah Alam" /></div>
        <div><label className="label" htmlFor="ev-l">{t(lang, 'register')} (https://…)</label><input id="ev-l" type="url" className="input" value={e.link} onChange={(x) => setE({ ...e, link: x.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="ev-d">{t(lang, 'description')}</label><textarea id="ev-d" rows={3} className="input" value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-poster">{t(lang, 'poster')} ({t(lang, 'poster_formats')})</label><input id="ev-poster" type="file" accept={POSTER_ACCEPT} className="input" disabled={busy} onChange={(x) => readPoster(x.target.files[0] || null)} /></div>
        <div><label className="label" htmlFor="ev-pu">{t(lang, 'poster')} URL</label><input id="ev-pu" type="url" className="input" value={e.poster_url} onChange={(x) => setE({ ...e, poster_url: x.target.value, poster_file: '' })} placeholder="https://… / Google Drive link" /></div>
        {imageUrl(e.poster_url) && <div className="sm:col-span-2 flex items-center gap-3"><img src={imageUrl(e.poster_url)} alt="" className="w-20 h-28 object-cover rounded-lg border border-line" /><span className="text-xs text-ink-400">{t(lang, 'poster')}</span></div>}
        <div className="sm:col-span-2 flex items-center gap-3"><button className="btn-brand" disabled={busy}>{busy ? '…' : e.id ? t(lang, 'save_changes') : t(lang, 'add_event')}</button>{e.id && <button type="button" className="btn" onClick={() => setE(EMPTY)}>{t(lang, 'cancel')}</button>}{msg && <span className="text-sm text-ink-600">{msg}</span>}</div>
      </form>
      <ul className="divide-y divide-line">
        {(rows || []).filter((r) => r.status !== 'hidden').map((r) => (
          <li key={r.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
            <div className="min-w-0 flex-1"><b>{r.title}</b> <span className="text-ink-400">· {fmtDateTime(r.date_start, lang)}{r.venue ? ` · ${r.venue}` : ''} · {r.status || 'published'}{r.source === 'admin' ? '' : ' · AI'}</span></div>
            <div className="flex gap-2 shrink-0"><button className="btn" onClick={() => {
              setE({ ...EMPTY, ...r })
              // To the event form in this panel (not the top of the page), title ready to type.
              requestAnimationFrame(() => { const f = document.getElementById('event-form'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.querySelector('input')?.focus({ preventScroll: true }) } })
            }}>{t(lang, 'edit')}</button><button className="btn" onClick={() => hide(r)}>{t(lang, 'hide')}</button><button className="btn text-red-700" onClick={() => remove(r)}>{t(lang, 'delete')}</button></div>
          </li>
        ))}
      </ul>
    </div>
  )
}


// Everything already on the page, with Delete for good. Hide stays available
// through Drafts to review / the Sheet; this is for removing a row entirely.
const MANAGED = [['FAQ', 'faq', (r, lang) => (lang === 'bm' ? r.question_bm || r.question_en : r.question_en || r.question_bm)],
  ['Guidelines', 'guidelines', (r, lang) => (lang === 'bm' ? r.title_bm || r.title : r.title)],
  ['Certificates', 'certificates', (r) => `${r.company || ''} · ${r.cert_no || ''}`],
  ['Documents', 'documents', (r) => r.title],
  ['News', 'news', (r) => r.title]]
// A halal certificate's own Documents row is managed under Halal Certificates.
const listOf = (data, key) => (key === 'documents' ? filedDocs(data && data.documents) : (data && data[key]) || [])
const FAQ_EDIT = [['category', 'Category'], ['subcategory', 'Subcategory'], ['question_en', 'Question (EN)'], ['question_bm', 'Soalan (BM)'], ['answer_formal_en', 'Answer, formal (EN)', 1], ['answer_layman_en', 'Answer, simple (EN)', 1], ['answer_formal_bm', 'Jawapan, rasmi (BM)', 1], ['answer_layman_bm', 'Jawapan, mudah (BM)', 1]]
export function ContentManager({ lang, data, onChanged }) {
  const [tab, setTab] = useState('FAQ')
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [gone, setGone] = useState({})
  const [edit, setEdit] = useState(null) // { id, fields }
  const [busy, setBusy] = useState(false)
  const [patched, setPatched] = useState({})
  const startEdit = (r) => { const f = {}; FAQ_EDIT.forEach(([k]) => { f[k] = r[k] ?? '' }); setEdit({ id: r.id, fields: f }); setMsg('') }
  async function rephrase(r) {
    if (!edit || edit.id !== r.id) startEdit(r)
    setBusy(true); setMsg(t(lang, 'rephrasing'))
    try { const x = await adminPost('faq_rephrase', { id: r.id }); setEdit((e) => ({ id: r.id, fields: { ...(e && e.id === r.id ? e.fields : Object.fromEntries(FAQ_EDIT.map(([k]) => [k, r[k] ?? '']))), ...x.fields } })); setMsg(t(lang, 'rephrased')) }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  async function saveEdit() {
    setBusy(true); setMsg('')
    try { await adminPost('review_save', { tab: 'FAQ', id: edit.id, fields: edit.fields }); setPatched((p) => ({ ...p, [edit.id]: edit.fields })); setEdit(null); setMsg(t(lang, 'saved')); onChanged && onChanged() }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  const [, key, label] = MANAGED.find((m) => m[0] === tab)
  const rows = listOf(data, key).map((r) => patched[r.id] ? { ...r, ...patched[r.id] } : r).filter((r) => !gone[tab + r.id] && (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())))
  async function del(r) {
    try { if (await deleteForGood(lang, tab, r.id, label(r, lang), () => setGone((g) => ({ ...g, [tab + r.id]: 1 })))) { setMsg(t(lang, 'deleted')) } } catch (e) { setGone((g) => { const n = { ...g }; delete n[tab + r.id]; return n }); setMsg(e.message) }
  }
  return (
    <div className="card p-5 mb-4 space-y-3">
      <h3 className="font-semibold">{t(lang, 'manage_title')}</h3>
      <p className="text-sm text-ink-600">{t(lang, 'manage_sub')}</p>
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={tab} onChange={(e) => setTab(e.target.value)} aria-label={t(lang, 'manage_title')}>
          {MANAGED.map(([k, d]) => <option key={k} value={k}>{t(lang, d)} ({listOf(data, d).length})</option>)}
        </select>
        <input className="input flex-1 min-w-40" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'search_ph')} />
      </div>
      {tab === 'FAQ' && <p className="text-xs text-ink-400">{t(lang, 'manage_faq_hint')}</p>}
      {msg && <div className="text-sm text-ink-600">{msg}</div>}
      <ul className="divide-y divide-line max-h-[32rem] overflow-auto">
        {rows.map((r) => (
          <li key={r.id} className="py-2 text-sm">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1"><span className="text-ink-400 text-xs mr-2">{r.id}</span>{label(r, lang)}<Stamps r={r} lang={lang} className="text-xs text-ink-400" /></div>
              {tab === 'FAQ' && <button className="btn px-2.5 shrink-0" onClick={() => startEdit(r)}>{t(lang, 'edit')}</button>}
              {tab === 'FAQ' && <button className="btn px-2.5 shrink-0" disabled={busy} onClick={() => rephrase(r)}><Sparkles {...ICON} size={15} />{t(lang, 'rephrase')}</button>}
              <button className="btn text-red-700 shrink-0" onClick={() => del(r)}>{t(lang, 'delete')}</button>
            </div>
            {edit && edit.id === r.id && (
              <div className="mt-2 grid sm:grid-cols-2 gap-3 border border-brand-200 rounded-lg p-3 bg-brand-50/40">
                {FAQ_EDIT.map(([k, lab, long]) => (
                  <div key={k} className={long ? 'sm:col-span-2' : ''}><label className="label" htmlFor={`cm-${r.id}-${k}`}>{lab}</label>
                    {long ? <textarea id={`cm-${r.id}-${k}`} className="input" rows={4} value={edit.fields[k]} onChange={(e) => setEdit({ ...edit, fields: { ...edit.fields, [k]: e.target.value } })} />
                      : <input id={`cm-${r.id}-${k}`} className="input" value={edit.fields[k]} onChange={(e) => setEdit({ ...edit, fields: { ...edit.fields, [k]: e.target.value } })} />}
                  </div>
                ))}
                <div className="sm:col-span-2 flex flex-wrap gap-2">
                  <button className="btn-brand" disabled={busy} onClick={saveEdit}>{busy ? '…' : t(lang, 'save_changes')}</button>
                  <button className="btn" disabled={busy} onClick={() => rephrase(r)}><Sparkles {...ICON} size={15} />{t(lang, 'rephrase')}</button>
                  <button className="btn" onClick={() => setEdit(null)}>{t(lang, 'cancel')}</button>
                </div>
              </div>
            )}
          </li>
        ))}
        {!rows.length && <li className="py-2 text-sm text-ink-400">{t(lang, 'no_data')}</li>}
      </ul>
    </div>
  )
}

// Every halal certificate, for Admin: its status, dates, and whether its file is
// still in Drive (Code.gs certFilesCheck). A file in Drive's trash can be
// restored; one that is not found has to be uploaded again. Hide takes a
// certificate off the site without deleting it; Delete removes it and its file.
const CERT_TONE = { valid: 'bg-brand-100 text-brand-700', expiring: 'bg-amber-100 text-amber-800', expired: 'bg-red-100 text-red-700' }
export function CertAdmin({ lang, data, onChanged }) {
  const [rows, setRows] = useState(null)
  const [old, setOld] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState('all')
  const run = (fresh, keepErr) => {
    setBusy(true); if (!keepErr) setErr(''); setOld(false)
    adminPost('cert_files', fresh ? { fresh: true } : {}).then((r) => setRows(r.rows)).catch((e) => {
      if (/unknown action/i.test(e.message)) { setOld(true); setRows(((data && data.certificates) || []).map((c) => ({ ...c, state: '?' }))) } else setErr(e.message)
    }).finally(() => setBusy(false))
  }
  useEffect(() => { run(false) }, [])
  const all = rows || []
  const bad = all.filter((r) => r.state !== 'ok' && r.state !== '?' && r.status !== 'hidden')
  const list = all.filter((r) => (only === 'all' || (only === 'missing' ? r.state !== 'ok' && r.state !== '?' : r.status === 'hidden')) && (!q || JSON.stringify([r.company, r.cert_no, r.scheme, r.id]).toLowerCase().includes(q.toLowerCase())))
  async function toggleHide(r) {
    const hide = r.status !== 'hidden'
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: hide ? 'hidden' : 'current' } : x)))
    try { await adminPost('review_set', { tab: 'Certificates', id: r.id, status: hide ? 'hidden' : 'current' }); if (hide) dropLocal('Certificates', r.id); else refreshAll(); onChanged && onChanged() } catch (e) { setErr(e.message); run(true, true) }
  }
  async function remove(r) {
    try { if (await deleteForGood(lang, 'Certificates', r.id, r.company || r.cert_no, () => setRows((rs) => rs.filter((x) => x.id !== r.id)))) onChanged && onChanged() } catch (e) { setErr(e.message); run(true, true) }
  }
  const stateChip = (r) => r.state === 'ok' ? <span className="chip bg-brand-100 text-brand-700">{t(lang, 'ca_file_ok')}</span>
    : r.state === '?' ? null : <span className={`chip ${r.state === 'trash' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>{t(lang, 'cf_state_' + r.state)}</span>
  return (
    <div className="card p-5 mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-semibold">{t(lang, 'ca_title')} {rows && <span className="text-ink-400 font-normal">({all.length})</span>}</h3><p className="text-xs text-ink-600">{t(lang, 'ca_sub')}</p></div>
        <button type="button" className="btn" disabled={busy} onClick={() => run(true)}>{busy ? t(lang, 'cf_checking') : t(lang, 'cf_check')}</button>
      </div>
      {old && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{t(lang, 'ca_old')}</p>}
      {err && <p className="text-sm text-red-700">{err}</p>}
      {rows && !old && (bad.length
        ? <p className="text-sm text-red-700">{t(lang, 'cf_bad').replace('{m}', bad.length).replace('{n}', all.length)} <span className="text-ink-600">{t(lang, 'cf_help')}</span></p>
        : <p className="text-sm text-brand-700">{t(lang, 'cf_ok').replace('{n}', all.length)}</p>)}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-auto min-w-48" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'search_ph_short')} aria-label={t(lang, 'search_ph_short')} />
        {[['all', 'ca_f_all'], ['missing', 'ca_f_missing'], ['hidden', 'ca_f_hidden']].map(([k, l]) => <button key={k} type="button" className={`chip border ${only === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-paper border-line'}`} onClick={() => setOnly(k)}>{t(lang, l)}</button>)}
      </div>
      <ul className="divide-y divide-line max-h-[34rem] overflow-auto">
        {list.map((r) => {
          const st = certStatus(r)
          return (
            <li key={r.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-ink-400">{r.id}</span><span className="font-medium">{r.company || <i className="text-ink-400 font-normal">{t(lang, 'untitled_cert')}</i>}</span>
                    <span className={`chip ${CERT_TONE[st] || 'bg-paper border border-line'}`}>{t(lang, st)}</span>{r.status === 'hidden' && <span className="chip bg-paper border border-line text-ink-600">{t(lang, 'ca_f_hidden')}</span>}{stateChip(r)}</div>
                  <div className="text-xs text-ink-600">{[r.scheme, r.cert_no].filter(Boolean).join(' · ')}{r.valid_to ? ` · ${t(lang, 'valid_to')} ${fmtDate(r.valid_to, lang)}` : ''}</div>
                  <Stamps r={r} lang={lang} className="text-xs text-ink-400" />
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {safeUrl(r.drive_url) && <a className="btn px-2.5" href={safeUrl(r.drive_url)} target="_blank" rel="noreferrer">{t(lang, 'ca_open')}</a>}
                  <button type="button" className="btn px-2.5" onClick={() => toggleHide(r)}>{r.status === 'hidden' ? t(lang, 'publish') : t(lang, 'hide')}</button>
                  <button type="button" className="btn px-2.5 text-red-700" onClick={() => remove(r)}>{t(lang, 'delete')}</button>
                </div>
              </div>
            </li>)
        })}
        {rows && !list.length && <li className="py-3 text-sm text-ink-400">{t(lang, 'no_data')}</li>}
      </ul>
    </div>
  )
}
