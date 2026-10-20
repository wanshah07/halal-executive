import { useEffect, useState } from 'react'
import { safeUrl } from '../lib/safe'
import Segment from '../components/Segment'
import CategoryFilter, { catChip } from '../components/CategoryFilter'
import Poster from '../components/Poster'
import Cover from '../components/Cover'
import { t } from '../lib/i18n'
import { fmtDate } from '../lib/util'
import { ICON, ArrowUpRight, Briefcase, Mail, Phone, MapPin, ChevronDown, ChevronRight } from '../components/Icon'

// Halal job vacancies (Wan, 20 Oct 2026): read from the WhatsApp and Telegram
// groups or added in Admin. The Hub is not the employer, and the notice above
// the list says so on every visit. A vacancy leaves the page a day after its
// closing date (Code.gs purgeClosedVacancies deletes it for good).
const closed = (v) => { const d = Date.parse(v.closing_date); return !isNaN(d) && d + 864e5 < Date.now() }
// A phone printed in the ad becomes a tap-to-call link; WhatsApp numbers too.
const tel = (p) => String(p || '').replace(/[^\d+]/g, '')

export default function Vacancies({ lang, data, sub }) {
  const [cat, setCat] = useState(sub || 'all')
  useEffect(() => { setCat(sub || 'all') }, [sub])
  const [open, setOpen] = useState({})
  const all = (data.vacancies || []).filter((v) => v.status !== 'hidden' && v.status !== 'draft' && !closed(v))
  const rows = all.filter((v) => cat === 'all' || (v.category || 'halal') === cat)
    // closing soonest first; no closing date last, newest of those first
    .sort((a, b) => (Date.parse(a.closing_date) || 9e15) - (Date.parse(b.closing_date) || 9e15) || Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
  const title = (v) => (lang === 'bm' ? v.title_bm || v.title : v.title)
  const where = (v) => [v.location, v.state].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ')
  const apply = (v, big) => (
    <div className={`flex flex-wrap gap-2 ${big ? 'mt-3' : ''}`}>
      {safeUrl(v.apply_link) && <a className="btn-brand" href={safeUrl(v.apply_link)} target="_blank" rel="noreferrer">{t(lang, 'vac_apply_btn')} <ArrowUpRight {...ICON} size={15} /></a>}
      {v.apply_email && <a className="btn" href={`mailto:${v.apply_email}`}><Mail {...ICON} size={15} /> <span className="[overflow-wrap:anywhere]">{v.apply_email}</span></a>}
      {tel(v.apply_phone) && <a className="btn" href={`tel:${tel(v.apply_phone)}`}><Phone {...ICON} size={15} /> {v.apply_phone}</a>}
    </div>
  )
  const details = (v) => (
    <dl className="mt-2 text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
      {v.employer && <><dt className="text-ink-400">{t(lang, 'vac_employer')}</dt><dd className="font-medium">{v.employer}</dd></>}
      {where(v) && <><dt className="text-ink-400">{t(lang, 'vac_location')}</dt><dd>{where(v)}</dd></>}
      {v.job_type && <><dt className="text-ink-400">{t(lang, 'vac_type')}</dt><dd>{v.job_type}</dd></>}
      {v.salary && <><dt className="text-ink-400">{t(lang, 'vac_salary')}</dt><dd>{v.salary}</dd></>}
      <dt className="text-ink-400">{t(lang, 'vac_closing')}</dt><dd>{v.closing_date ? fmtDate(v.closing_date, lang) : t(lang, 'vac_no_close')}</dd>
    </dl>
  )
  return (
    <div>
      <div className="card p-4 mb-4 text-sm bg-amber-50 border-amber-200 text-amber-950" role="note">
        <b>{t(lang, 'vac_disclaimer_title')}.</b> {t(lang, 'vac_disclaimer')}
      </div>
      <Segment id="vacancies" cardGrid="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" lang={lang} title={t(lang, 'vacancies')} rows={rows}
        filters={<CategoryFilter lang={lang} value={cat} onChange={setCat} />}
        columns={[
          { key: 'category', label: t(lang, 'category'), render: (v) => catChip(v.category, lang) },
          { key: 'title', label: t(lang, 'title'), render: (v) => <span className="font-medium">{title(v)}</span> },
          { key: 'employer', label: t(lang, 'vac_employer') },
          { key: 'where', label: t(lang, 'vac_location'), render: where },
          { key: 'job_type', label: t(lang, 'vac_type') },
          { key: 'salary', label: t(lang, 'vac_salary') },
          { key: 'closing_date', label: t(lang, 'vac_closing'), render: (v) => (v.closing_date ? fmtDate(v.closing_date, lang) : '—') },
          { key: 'apply', label: t(lang, 'vac_apply'), render: (v) => apply(v) },
        ]}
        renderCard={(v) => (
          <article key={v.id} className="card overflow-hidden min-w-0 flex flex-col">
            {v.poster_url ? <Poster url={v.poster_url} file={v.poster_file} title={title(v)} /> : <Cover icon={Briefcase} category={v.category} label={v.employer || t(lang, 'vacancies')} sub={where(v)} lang={lang} />}
            <div className="p-4 flex-1 flex flex-col">
              <div className="flex items-center justify-between gap-2 text-xs text-ink-400">{catChip(v.category, lang)}{v.job_type && <span className="truncate">{v.job_type}</span>}</div>
              <div className="font-semibold mt-1 leading-snug [overflow-wrap:anywhere]">{title(v)}</div>
              {where(v) && <div className="text-xs text-ink-600 mt-0.5 flex items-center gap-1"><MapPin {...ICON} size={13} /><span className="truncate">{where(v)}</span></div>}
              {details(v)}
              <button className="mt-2 text-sm text-brand-600 hover:underline self-start" onClick={() => setOpen((o) => ({ ...o, [v.id]: !o[v.id] }))} aria-expanded={!!open[v.id]}>
                <span className="inline-flex items-center gap-1">{open[v.id] ? <ChevronDown {...ICON} size={16} /> : <ChevronRight {...ICON} size={16} />}{t(lang, open[v.id] ? 'vac_hide' : 'vac_show')}</span>
              </button>
              {open[v.id] && (
                <div className="mt-2 text-sm space-y-2 [overflow-wrap:anywhere]">
                  {v.description && <p className="text-ink-900 whitespace-pre-wrap">{v.description}</p>}
                  {v.requirements && <div><div className="font-medium">{t(lang, 'vac_requirements')}</div><p className="text-ink-600 whitespace-pre-wrap">{v.requirements}</p></div>}
                </div>
              )}
              <div className="mt-auto">{apply(v, true)}</div>
            </div>
          </article>
        )} />
    </div>
  )
}
