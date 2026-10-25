import { useEffect, useRef, useState } from 'react'
import { adminPost, dropLocal, refreshAll } from '../lib/api'
import { safeUrl } from '../lib/safe'
import { t } from '../lib/i18n'
import { dirTypes, dirCategories, MY_STATES, COUNTRY_COORDS } from '../lib/config'
import { deleteForGood } from './AdminExtra'
import fhcbSeed from '../data/fhcb.json'
import dirSeed from '../data/directory.json'
import { ICON, Upload, Pencil, Trash2, Search } from './Icon'

const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(file) })

// Admin editors for the FHCB list and the Directory: a search box over what
// is on the page, Edit / Delete on each row, and one form to add or change a
// row. "Load" seeds the Sheet from the bundled list (JAKIM, 21 Aug 2026 /
// Jun 2026) once; after that every update is a row added, edited or deleted
// here as JAKIM gazettes it (Wan, 15 Oct 2026).
const FHCB_FIELDS = [['no', '#'], ['country', 'Country *'], ['name', 'Name *'], ['kind', 'Type', 'select', [['body', 'Certification body'], ['authority', 'Authority']]], ['address', 'Address', 'long'], ['persons', 'Contact persons (separate with ;)'], ['tel', 'Telephone (separate with ;)'], ['fax', 'Fax'], ['email', 'Email (separate with ;)'], ['website', 'Website (separate with ;)'], ['note', 'Note'], ['source_ref', 'Source (document, page)'], ['effective_date', 'Effective date (YYYY-MM-DD)'], ['status', 'Status', 'select', [['published', 'published'], ['hidden', 'hidden']]]]
const dirFields = (settings) => [['subtype', 'Category *', 'select', dirTypes(settings).map((d) => [d.id, d.id === 'jurusertu' || d.id === 'lab' ? d.en : `Training & Consultancy › ${d.en}`])], ['name', 'Name *'], ['coverage', 'Coverage area'], ['state', 'State', 'select', [['', '—'], ...MY_STATES.map((s) => [s.id, s.id])]], ['country', 'Country', 'select', [['Malaysia', 'Malaysia'], ...Object.keys(COUNTRY_COORDS).filter((c) => c !== 'Malaysia').sort().map((c) => [c, c])]], ['address', 'Address', 'long'], ['pic', 'Person in charge'], ['phone', 'Contact (separate with ;)'], ['email', 'Email'], ['website', 'Website'], ['website2', 'Corporate website'], ['accreditation', 'Accreditation / serial no. and validity'], ['description', 'Description', 'long'], ['trainers', 'Halal trainers (separate with ;)', 'long'], ['source_ref', 'Source'], ['status', 'Status', 'select', [['published', 'published'], ['hidden', 'hidden']]]]
const EMPTY = { FHCB: { kind: 'body', status: 'published', country: '', name: '' }, Directory: { subtype: 'consult', status: 'published', country: 'Malaysia', name: '' } }

