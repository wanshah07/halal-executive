import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Segment from '../components/Segment'
import DocEmbed from '../components/DocEmbed'
import { t } from '../lib/i18n'
import { safeUrl } from '../lib/safe'
import { fmtDate } from '../lib/util'
import { countryCoords } from '../lib/config'
import seed from '../data/fhcb.json'
import { fhcbRows } from '../lib/fhcb'
import lists from '../data/fhcb_countries.json'
import { FileText, Sparkles } from '../components/Icon'
import { ICON, Mail, Phone, MapPin, ExternalLink } from '../components/Icon'
import Lightbox from '../components/Lightbox'

const MapView = lazy(() => import('../components/MapView'))

// Foreign halal certification bodies and authorities recognised by JAKIM.
// Rows live in the Sheet's FHCB tab (added, edited and removed in Admin as
// each gazetted update lands); until the tab is seeded the bundled list of
// 21 August 2026 shows. Every entry cites the document and page it came from.
export { fhcbRows }
export const splitList = (s) => String(s || '').split(/;\s*/).map((x) => x.trim()).filter(Boolean)
const siteHref = (w) => { const s = String(w || '').trim(); return safeUrl(/^https?:\/\//i.test(s) ? s : 'https://' + s) }

// The country buttons, organised: All and the countries with the most bodies in
// one row that scrolls sideways, the chosen country always in it, and "All
// countries" opens the whole list A to Z in a box of its own, so 49 buttons
// never become a wall (Wan, 19 Oct 2026).
const TOP = 10
function CountryChips({ lang, all, countries, byCountry, value, onAll, onPick }) {
  const [open, setOpen] = useState(false)
  const chip = (on) => `chip border shrink-0 py-1 ${on ? 'bg-brand-600 text-white border-brand-600' : 'bg-paper border-line'}`
  const top = useMemo(() => {
    const t = [...countries].sort((a, b) => byCountry[b] - byCountry[a] || a.localeCompare(b)).slice(0, TOP)
    if (value !== 'all' && countries.includes(value) && !t.includes(value)) t.unshift(value)
    return t
  }, [countries.join('|'), JSON.stringify(byCountry), value]) // eslint-disable-line react-hooks/exhaustive-deps
  const item = (c) => <button key={c} className={chip(value === c)} onClick={() => onPick(c)}>{c} <b className="ml-1">{byCountry[c]}</b></button>
  return (
    <div className="mt-3">
      <div className="flex gap-1.5 overflow-x-auto snap-x pb-1 -mx-1 px-1">
        <button className={chip(value === 'all')} onClick={onAll}>{t(lang, 'all')} <b className="ml-1">{all}</b></button>
        {!open && top.map(item)}
      </div>
      <button className="btn mt-2 w-full sm:w-auto justify-center px-3 py-1 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? t(lang, 'fhcb_less') : `${t(lang, 'fhcb_all_countries')} (${countries.length})`}
      </button>
      {open && <div className="mt-2 flex flex-wrap gap-1.5 max-h-56 overflow-y-auto rounded-lg border border-line bg-white p-2">{countries.map(item)}</div>}
    </div>
  )
}

export default function Fhcb({ lang, data, focusId, focusKey }) {
  const [country, setCountry] = useState('all')
  const [q, setQ] = useState('')
  const [zoom, setZoom] = useState(null)
  const all = useMemo(() => fhcbRows(data), [data])
  const docs = (data.documents || []).filter((d) => d.category === 'fhcb')
  // Only the current list; a list a newer upload superseded is archived.
  const list = docs.filter((d) => d.kind === 'fhcb_list' && d.status !== 'archived'), circulars = docs.filter((d) => d.kind !== 'fhcb_list' && d.status !== 'archived')
  const effective = (all.find((r) => r.effective_date) || {}).effective_date
  const byCountry = useMemo(() => { const m = {}; all.forEach((r) => { m[r.country] = (m[r.country] || 0) + 1 }); return m }, [all])
  const countries = Object.keys(byCountry).sort()
  // Same markers object until the counts change, so the map keeps the reader's zoom.
  const markers = useMemo(() => countries.map((c) => { const ll = countryCoords(c); return ll && { id: c, lat: ll[0], lng: ll[1], count: byCountry[c], label: `${c}: ${byCountry[c]}` } }).filter(Boolean), [countries.join('|'), JSON.stringify(byCountry)]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = all.filter((r) => (country === 'all' || r.country === country) && (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.country.localeCompare(b.country) || (a.no || 0) - (b.no || 0))
  useEffect(() => { if (focusId) { const r = all.find((x) => String(x.id) === String(focusId)); if (r) { setCountry(r.country); setQ('') } } }, [focusId, focusKey, all])
  const pickCountry = (c) => { setCountry(c); document.getElementById('fhcb')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const kindChip = (r) => <span className={`chip ${r.kind === 'authority' ? 'bg-brand-100 text-brand-700' : 'bg-paper border border-line text-ink-600'}`}>{t(lang, r.kind === 'authority' ? 'fhcb_authority' : 'fhcb_body')}</span>
  const contacts = (r) => (
    <ul className="mt-2 text-sm space-y-1 break-words">
      {r.address && <li className="flex gap-2"><MapPin {...ICON} size={15} className="shrink-0 mt-0.5 text-ink-400" /><span className="whitespace-pre-line">{r.address}</span></li>}
      {r.persons && <li className="text-ink-600">{splitList(r.persons).join(' · ')}</li>}
      {r.tel && <li className="flex gap-2"><Phone {...ICON} size={15} className="shrink-0 mt-0.5 text-ink-400" /><span>{splitList(r.tel).join(' · ')}{r.fax ? ` · Fax ${splitList(r.fax).join(', ')}` : ''}</span></li>}
      {r.email && <li className="flex gap-2"><Mail {...ICON} size={15} className="shrink-0 mt-0.5 text-ink-400" /><span>{splitList(r.email).map((e, i) => <a key={e} className="text-brand-700 hover:underline" href={`mailto:${e}`}>{i ? ' · ' : ''}{e}</a>)}</span></li>}
      {r.website && <li className="flex gap-2"><ExternalLink {...ICON} size={15} className="shrink-0 mt-0.5 text-ink-400" /><span>{splitList(r.website).map((w, i) => siteHref(w) ? <a key={w} className="text-brand-700 hover:underline" href={siteHref(w)} target="_blank" rel="noreferrer">{i ? ' · ' : ''}{w}</a> : <span key={w}>{i ? ' · ' : ''}{w}</span>)}</span></li>}
      {r.note && <li className="text-xs text-ink-600">{r.note}</li>}
    </ul>
  )
  // A logo opens full size on click (Wan, 15 Oct 2026).
  const logo = (r, cls) => safeUrl(r.logo_url)
    ? <button type="button" title={t(lang, 'view_larger')} onClick={() => setZoom({ src: safeUrl(r.logo_url), alt: r.name })} className={`${cls} shrink-0 bg-white rounded-lg border border-line p-0.5 hover:ring-2 hover:ring-brand-300 cursor-zoom-in`}><img src={safeUrl(r.logo_url)} alt={`${r.name} halal logo`} loading="lazy" className="w-full h-full object-contain" /></button>
    : <div className={`${cls} rounded-lg border border-line bg-paper`} />
  const filters = (
    <>
      <select className="input w-auto" value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t(lang, 'country')}>
        <option value="all">{t(lang, 'all')} ({all.length})</option>
        {countries.map((c) => <option key={c} value={c}>{c} ({byCountry[c]})</option>)}
      </select>
      <input className="input w-auto min-w-40" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'search_ph_short')} aria-label={t(lang, 'search_ph_short')} />
    </>
  )
  return (
    <div>
      <section className="card p-5 mb-4">
        <h2 className="text-xl font-bold">{t(lang, 'fhcb_full')}</h2>
        <p className="text-sm text-ink-600 mt-1">{t(lang, 'fhcb_intro')}</p>
        <p className="text-sm mt-2"><b>{t(lang, 'source')}:</b> {t(lang, 'fhcb_source')}{effective ? ` · ${t(lang, 'effective')} ${fmtDate(effective, lang)}` : ''} · {all.length} {t(lang, 'fhcb_entries')} · {countries.length} {t(lang, 'countries')}</p>
        {(list.length > 0 || circulars.length > 0) && (
          <div className="mt-3 space-y-2">
            {list.map((d) => <DocEmbed key={d.id} lang={lang} doc={d} />)}
            {circulars.length > 0 && <div className="text-xs font-semibold text-ink-600 uppercase tracking-wide pt-1">{t(lang, 'fhcb_circulars')}</div>}
            {circulars.map((d) => <DocEmbed key={d.id} lang={lang} doc={d} />)}
          </div>
        )}
        {!list.length && <p className="text-xs text-ink-400 mt-2">{t(lang, 'fhcb_no_doc')}</p>}
      </section>

      {/* New on MyIHAB (Wan, 23 Oct 2026): the countries JAKIM marks NEW, each with
          its own list PDF, and every country's PDF in a folded list below. */}
      <NewFhcb lang={lang} all={all} onPick={pickCountry} />

      <section className="card p-5 mb-4">
        <h3 className="font-semibold mb-1">{t(lang, 'fhcb_map')}</h3>
        <p className="text-xs text-ink-400 mb-3">{t(lang, 'fhcb_map_hint')}</p>
        <Suspense fallback={<div className="h-72 sm:h-96 card animate-pulse bg-paper" />}>
          <MapView markers={markers} onPick={(m) => pickCountry(m.id)} maxZoom={5} />
        </Suspense>
        <CountryChips lang={lang} all={all.length} countries={countries} byCountry={byCountry} value={country} onAll={() => setCountry('all')} onPick={pickCountry} />
      </section>

      <Segment id="fhcb" focusId={focusId} focusKey={focusKey} lang={lang} title={country === 'all' ? t(lang, 'fhcb') : country} rows={rows} filters={filters}
        cardGrid="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
        columns={[
          { key: 'logo', label: '', render: (r) => logo(r, 'w-24 h-16') },
          { key: 'no', label: '#' },
          { key: 'country', label: t(lang, 'country'), render: (r) => <span>{r.country}{isNewRow(r) && <span className="chip bg-gold-500 text-white ml-1 text-[10px]">NEW</span>}</span> },
          { key: 'name', label: t(lang, 'name'), render: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'kind', label: t(lang, 'fhcb_kind'), render: kindChip },
          { key: 'contact', label: t(lang, 'contact'), render: contacts },
          { key: 'source_ref', label: t(lang, 'source'), render: (r) => <span className="text-xs text-ink-400">{r.source_ref}</span> },
        ]}
        renderCard={(r) => (
          <article key={r.id} id={`fhcb-${r.id}`} className="card p-4 flex flex-col">
            <div className="flex items-start gap-3">
              {logo(r, 'w-28 h-20 shrink-0')}
              <div className="min-w-0">
                <div className="text-xs text-ink-400">#{r.no} · {r.country}{isNewRow(r) && <span className="chip bg-gold-500 text-white ml-1 text-[10px]">NEW</span>}{pdfOf(r.country) && <> · <a className="text-brand-700 hover:underline" href={pdfOf(r.country)} target="_blank" rel="noreferrer">PDF</a></>}</div>
                <div className="font-semibold leading-snug break-words">{r.name}</div>
                <div className="mt-1">{kindChip(r)}</div>
              </div>
            </div>
            {contacts(r)}
            <div className="mt-3 pt-2 border-t border-line text-xs text-ink-400">{r.source_ref}{r.updated_at ? ` · ${t(lang, 'updated')} ${fmtDate(r.updated_at, lang)}` : ''}</div>
          </article>
        )} />
      <Lightbox src={zoom && zoom.src} alt={zoom && zoom.alt} onClose={() => setZoom(null)} />
    </div>
  )
}

// Per-country list PDFs scraped from MyIHAB (src/data/fhcb_countries.json).
const pdfOf = (country) => { const c = lists.countries.find((x) => x.country === country); return c ? c.file : '' }
const isNewRow = (r) => /newly approved/i.test(String(r.note || ''))
function NewFhcb({ lang, all, onPick }) {
  const fresh = lists.countries.filter((c) => c.new)
  // Until Admin presses Load, the live Sheet has no new rows yet: show them from the seed.
  const bodies = (all.some(isNewRow) ? all : seed).filter(isNewRow)
  return (
    <section className="card p-5 mb-4 border-gold-500/60 bg-gradient-to-br from-amber-50 to-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold flex items-center gap-2"><Sparkles {...ICON} size={17} className="text-gold-500" />{t(lang, 'fhcb_new_title')} <span className="chip bg-gold-500 text-white">{bodies.length}</span></h3>
        <span className="text-xs text-ink-400">{t(lang, 'fhcb_new_src')} · {fmtDate(lists.fetched, lang)}</span>
      </div>
      <p className="text-sm text-ink-600 mt-1">{t(lang, 'fhcb_new_sub')}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {fresh.map((c) => {
          const rows = bodies.filter((r) => r.country === c.country)
          return (
            <div key={c.country} className="rounded-xl border border-line bg-white p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2"><button type="button" className="font-semibold hover:underline text-left" onClick={() => onPick(c.country)}>{c.country}</button><span className="chip bg-gold-500 text-white text-[10px]">NEW</span></div>
              <ul className="text-sm text-ink-900 list-disc pl-5">{rows.map((r) => <li key={r.id}>{r.name}</li>)}</ul>
              <a className="btn self-start mt-1 px-2.5 py-1 text-xs" href={c.file} target="_blank" rel="noreferrer"><FileText {...ICON} size={14} /> {t(lang, 'fhcb_view_pdf')}</a>
            </div>
          )
        })}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-brand-700">{t(lang, 'fhcb_all_pdf')} ({lists.countries.length})</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">{lists.countries.map((c) => <a key={c.country} className={`chip border ${c.new ? 'border-gold-500 bg-amber-50' : 'border-line bg-paper'} hover:bg-brand-50`} href={c.file} target="_blank" rel="noreferrer">{c.country} <FileText {...ICON} size={12} className="ml-1" /></a>)}</div>
      </details>
    </section>
  )
}
