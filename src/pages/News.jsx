import Segment from '../components/Segment'
import { catChip } from '../components/CategoryFilter'
import { t } from '../lib/i18n'
import { NEWS_TTL_HOURS } from '../lib/config'
import { fmtDateTime, hoursLeft } from '../lib/util'

// News rows carry expires_at = fetched_at + 72 h. The sweep deletes expired
// rows from the Sheet; the page also hides anything past expiry so a stale
// cache never shows an old headline.
export default function News({ lang, data }) {
  const rows = (data.news || []).filter((n) => !n.expires_at || Date.parse(n.expires_at) > Date.now()).sort((a, b) => Date.parse(b.published_at || b.fetched_at) - Date.parse(a.published_at || a.fetched_at))
  const sum = (n) => (lang === 'bm' ? n.summary_bm || n.summary_en : n.summary_en)
  return (
    <Segment id="news" lang={lang} title={`${t(lang, 'news')} · ${NEWS_TTL_HOURS} h`} rows={rows}
      columns={[
        { key: 'category', label: t(lang, 'category'), render: (n) => catChip(n.category, lang) },
        { key: 'title', label: t(lang, 'title'), render: (n) => <a className="font-medium hover:underline" href={n.url} target="_blank" rel="noreferrer">{n.title}</a> },
        { key: 'source', label: t(lang, 'source') },
        { key: 'published_at', label: t(lang, 'published'), render: (n) => fmtDateTime(n.published_at, lang) },
        { key: 'expires_at', label: t(lang, 'expires'), render: (n) => `${hoursLeft(n.expires_at)} h` },
      ]}
      renderCard={(n) => (
        <article key={n.id} className="card p-4">
          <div className="flex items-center justify-between mb-2">{catChip(n.category, lang)}<span className="text-xs text-ink-400">{t(lang, 'expires')} {hoursLeft(n.expires_at)} h</span></div>
          <a href={n.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{n.title}</a>
          <p className="text-sm text-ink-600 mt-2">{sum(n)}</p>
          <div className="mt-3 text-xs text-ink-400">{n.source} · {fmtDateTime(n.published_at, lang)}</div>
        </article>
      )} />
  )
}