export function RowManager({ lang, tab, data, onChanged }) {
  const key = tab === 'FHCB' ? 'fhcb' : 'directory'
  const fields = tab === 'FHCB' ? FHCB_FIELDS : dirFields(data && data.settings)
  const seed = tab === 'FHCB' ? fhcbSeed : dirSeed
  // Admin reads its own list (hidden rows included); the public feed drops
  // hidden rows, which would make them impossible to find again.
  const [all, setAll] = useState(null)
  const reload = () => adminPost('rows_list', { tab }).then((r) => setAll(r.rows)).catch(() => setAll(null))
  useEffect(() => { reload() }, [tab, data]) // eslint-disable-line react-hooks/exhaustive-deps
  const liveRows = all || (data && data[key]) || []
  // FHCB: the bundled JAKIM list is part of what Admin shows (101 bodies, 51 countries), and
  // any body the Sheet lacks is added to it as soon as Admin opens (Wan, 25 Oct 2026); the
  // pipeline does the same every run (seed_fhcb.py). A deleted body stays deleted.
  const goneSeed = (() => { try { return JSON.parse(((data && data.settings) || {}).seed_deleted || '[]') } catch { return [] } })()
  const missing = tab === 'FHCB' && all ? seed.filter((r) => !all.some((x) => String(x.id) === String(r.id)) && !goneSeed.includes('FHCB:' + r.id)) : []
  const live = [...liveRows, ...missing]
  const autoSeeded = useRef(false)
  useEffect(() => {
    if (!missing.length || autoSeeded.current) return
    autoSeeded.current = true
    adminPost('seed_rows', { tab, rows: seed }).then(() => { reload(); refreshAll(); onChanged && onChanged() }).catch((er) => { autoSeeded.current = false; setMsg(er.message) })
  }, [missing.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [row, setRow] = useState(null)
  const [logo, setLogo] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState({})
  const [extra, setExtra] = useState([]) // rows saved this session, until the feed refreshes
  const rows = [...extra.filter((e) => !live.some((r) => r.id === e.id)), ...live].filter((r) => !gone[r.id] && (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())))
  const label = (r) => `${r.name}${r.country && r.country !== 'Malaysia' ? ` · ${r.country}` : r.state ? ` · ${r.state}` : ''}`
  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg('')
    try {
      const r = { ...row }
      if (logo) { const up = await adminPost('logo_upload', { name: logo.name, mime: logo.type, b64: await toB64(logo) }); r.logo_url = up.url; r.logo_file = up.file }
      const res = await adminPost('row_save', { tab, row: r })
      setExtra((x) => [res.row, ...x.filter((y) => y.id !== res.row.id)]); setRow(null); setLogo(null); setMsg(t(lang, 'saved')); onChanged && onChanged()
    } catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }
  async function del(r) {
    try { if (await deleteForGood(lang, tab, r.id, label(r), () => setGone((g) => ({ ...g, [r.id]: 1 })))) { setExtra((x) => x.filter((y) => y.id !== r.id)); onChanged && onChanged() } }
    catch (er) { setGone((g) => { const n = { ...g }; delete n[r.id]; return n }); setMsg(er.message) }
  }
  async function load() {
    setBusy(true); setMsg('')
    try { const r = await adminPost('seed_rows', { tab, rows: seed }); setMsg(t(lang, 'seeded').replace('{n}', r.added).replace('{r}', r.repaired || 0)); refreshAll(); onChanged && onChanged() } catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }
  const edit = (r) => { setRow({ ...r }); setLogo(null); requestAnimationFrame(() => document.getElementById(`${tab}-form`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
  const set = (k, v) => setRow((x) => ({ ...x, [k]: v }))
  return (
    <div className="card p-5 mb-4 space-y-3">
      <h3 className="font-semibold">{t(lang, tab === 'FHCB' ? 'adm_fhcb' : 'adm_dir')} <span className="text-ink-400 font-normal">({live.length})</span></h3>
      <p className="text-sm text-ink-600">{t(lang, tab === 'FHCB' ? 'adm_fhcb_sub' : 'adm_dir_sub')}</p>
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn-brand" onClick={() => { setRow({ ...EMPTY[tab] }); setLogo(null) }}>+ {t(lang, 'add_row')}</button>
        <button className="btn" disabled={busy} onClick={load}>{t(lang, tab === 'FHCB' ? 'seed_fhcb' : 'seed_dir')}</button>
        <span className="text-xs text-ink-400">{t(lang, 'seed_hint')}</span>
      </div>
      {tab === 'FHCB' && <FhcbDocs lang={lang} data={data} onChanged={onChanged} />}
      {tab === 'Directory' && <DirCategories lang={lang} data={data} rows={live} onChanged={onChanged} />}
      {row && (
        <form id={`${tab}-form`} onSubmit={save} className="grid sm:grid-cols-2 gap-3 border border-brand-200 rounded-lg p-3 bg-brand-50/40 scroll-mt-32">
          <div className="sm:col-span-2 text-sm font-semibold">{row.id ? `${t(lang, 'edit')} · ${row.id}` : t(lang, 'add_row')}</div>
          {fields.map(([k, lab, type, opts]) => (
            <div key={k} className={type === 'long' ? 'sm:col-span-2' : ''}><label className="label" htmlFor={`${tab}-${k}`}>{lab}</label>
              {type === 'select' ? <select id={`${tab}-${k}`} className="input" value={row[k] ?? ''} onChange={(e) => set(k, e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                : type === 'long' ? <textarea id={`${tab}-${k}`} className="input" rows={3} value={row[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
                : <input id={`${tab}-${k}`} className="input" value={row[k] ?? ''} onChange={(e) => set(k, e.target.value)} required={/\*/.test(lab)} />}
            </div>
          ))}
          <div className="sm:col-span-2"><label className="label" htmlFor={`${tab}-logo`}>{t(lang, 'logo')} (JPG, PNG, WEBP, SVG · 2 MB)</label>
            <div className="flex flex-wrap items-center gap-3">
              {safeUrl(row.logo_url) && <img src={safeUrl(row.logo_url)} alt="" className="w-14 h-14 object-contain rounded border border-line bg-white" />}
              <input id={`${tab}-logo`} type="file" accept="image/*" className="input flex-1 min-w-48" onChange={(e) => setLogo(e.target.files[0] || null)} />
              <input className="input flex-1 min-w-48" placeholder="https://… (logo link)" value={row.logo_url || ''} onChange={(e) => set('logo_url', e.target.value)} aria-label="logo URL" />
            </div>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button className="btn-brand" disabled={busy}>{busy ? '…' : t(lang, 'save_row')}</button>
            <button type="button" className="btn" onClick={() => setRow(null)}>{t(lang, 'cancel')}</button>
          </div>
        </form>
      )}
      {msg && <div className="text-sm text-ink-600">{msg}</div>}
      <div className="relative"><Search {...ICON} size={16} className="absolute left-3 top-2.5 text-ink-400" /><input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'search_ph_short')} aria-label={t(lang, 'search_ph_short')} /></div>
      <ul className="divide-y divide-line max-h-96 overflow-auto">
        {rows.map((r) => (
          <li key={r.id} className="py-2 flex items-center gap-3 text-sm">
            {safeUrl(r.logo_url) ? <img src={safeUrl(r.logo_url)} alt="" loading="lazy" className="w-9 h-9 object-contain rounded border border-line bg-white shrink-0" /> : <span className="w-9 h-9 rounded border border-line bg-paper shrink-0" />}
            <div className="min-w-0 flex-1"><span className="text-ink-400 text-xs mr-2">{r.id}</span>{label(r)}{r.status === 'hidden' && <span className="chip bg-paper border border-line ml-2">hidden</span>}</div>
            <button className="btn px-2.5 shrink-0" onClick={() => edit(r)} aria-label={t(lang, 'edit')}><Pencil {...ICON} size={15} /><span className="hidden sm:inline">{t(lang, 'edit')}</span></button>
            <button className="btn px-2.5 text-red-700 shrink-0" onClick={() => del(r)} aria-label={t(lang, 'delete')}><Trash2 {...ICON} size={15} /><span className="hidden sm:inline">{t(lang, 'delete')}</span></button>
          </li>
        ))}
        {!rows.length && <li className="py-2 text-sm text-ink-400">{t(lang, 'no_data')}</li>}
      </ul>
    </div>
  )
}

// The FHCB list PDF and related circulars: uploaded to Drive and filed as
// documents of category fhcb, which the FHCB page cites and embeds.
function FhcbDocs({ lang, data, onChanged }) {
  const [file, setFile] = useState(null)
  const [kind, setKind] = useState('fhcb_list')
  const [title, setTitle] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState({})
  const docs = ((data && data.documents) || []).filter((d) => d.category === 'fhcb' && !gone[d.id])
  useEffect(() => { if (file && !title) setTitle(file.name.replace(/\.[a-z0-9]+$/i, '')) }, [file]) // eslint-disable-line react-hooks/exhaustive-deps
  async function up(e) {
    e.preventDefault(); if (!file) return
    if (file.size > 25 * 1024 * 1024) { setMsg(t(lang, 'too_big_25')); return }
    setBusy(true); setMsg('')
    try { await adminPost('fhcb_doc_upload', { name: file.name, mime: file.type || 'application/pdf', b64: await toB64(file), kind, title }); setMsg(t(lang, 'doc_uploaded')); setFile(null); setTitle(''); const i = document.getElementById('fhcb-doc'); if (i) i.value = ''; refreshAll(); onChanged && onChanged() }
    catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }
  return (
    <div className="border border-line rounded-lg p-3 space-y-2">
      <form onSubmit={up} className="grid sm:grid-cols-[auto_1fr_1fr_auto] gap-2 items-end">
        <div><label className="label" htmlFor="fhcb-doc-kind">{t(lang, 'doc_upload_fhcb')}</label>
          <select id="fhcb-doc-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="fhcb_list">{t(lang, 'doc_kind_list')}</option><option value="fhcb_circular">{t(lang, 'doc_kind_circular')}</option></select></div>
        <div><label className="label" htmlFor="fhcb-doc-title">{t(lang, 'title')}</label><input id="fhcb-doc-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Recognized FHCB & Authorities, 21 August 2026" /></div>
        <div><label className="label" htmlFor="fhcb-doc">PDF · 25 MB</label><input id="fhcb-doc" type="file" accept=".pdf,application/pdf,image/*" className="input" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
        <button className="btn-brand" disabled={busy || !file}><Upload {...ICON} size={16} />{busy ? '…' : t(lang, 'upload')}</button>
      </form>
      {msg && <div className="text-sm text-ink-600">{msg}</div>}
      <ul className="text-sm divide-y divide-line">
        {docs.map((d) => (
          <li key={d.id} className="py-1.5 flex items-center gap-2">
            <span className={`chip ${d.kind === 'fhcb_list' ? 'bg-brand-100 text-brand-700' : 'bg-paper border border-line'}`}>{t(lang, d.kind === 'fhcb_list' ? 'doc_kind_list' : 'doc_kind_circular')}</span>
            <span className="min-w-0 flex-1 truncate">{d.title}</span>
            <span className="text-xs text-ink-400">{String(d.received_at || '').slice(0, 10)}</span>
            <button className="btn px-2.5 text-red-700" onClick={() => deleteForGood(lang, 'Documents', d.id, d.title, () => setGone((g) => ({ ...g, [d.id]: 1 }))).then((ok) => { if (ok) { dropLocal('Documents', d.id); onChanged && onChanged() } }).catch((er) => setMsg(er.message))} aria-label={t(lang, 'delete')}><Trash2 {...ICON} size={15} /></button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Categories under Directory → Training & Consultancy (Wan, 15 Oct 2026):
// JAKIM's training providers, firms, freelancers, and any Wan adds. Kept in
// Settings (dir_categories). A category still used by a row cannot be
// removed until its rows move to another one.
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
function DirCategories({ lang, data, rows, onChanged }) {
  const [cats, setCats] = useState(() => dirCategories(data && data.settings))
  const [en, setEn] = useState('')
  const [bm, setBm] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setCats(dirCategories(data && data.settings)) }, [data])
  const used = (id) => rows.filter((r) => r.subtype === id).length
  async function store(next) {
    setBusy(true); setMsg('')
    try { await adminPost('settings', { settings: { dir_categories: JSON.stringify(next) } }); setCats(next); setMsg(t(lang, 'saved')); onChanged && onChanged() }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  function add(e) {
    e.preventDefault()
    const id = slug(en); if (!id) return
    if (cats.some((c) => c.id === id) || id === 'jurusertu' || id === 'lab') { setMsg(t(lang, 'cat_exists')); return }
    store([...cats, { id, en: en.trim(), bm: bm.trim() || en.trim() }]).then(() => { setEn(''); setBm('') })
  }
  const rename = (id, k, v) => setCats((cs) => cs.map((c) => (c.id === id ? { ...c, [k]: v } : c)))
  return (
    <div className="border border-line rounded-lg p-3 space-y-2">
      <div className="text-sm font-semibold">{t(lang, 'cat_title')}</div>
      <p className="text-xs text-ink-400">{t(lang, 'cat_hint')}</p>
      <ul className="space-y-1.5">
        {cats.map((c) => (
          <li key={c.id} className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-center text-sm">
            <input className="input py-1.5" value={c.en} onChange={(e) => rename(c.id, 'en', e.target.value)} aria-label="Name (EN)" />
            <input className="input py-1.5" value={c.bm || ''} onChange={(e) => rename(c.id, 'bm', e.target.value)} aria-label="Nama (BM)" />
            <span className="text-xs text-ink-400 whitespace-nowrap">{used(c.id)} {t(lang, 'cat_rows')}</span>
            <button type="button" className="btn px-2.5 py-1 text-red-700" disabled={busy || used(c.id) > 0} title={used(c.id) ? t(lang, 'cat_in_use') : t(lang, 'delete')}
              onClick={() => store(cats.filter((x) => x.id !== c.id))} aria-label={t(lang, 'delete')}><Trash2 {...ICON} size={15} /></button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => store(cats)}>{t(lang, 'cat_save_names')}</button>
      </div>
      <form onSubmit={add} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 pt-2 border-t border-line">
        <input className="input" value={en} onChange={(e) => setEn(e.target.value)} placeholder={t(lang, 'cat_new_en')} aria-label={t(lang, 'cat_new_en')} />
        <input className="input" value={bm} onChange={(e) => setBm(e.target.value)} placeholder={t(lang, 'cat_new_bm')} aria-label={t(lang, 'cat_new_bm')} />
        <button className="btn-brand" disabled={busy || !en.trim()}>+ {t(lang, 'add_row')}</button>
      </form>
      {msg && <div className="text-sm text-ink-600">{msg}</div>}
    </div>
  )
}
