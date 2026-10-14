import { safeUrl, imageUrl } from '../lib/safe'
import Segment from '../components/Segment'
import { t } from '../lib/i18n'
import { fmtDateTime } from '../lib/util'
import Poster from '../components/Poster'
import { ICON, ArrowUpRight } from '../components/Icon'

export default function Events({ lang, data }) {
  const rows = (data.events || []).filter((e) => e.status !== 'hidden').sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))
  const posters = (() => { try { return JSON.parse((data.settings || {}).posters || '[]') } catch { return [] } })()
  const title = (e) => (lang === 'bm' ? e.title_bm || e.title : e.title)
  return (
    <div>
      {!!posters.length && (
        <section className="mb-6">
          <h2 className="text-xl font-bold mb-3">{t(lang, 'posters')}</h2>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">{posters.map((p, i) => <a key={i} href={safeUrl(p.link) || safeUrl(p.file) || safeUrl(p.url) || undefined} target="_blank" rel="noreferrer" className="card overflow-hidden"><img src={imageUrl(p.url)} alt={p.title || ''} referrerPolicy="no-referrer" className="block w-full h-auto object-contain bg-paper" />{p.title && <div className="p-2 text-sm font-medium">{p.title}</div>}</a>)}</div>
        </section>
      )}
      <Segment cardGrid="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" id="events" lang={lang} title={t(lang, 'events')} rows={rows}
        columns={[
          { key: 'title', label: t(lang, 'title'), render: title },
          { key: 'date_start', label: t(lang, 'date'), render: (e) => fmtDateTime(e.date_start, lang) },
          { key: 'venue', label: t(lang, 'venue') },
          { key: 'link', label: t(lang, 'register'), render: (e) => safeUrl(e.link) ? <a className="text-brand-600 hover:underline" href={safeUrl(e.link)} target="_blank" rel="noreferrer" aria-label={t(lang, 'register')}><ArrowUpRight {...ICON} size={16} /></a> : '—' },
        ]}
        renderCard={(e) => (
          <article key={e.id} className="card overflow-hidden">
            {safeUrl(e.poster_url) && <Poster url={e.poster_url} file={e.poster_file} title={title(e)} />}
            <div className="p-4">
              <div className="text-xs text-ink-400">{fmtDateTime(e.date_start, lang)}{e.venue && ` · ${e.venue}`}</div>
              <div className="font-semibold mt-1">{title(e)}</div>
              {e.description && <p className="text-sm text-ink-600 mt-2">{e.description}</p>}
              {safeUrl(e.link) && <a className="btn-brand mt-3" href={safeUrl(e.link)} target="_blank" rel="noreferrer">{t(lang, 'register')} <ArrowUpRight {...ICON} size={15} /></a>}
            </div>
          </article>
        )} />
    </div>
  )
}
