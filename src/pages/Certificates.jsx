import { safeUrl } from '../lib/safe'
import { useEffect, useMemo, useState } from 'react'
import { certThumb } from '../lib/api'
import Segment from '../components/Segment'
import CategoryFilter, { catChip } from '../components/CategoryFilter'
import { t } from '../lib/i18n'
import { fmtDate, fmtDateTime } from '../lib/util'
import { certStatus, splitProducts } from '../lib/certs'
import { ICON, ChevronDown, ChevronRight, ExternalLink } from '../components/Icon'

// Halal certificates picked out of the groups: holder, certificate number,
// scheme, validity and the product list. Each entry folds; the product list
// unfolds on demand. Status is computed from valid_to on the day of viewing:
// valid / expiring (≤ 90 days) / expired.
export { certStatus, splitProducts }
// Thumbnail of the certificate itself. Drive renders the preview, Apps Script
// reads it with the owner's rights, so the file never has to be made public.
// A sample row or a file Drive has not previewed yet shows a labelled tile.
export function CertThumb({ c, lang, size = 'card' }) {
  const [src, setSrc] = useState(c.thumb || null)
  useEffect(() => { let live = true; if (!c.thumb) certThumb(c.id).then((d) => live && d && setSrc(d)); return () => { live = false } }, [c.id, c.thumb])
  const box = size === 'card' ? 'w-full aspect-[4/3]' : 'w-12 h-16'
  const inner = src
    ? <img src={src} alt={`${t(lang, 'certificates')} ${c.company}`} loading="lazy" className={`${box} object-cover object-top rounded-lg border border-line bg-white`} />
    : <div className={`${box} rounded-lg border border-line bg-paper flex flex-col items-center justify-center gap-1 text-ink-400`}>
        <img src="./brand/jakim-halal-logo.png" alt="" className={size === 'card' ? 'h-12 w-12 opacity-30' : 'h-6 w-6 opacity-30'} />
        {size === 'card' && <span className="text-xs">{t(lang, 'no_preview')}</span>}
      </div>
  return safeUrl(c.drive_url) ? <a href={safeUrl(c.drive_url)} target="_blank" rel="noreferrer" className="block" title="Drive ↗">{inner}</a> : inner
}

const tone = { valid: 'bg-brand-100 text-brand-700', expiring: 'bg-amber-100 text-amber-800', expired: 'bg-red-100 text-red-700' }

export default function Certificates({ lang, data }) {
  const [cat, setCat] = useState('all')
  const [st, setSt] = useState('all')
  const [open, setOpen] = useState({})
  const [allOpen, setAllOpen] = useState(false)
  const rows = useMemo(() => (data.certificates || []).map((c) => ({ ...c, _status: certStatus(c), _products: splitProducts(c.products) }))
    .filter((c) => (cat === 'all' || c.category === cat) && (st === 'all' || c._status === st))
    .sort((a, b) => Date.parse(a.valid_to || 0) - Date.parse(b.valid_to || 0)), [data, cat, st])
  const isOpen = (id) => (open[id] === undefined ? allOpen : open[id])
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !isOpen(id) }))
  const badge = (c) => <span className={`chip ${tone[c._status]}`}>{t(lang, c._status)}</span>
  const filters = (
    <>
      <CategoryFilter lang={lang} value={cat} onChange={setCat} />
      <div className="inline-flex rounded-lg border border-line overflow-hidden text-sm">
        {['all', 'valid', 'expiring', 'expired'].map((s) => <button key={s} onClick={() => setSt(s)} className={`px-3 py-1.5 ${st === s ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-paper'}`}>{t(lang, s)}</button>)}
      </div>
      <button className="btn" onClick={() => { setAllOpen(!allOpen); setOpen({}) }}>{t(lang, allOpen ? 'fold' : 'unfold')}</button>
    </>
  )
  const products = (c) => (
    <ul className="mt-2 text-sm list-disc pl-5 space-y-0.5">{c._products.map((p, i) => <li key={i}>{p}</li>)}{!c._products.length && <li className="list-none text-ink-400">—</li>}</ul>
  )
  return (
    <Segment id="certificates" lang={lang} title={t(lang, 'certificates')} rows={rows} filters={filters}
      columns={[
        { key: '_thumb', label: '', render: (c) => <CertThumb c={c} lang={lang} size="row" /> },
        { key: '_status', label: t(lang, 'validity'), render: badge },
        { key: 'company', label: t(lang, 'company'), render: (c) => <span className="font-medium">{c.company}</span> },
        { key: 'cert_no', label: t(lang, 'cert_no') },
        { key: 'scheme', label: t(lang, 'scheme') },
        { key: 'category', label: t(lang, 'category'), render: (c) => catChip(c.category, lang) },
        { key: 'state', label: t(lang, 'state') },
        { key: 'valid_from', label: t(lang, 'valid_from'), render: (c) => fmtDate(c.valid_from, lang) },
        { key: 'valid_to', label: t(lang, 'valid_to'), render: (c) => fmtDate(c.valid_to, lang) },
        { key: 'products', label: t(lang, 'products'), render: (c) => (
          <details open={isOpen(c.id)} onToggle={(e) => setOpen((o) => ({ ...o, [c.id]: e.currentTarget.open }))}>
            <summary className="cursor-pointer text-brand-600 text-sm">{c._products.length} {t(lang, 'show_products')}</summary>{products(c)}
          </details>) },
        { key: 'updated_at', label: t(lang, 'updated'), render: (c) => fmtDate(c.updated_at, lang) },
      ]}
      renderCard={(c) => (
        <article key={c.id} className="card p-4">
          <div className="mb-3"><CertThumb c={c} lang={lang} /></div>
          <div className="flex items-center justify-between gap-2 mb-2">{badge(c)}{catChip(c.category, lang)}</div>
          <button className="text-left w-full" onClick={() => toggle(c.id)}>
            <div className="font-semibold leading-snug">{c.company}</div>
            <div className="text-xs text-ink-600 mt-0.5">{c.scheme}{c.state && ` · ${c.state}`} · {c.cert_no}</div>
            <div className="text-xs text-ink-400 mt-1">{t(lang, 'validity')}: {fmtDate(c.valid_from, lang)} → {fmtDate(c.valid_to, lang)}</div>
          </button>
          <button className="mt-2 text-sm text-brand-600 hover:underline" onClick={() => toggle(c.id)}>{isOpen(c.id) ? <span className="inline-flex items-center gap-1"><ChevronDown {...ICON} size={16} />{t(lang, 'hide_products')}</span> : <span className="inline-flex items-center gap-1"><ChevronRight {...ICON} size={16} />{c._products.length} {t(lang, 'show_products')}</span>}</button>
          {isOpen(c.id) && products(c)}
          <div className="mt-3 text-xs text-ink-400 flex justify-between">
            <span>{safeUrl(c.drive_url) ? <a className="hover:underline" href={safeUrl(c.drive_url)} target="_blank" rel="noreferrer">Drive <ExternalLink {...ICON} size={12} className="inline -mt-0.5" /></a> : c.doc_id || ''}</span>
            <span>{t(lang, 'updated')} {fmtDateTime(c.updated_at, lang)}</span>
          </div>
        </article>
      )} />
  )
}
