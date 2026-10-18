import { t } from '../lib/i18n'
import { fmtDateTime, uploadedAt, publishedAt } from '../lib/util'

// "Uploaded 17 Oct 2026, 7:36 pm · Published 17 Oct 2026, 8:02 pm" (Malaysia
// time). News passes its own two moments: when it was fetched, and the date
// the source gave it.
export default function Stamps({ r, lang, up, pub, upLabel = 'uploaded_on', className = 'mt-3 text-xs text-ink-400' }) {
  const u = up !== undefined ? up : uploadedAt(r), p = pub !== undefined ? pub : publishedAt(r)
  if (!u && !p) return null
  return (
    <div className={`${className} flex flex-wrap gap-x-3 gap-y-0.5`}>
      {u && <span>{t(lang, upLabel)} {fmtDateTime(u, lang)}</span>}
      {p && <span>{t(lang, 'published_on')} {fmtDateTime(p, lang)}</span>}
    </div>
  )
}
export const stampCols = (lang, fmt = fmtDateTime) => [
  { key: 'uploaded', label: t(lang, 'uploaded_on'), render: (r) => fmt(uploadedAt(r), lang) },
  { key: 'published', label: t(lang, 'published_on'), render: (r) => fmt(publishedAt(r), lang) },
]
