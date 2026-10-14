import { t } from '../lib/i18n'
import { safeUrl } from '../lib/safe'
import { fmtDateTime } from '../lib/util'

// Next events (from the group or added in Admin), soonest first.
export default function UpcomingEvents({ lang, events, setTab }) {
  const up = (events || []).filter((e) => Date.parse(e.date_end || e.date_start) >= Date.now() - 864e5)
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start)).slice(0, 3)
  return (
    <section className="card p-5 mb-4">
      <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">{t(lang, 'upcoming')}</h3><a href="#events" onClick={() => setTab('events')} className="text-sm text-brand-600 hover:underline">{t(lang, 'all_events')} →</a></div>
      {!up.length && <div className="text-sm text-ink-400">{t(lang, 'no_events')}</div>}
      <div className="grid gap-4 md:grid-cols-3">
        {up.map((e) => (
          <article key={e.id} className="rounded-xl border border-line overflow-hidden flex flex-col">
            {safeUrl(e.poster_url) ? <img src={safeUrl(e.poster_url)} alt="" loading="lazy" className="w-full aspect-[16/9] object-cover bg-paper" /> : <div className="w-full aspect-[16/9] bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center text-white/80 text-sm font-semibold px-4 text-center">{lang === 'bm' ? e.title_bm || e.title : e.title}</div>}
            <div className="p-4 flex flex-col flex-1">
              <div className="text-xs text-ink-400">{fmtDateTime(e.date_start, lang)}{e.venue && ` · ${e.venue}`}</div>
              <div className="font-semibold mt-1 leading-snug">{lang === 'bm' ? e.title_bm || e.title : e.title}</div>
              {safeUrl(e.link) && <a className="btn-brand mt-3 self-start" href={safeUrl(e.link)} target="_blank" rel="noreferrer">{t(lang, 'register')} ↗</a>}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
