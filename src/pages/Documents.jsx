import { safeUrl } from '../lib/safe'
import { useState } from 'react'
import Segment from '../components/Segment'
import CategoryFilter, { catChip } from '../components/CategoryFilter'
import { t } from '../lib/i18n'
import { fmtDateTime, publishedAt } from '../lib/util'
import Stamps from '../components/Stamps'
import FileThumb from '../components/FileThumb'
import { filedDocs } from '../lib/certs'

// Certificates and attachments picked out of the groups, filed in Drive by
// pipeline/drive_organiser.py. Same content hash = same file (skipped); same
// title with new content = new version, old one archived. updated_at is the
// Drive modifiedTime so the "last updated" is always visible here.
const kindName = (k, lang) => { const key = 'dk_' + String(k || '').toLowerCase(); const v = t(lang, key); return v && v !== key ? v : String(k || '').replace(/_/g, ' ') }
export default function Documents({ lang, data }) {
  const [cat, setCat] = useState('all')
  const [show, setShow] = useState('current')
  const rows = filedDocs(data.documents).filter((d) => (cat === 'all' || d.category === cat) && (show === 'all' || d.status === show))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  const status = (d) => <span className={`chip ${d.status === 'current' ? 'bg-brand-100 text-brand-700' : 'bg-paper text-ink-400 border border-line'}`}>{t(lang, d.status)}</span>
  const filters = (
    <>
      <CategoryFilter lang={lang} value={cat} onChange={setCat} />
      <div className="inline-flex rounded-lg border border-line overflow-hidden text-sm">
        {['current', 'archived', 'all'].map((s) => <button key={s} onClick={() => setShow(s)} className={`px-3 py-1.5 ${show === s ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-paper'}`}>{t(lang, s)}</button>)}
      </div>
    </>
  )
  return (
    <Segment id="documents" lang={lang} title={t(lang, 'documents')} rows={rows} defaultView="table" filters={filters}
      columns={[
        { key: '_thumb', label: '', render: (d) => <FileThumb id={d.id} href={d.drive_url} name={d.title} altPrefix={t(lang, 'documents')} size="row" lang={lang} /> },
        { key: 'status', label: 'Status', render: status },
        { key: 'title', label: t(lang, 'title'), render: (d) => safeUrl(d.drive_url) ? <a className="font-medium hover:underline" href={safeUrl(d.drive_url)} target="_blank" rel="noreferrer">{d.title}</a> : d.title },
        { key: 'kind', label: t(lang, 'kind'), render: (d) => kindName(d.kind, lang) },
        { key: 'category', label: t(lang, 'category'), render: (d) => catChip(d.category, lang) },
        { key: 'version', label: t(lang, 'version'), render: (d) => `v${d.version || 1}` },
        { key: 'received_at', label: t(lang, 'uploaded_on'), render: (d) => fmtDateTime(d.received_at, lang) },
        { key: 'published', label: t(lang, 'published_on'), render: (d) => fmtDateTime(publishedAt(d), lang) },
        { key: 'updated_at', label: t(lang, 'updated'), render: (d) => fmtDateTime(d.updated_at, lang) },
        { key: 'supersedes_id', label: t(lang, 'supersedes') },
      ]}
      renderCard={(d) => (
        <article key={d.id} className="card p-4">
          <div className="mb-3"><FileThumb id={d.id} href={d.drive_url} name={d.title} sub={kindName(d.kind, lang)} altPrefix={t(lang, 'documents')} lang={lang} /></div>
          <div className="flex items-center justify-between mb-2">{status(d)}<span className="text-xs text-ink-400">v{d.version || 1} · {kindName(d.kind, lang)}</span></div>
          {safeUrl(d.drive_url) ? <a href={safeUrl(d.drive_url)} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{d.title}</a> : <div className="font-semibold">{d.title}</div>}
          <div className="mt-2 flex items-center gap-2">{catChip(d.category, lang)}{d.supersedes_id && <span className="text-xs text-ink-400">{t(lang, 'supersedes')} {d.supersedes_id}</span>}</div>
          <Stamps r={d} lang={lang} />
          <div className="mt-1 text-xs text-ink-400">{t(lang, 'updated')} {fmtDateTime(d.updated_at, lang)}</div>
        </article>
      )} />
  )
}
