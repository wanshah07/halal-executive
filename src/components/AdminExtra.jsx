import { useEffect, useState } from 'react'
import { adminPost } from '../lib/api'
import { CATEGORIES } from '../lib/config'
import { t } from '../lib/i18n'
import { fmtDateTime } from '../lib/util'

const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(file) })

// References library: upload a manual, standard or circular. The next
// pipeline run (every 2 h, or Actions → Pipeline → references) reads it page
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
  const set = (id, status) => adminPost('ref_set', { id, status }).then(load).catch((e) => setMsg(e.message))
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
            </div>
          </li>
        ))}
        {rows && !rows.length && <li className="py-2 text-sm text-ink-400">{t(lang, 'library_empty')}</li>}
      </ul>
    </div>
  )
}

// Events added by hand, with an optional poster image.
const EMPTY = { id: '', title: '', title_bm: '', date_start: '', date_end: '', venue: '', link: '', description: '', poster_url: '' }
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
      if (poster) { if (poster.size > 5 * 1024 * 1024) throw new Error(t(lang, 'too_big_5')); Object.assign(payload, { poster_b64: await toB64(poster), poster_name: poster.name, poster_mime: poster.type }) }
      await adminPost('event_save', payload); setMsg(t(lang, 'saved')); setE(EMPTY); setPoster(null); const i = document.getElementById('ev-poster'); if (i) i.value = ''; load(); onChanged && onChanged()
    } catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }
  async function hide(r) { try { await adminPost('event_save', { event: { ...r, status: 'hidden' } }); load(); onChanged && onChanged() } catch (er) { setMsg(er.message) } }
  return (
    <div className="card p-5 mb-4 space-y-3">
      <h3 className="font-semibold">{t(lang, 'events_admin')}</h3>
      <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="ev-t">{t(lang, 'title')} (EN)</label><input id="ev-t" className="input" required value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-tb">{t(lang, 'title')} (BM)</label><input id="ev-tb" className="input" value={e.title_bm} onChange={(x) => setE({ ...e, title_bm: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-s">{t(lang, 'starts')}</label><input id="ev-s" type="datetime-local" className="input" required value={local(e.date_start)} onChange={(x) => setE({ ...e, date_start: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-e">{t(lang, 'ends')}</label><input id="ev-e" type="datetime-local" className="input" value={local(e.date_end)} onChange={(x) => setE({ ...e, date_end: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-v">{t(lang, 'venue')}</label><input id="ev-v" className="input" value={e.venue} onChange={(x) => setE({ ...e, venue: x.target.value })} placeholder="Online / Shah Alam" /></div>
        <div><label className="label" htmlFor="ev-l">{t(lang, 'register')} (https://…)</label><input id="ev-l" type="url" className="input" value={e.link} onChange={(x) => setE({ ...e, link: x.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="ev-d">{t(lang, 'description')}</label><textarea id="ev-d" rows={3} className="input" value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} /></div>
        <div><label className="label" htmlFor="ev-poster">{t(lang, 'poster')} (JPG/PNG · 5 MB)</label><input id="ev-poster" type="file" accept="image/*" className="input" onChange={(x) => setPoster(x.target.files[0] || null)} /></div>
        <div><label className="label" htmlFor="ev-pu">{t(lang, 'poster')} URL</label><input id="ev-pu" type="url" className="input" value={e.poster_url} onChange={(x) => setE({ ...e, poster_url: x.target.value })} placeholder="https://…" /></div>
        <div className="sm:col-span-2 flex items-center gap-3"><button className="btn-brand" disabled={busy}>{busy ? '…' : e.id ? t(lang, 'save_changes') : t(lang, 'add_event')}</button>{e.id && <button type="button" className="btn" onClick={() => setE(EMPTY)}>{t(lang, 'cancel')}</button>}{msg && <span className="text-sm text-ink-600">{msg}</span>}</div>
      </form>
      <ul className="divide-y divide-line">
        {(rows || []).filter((r) => r.status !== 'hidden').map((r) => (
          <li key={r.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
            <div className="min-w-0 flex-1"><b>{r.title}</b> <span className="text-ink-400">· {fmtDateTime(r.date_start, lang)}{r.venue ? ` · ${r.venue}` : ''} · {r.status || 'published'}{r.source === 'admin' ? '' : ' · AI'}</span></div>
            <div className="flex gap-2 shrink-0"><button className="btn" onClick={() => { setE({ ...EMPTY, ...r }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{t(lang, 'edit')}</button><button className="btn" onClick={() => hide(r)}>{t(lang, 'hide')}</button></div>
          </li>
        ))}
      </ul>
    </div>
  )
}
