import { safeUrl } from '../lib/safe'
import { useState } from 'react'
import Segment from '../components/Segment'
import CategoryFilter, { catChip } from '../components/CategoryFilter'
import { t } from '../lib/i18n'
import { fmtDate } from '../lib/util'

// Rows come from the Guidelines tab of the same Sheet (pipeline/sheets.py
// writes it; Wan can also type rows by hand; status != published hides a row).
export default function Guidelines({ lang, data }) {
  const [cat, setCat] = useState('all')
  const rows = (data.guidelines || []).filter((g) => g.status !== 'hidden' && (cat === 'all' || g.category === cat))
  const title = (g) => (lang === 'bm' ? g.title_bm || g.title : g.title)
  const sum = (g) => (lang === 'bm' ? g.summary_bm || g.summary_en : g.summary_en)
  return (
    <Segment id="guidelines" lang={lang} title={t(lang, 'guidelines')} rows={rows} defaultView="table" filters={<CategoryFilter lang={lang} value={cat} onChange={setCat} />}
      columns={[
        { key: 'category', label: t(lang, 'category'), render: (g) => catChip(g.category, lang) },
        { key: 'title', label: t(lang, 'title'), render: (g) => (safeUrl(g.link) ? <a className="font-medium hover:underline" href={safeUrl(g.link)} target="_blank" rel="noreferrer">{title(g)}</a> : <span className="font-medium">{title(g)}</span>) },
        { key: 'issuer', label: t(lang, 'issuer') },
        { key: 'summary', label: 'Summary', render: sum },
        { key: 'effective_date', label: t(lang, 'effective'), render: (g) => fmtDate(g.effective_date, lang) },
        { key: 'updated_at', label: t(lang, 'updated'), render: (g) => fmtDate(g.updated_at, lang) },
      ]}
      renderCard={(g) => (
        <article key={g.id} className="card p-4 min-w-0">
          <div className="flex items-center justify-between mb-2">{catChip(g.category, lang)}<span className="chip bg-paper border border-line min-w-0 max-w-[65%] truncate">{g.issuer}</span></div>
          {safeUrl(g.link) ? <a href={safeUrl(g.link)} target="_blank" rel="noreferrer" className="font-semibold hover:underline block [overflow-wrap:anywhere]">{title(g)}</a> : <div className="font-semibold [overflow-wrap:anywhere]">{title(g)}</div>}
          <p className="text-sm text-ink-600 mt-2 [overflow-wrap:anywhere]">{sum(g)}</p>
          <div className="mt-3 text-xs text-ink-400">{g.effective_date ? `${t(lang, 'effective')} ${fmtDate(g.effective_date, lang)} · ` : ''}{t(lang, 'updated')} {fmtDate(g.updated_at, lang)}</div>
        </article>
      )} />
  )
}
