import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Segment from '../components/Segment'
import { t } from '../lib/i18n'
import { safeUrl } from '../lib/safe'
import { fmtDate } from '../lib/util'
import { DIRECTORY_SECTIONS, dirCategories, dirTypes, sectionOf, countryCoords, stateCoords, guessState } from '../lib/config'
import seed from '../data/directory.json'
import { ICON, Mail, Phone, MapPin, ExternalLink } from '../components/Icon'
import Lightbox from '../components/Lightbox'

const MapView = lazy(() => import('../components/MapView'))

// Directory: halal training providers registered with JAKIM and service
// providers (jurusertu, training and consultancy, laboratories). Rows live in
// the Sheet's Directory tab, added and edited in Admin; until it is seeded the
// bundled register (JAKIM, Jun 2026) shows.
export const directoryRows = (data) => {
  const live = (data.directory || []).filter((r) => r.status !== 'hidden')
  return live.length ? live : seed
}
const splitList = (s) => String(s || '').split(/;\s*/).map((x) => x.trim()).filter(Boolean)
const siteHref = (w) => { const s = String(w || '').trim(); return safeUrl(/^https?:\/\//i.test(s) ? s : 'https://' + s) }
export const typeName = (id, lang, settings) => { const x = dirTypes(settings).find((d) => d.id === id); return x ? x[lang] || x.en : id || '—' }

export default function Directory({ lang, data, sub: subKey, setTab }) {
  // Sections: Training & Consultancy (with its categories), Sertu, Laboratory.
  // Older links (#directory/plh, /consult) open Training & Consultancy.
  const cur = DIRECTORY_SECTIONS.find((d) => d.sub === subKey) || DIRECTORY_SECTIONS[0]
  const cats = dirCategories(data.settings)
  const [cat, setCat] = useState('all')
  const [place, setPlace] = useState('all')
  useEffect(() => { setPlace('all'); setCat('all') }, [cur.sub])
  const [q, setQ] = useState('')
  const [zoom, setZoom] = useState(null)
  const all = useMemo(() => directoryRows(data).map((r) => ({ ...r, _state: r.state || guessState(r.address) || '' })), [data])
  const inSection = all.filter((r) => sectionOf(r.subtype) === cur.sub)
  const subRows = inSection.filter((r) => cur.sub !== 'training' || cat === 'all' || r.subtype === cat)
  // Map: one marker per Malaysian state, and one per country for providers abroad.
  const byPlace = useMemo(() => { const m = {}; subRows.forEach((r) => { const k = r.country && r.country !== 'Malaysia' ? r.country : r._state; if (k) m[k] = (m[k] || 0) + 1 }); return m }, [subRows])
  // Same markers object until the counts change, so the map keeps the reader's zoom.
  const markers = useMemo(() => Object.entries(byPlace).map(([k, n]) => { const ll = stateCoords(k) || countryCoords(k); return ll && { id: k, lat: ll[0], lng: ll[1], count: n, label: `${k}: ${n}` } }).filter(Boolean), [JSON.stringify(byPlace)]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = subRows.filter((r) => (place === 'all' || r._state === place || r.country === place) && (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const pickPlace = (k) => { setPlace(place === k ? 'all' : k); document.getElementById('directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const chip = (r) => <span className="chip bg-brand-100 text-brand-700 whitespace-normal">{typeName(r.subtype, lang, data.settings)}</span>
  const details = (r) => (
    <ul className="mt-2 text-sm space-y-1 break-words">
      {r.coverage && <li><b>{t(lang, 'coverage')}:</b> {r.coverage}</li>}
      {r.address && <li className="flex gap-2"><MapPin {...ICON} size={15} className="shrink-0 mt-0.5 text-ink-400" /><span className="whitespace-pre-line">{r.address}</span></li>}
      {r.pic && <li><b>{t(lang, 'pic')}:</b> {r.pic}</li>}
      {r.phone && <li className="flex gap-2"><Phone {...ICON} size={15} className="shrink-0 mt-0.5 text-ink-400" /><span>{splitList(r.phone).join(' · ')}</span></li>}
      {r.email && <li className="flex gap-2"><Mail {...ICON} size={15} className="shrink-0 mt-0.5 text-ink-400" /><span>{splitList(r.email).map((e, i) => <a key={e} className="text-brand-700 hover:underline" href={`mailto:${e}`}>{i ? ' · ' : ''}{e}</a>)}</span></li>}
      {(r.website || r.website2) && <li className="flex gap-2"><ExternalLink {...ICON} size={15} className="shrink-0 mt-0.5 text-ink-400" /><span>
        {[...splitList(r.website), ...splitList(r.website2)].map((w, i) => siteHref(w) ? <a key={w} className="text-brand-700 hover:underline" href={siteHref(w)} target="_blank" rel="noreferrer">{i ? ' · ' : ''}{w.replace(/^https?:\/\//, '')}</a> : <span key={w}>{i ? ' · ' : ''}{w}</span>)}</span></li>}
      {r.accreditation && <li><b>{t(lang, 'accreditation')}:</b> {r.accreditation}</li>}
      {r.description && <li className="text-ink-600 whitespace-pre-line">{r.description}</li>}
      {r.trainers && <li><details><summary className="cursor-pointer text-brand-700">{t(lang, 'trainers')} ({splitList(r.trainers).length})</summary><ol className="list-decimal pl-5 text-ink-600 mt-1">{splitList(r.trainers).map((x) => <li key={x}>{x}</li>)}</ol></details></li>}
    </ul>
  )
  const logo = (r, cls) => safeUrl(r.logo_url)
    ? <button type="button" title={t(lang, 'view_larger')} onClick={() => setZoom({ src: safeUrl(r.logo_url), alt: r.name })} className={`${cls} shrink-0 bg-white rounded-lg border border-line p-0.5 hover:ring-2 hover:ring-brand-300 cursor-zoom-in`}><img src={safeUrl(r.logo_url)} alt={`${r.name} logo`} loading="lazy" className="w-full h-full object-contain" /></button>
    : <div className={`${cls} rounded-lg border border-line bg-paper flex items-center justify-center text-ink-400 text-lg font-bold`}>{String(r.name || '?').slice(0, 1)}</div>
  const soon = cur.soon
  const filters = (
    <>
      <select className="input w-auto" value={place} onChange={(e) => setPlace(e.target.value)} aria-label={t(lang, 'state')}>
        <option value="all">{t(lang, 'all')}</option>
        {Object.keys(byPlace).sort().map((k) => <option key={k} value={k}>{k} ({byPlace[k]})</option>)}
      </select>
      <input className="input w-auto min-w-40" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'search_ph_short')} aria-label={t(lang, 'search_ph_short')} />
    </>
  )
  return (
    <div>
      <section className="card p-5 mb-4">
        <h2 className="text-xl font-bold">{t(lang, 'directory')}</h2>
        <p className="text-sm text-ink-600 mt-1">{t(lang, 'directory_intro')}</p>
        <div className="mt-3 flex flex-wrap gap-2" role="tablist">
          {DIRECTORY_SECTIONS.map((d) => <button key={d.sub} role="tab" aria-selected={cur.sub === d.sub} className={`px-3 py-1.5 rounded-lg border text-sm inline-flex items-center gap-1.5 ${cur.sub === d.sub ? 'bg-ink-900 text-white border-ink-900' : 'border-line text-ink-600 hover:bg-paper'}`} onClick={() => { setPlace('all'); setCat('all'); setTab(`directory/${d.sub}`) }}>{d[lang] || d.en} <span className={cur.sub === d.sub ? 'text-white/70' : 'text-ink-400'}>({all.filter((r) => sectionOf(r.subtype) === d.sub).length})</span>{d.soon && <span className="rounded bg-gold-500 px-1.5 text-[10px] font-semibold uppercase text-white">{t(lang, 'soon')}</span>}</button>)}
        </div>
        {cur.sub === 'training' && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className={`chip border ${cat === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-paper border-line'}`} onClick={() => { setCat('all'); setPlace('all') }}>{t(lang, 'all')} <b className="ml-1">{inSection.length}</b></button>
            {cats.map((c) => <button key={c.id} className={`chip border ${cat === c.id ? 'bg-brand-600 text-white border-brand-600' : 'bg-paper border-line'}`} onClick={() => { setCat(c.id); setPlace('all') }}>{c[lang] || c.en} <b className="ml-1">{inSection.filter((r) => r.subtype === c.id).length}</b></button>)}
          </div>
        )}
        {cur.sub === 'training' && (cat === 'all' || cat === 'jakim_plh') && <p className="text-xs text-ink-400 mt-2">{t(lang, 'dir_plh_source')}</p>}
      </section>

      {soon && <div className="card p-8 mb-4 text-center bg-gradient-to-br from-brand-600 to-brand-900 text-white"><div className="inline-block rounded-full bg-gold-500 px-3 py-1 text-xs font-bold uppercase tracking-wide mb-3">{t(lang, 'soon')}</div><div className="text-xl font-bold">{t(lang, 'lab_soon_title')}</div><p className="text-sm text-white/85 mt-2 max-w-xl mx-auto">{t(lang, 'lab_soon_body')}</p></div>}

      {(!soon || subRows.length > 0) && <section className="card p-5 mb-4">
        <h3 className="font-semibold mb-1">{t(lang, 'dir_map')}</h3>
        <p className="text-xs text-ink-400 mb-3">{t(lang, 'dir_map_hint')}</p>
        <Suspense fallback={<div className="h-72 sm:h-96 card animate-pulse bg-paper" />}>
          <MapView markers={markers} center={[108, 4]} zoom={4.5} onPick={(m) => pickPlace(m.id)} maxZoom={7} />
        </Suspense>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(byPlace).sort((a, b) => b[1] - a[1]).map(([k, n]) => <button key={k} className={`chip border ${place === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-paper border-line'}`} onClick={() => pickPlace(k)}>{k} <b className="ml-1">{n}</b></button>)}
        </div>
      </section>}

      <Segment id="directory" lang={lang} title={place === 'all' ? (cur[lang] || cur.en) : `${cur[lang] || cur.en} · ${place}`} rows={rows} filters={filters} empty={soon ? t(lang, 'lab_soon_body') : undefined}
        cardGrid="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
        columns={[
          { key: 'logo', label: '', render: (r) => logo(r, 'w-24 h-16') },
          { key: 'name', label: t(lang, 'name'), render: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'subtype', label: t(lang, 'category'), render: chip },
          { key: '_state', label: t(lang, 'state'), render: (r) => r.country && r.country !== 'Malaysia' ? r.country : r._state },
          { key: 'contact', label: t(lang, 'contact'), render: details },
        ]}
        renderCard={(r) => (
          <article key={r.id} className="card p-4 flex flex-col">
            <div className="flex items-start gap-3">
              {logo(r, 'w-28 h-20 shrink-0')}
              <div className="min-w-0">
                <div className="text-xs text-ink-400">{r.country && r.country !== 'Malaysia' ? r.country : r._state || '—'}</div>
                <div className="font-semibold leading-snug break-words">{r.name}</div>
                <div className="mt-1">{chip(r)}</div>
              </div>
            </div>
            {details(r)}
            <div className="mt-3 pt-2 border-t border-line text-xs text-ink-400">{r.source_ref}{r.updated_at ? ` · ${t(lang, 'updated')} ${fmtDate(r.updated_at, lang)}` : ''}</div>
          </article>
        )} />
      <Lightbox src={zoom && zoom.src} alt={zoom && zoom.alt} onClose={() => setZoom(null)} />
    </div>
  )
}
