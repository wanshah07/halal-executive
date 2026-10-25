import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { safeUrl } from '../lib/safe'
import { fmtDateTime, eventPast } from '../lib/util'
import Poster from './Poster'
import { ICON, ArrowRight, ArrowUpRight } from './Icon'

// Next events (from the group or added in Admin), soonest first, followed by
// the event posters set in Admin, in one section. Desktop: 4 to a row.
// Phones and tablets: one row that slides on its own every 4 seconds (swipe
// to move it yourself; it rests while touched, and loops back at the end).
export default function UpcomingEvents({ lang, events, posters = [], setTab }) {
  const up = (events || []).filter((e) => !eventPast(e))
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start)).slice(0, 8)
  const ps = (posters || []).filter((p) => safeUrl(p.url))
  const title = (e) => (lang === 'bm' ? e.title_bm || e.title : e.title)
  const rail = useRef(null)
  const [hold, setHold] = useState(false)
  const count = up.length + ps.length
  useEffect(() => {
    if (count < 2 || hold) return
    const id = setInterval(() => {
      const el = rail.current
      if (!el || el.scrollWidth <= el.clientWidth + 4) return // desktop grid: nothing to slide
      const card = el.firstElementChild
      const step = card ? card.getBoundingClientRect().width + 16 : el.clientWidth
      el.scrollTo({ left: el.scrollLeft + el.clientWidth + 4 >= el.scrollWidth ? 0 : el.scrollLeft + step, behavior: 'smooth' })
    }, 4000)
    return () => clearInterval(id)
  }, [count, hold])
  return (
    <section className="card p-5 mb-4">
      <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">{t(lang, 'upcoming')}</h3><a href="#events" onClick={() => setTab('events')} className="text-sm text-brand-600 hover:underline">{t(lang, 'all_events')} <ArrowRight {...ICON} size={15} className="inline -mt-0.5" /></a></div>
      {!up.length && !ps.length && <div className="text-sm text-ink-400">{t(lang, 'no_events')}</div>}
      <div ref={rail} onTouchStart={() => setHold(true)} onTouchEnd={() => setTimeout(() => setHold(false), 4000)}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 -mx-1 px-1 lg:grid lg:grid-cols-4 lg:overflow-visible lg:snap-none lg:pb-0 lg:mx-0 lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {up.map((e) => (
          <article key={e.id} className="snap-start shrink-0 w-[82%] sm:w-[46%] lg:w-auto rounded-xl border border-line overflow-hidden flex flex-col">
            <Poster url={e.poster_url} file={e.poster_file} title={title(e)} />
            <div className="p-4 flex flex-col flex-1">
              <div className="text-xs text-ink-400">{fmtDateTime(e.date_start, lang)}{e.venue && ` · ${e.venue}`}</div>
              <div className="font-semibold mt-1 leading-snug">{title(e)}</div>
              {safeUrl(e.link) && <a className="btn-brand mt-3 self-start" href={safeUrl(e.link)} target="_blank" rel="noreferrer">{t(lang, 'register')} <ArrowUpRight {...ICON} size={15} /></a>}
            </div>
          </article>
        ))}
        {ps.map((p, i) => (
          <article key={'p' + i} className="snap-start shrink-0 w-[82%] sm:w-[46%] lg:w-auto rounded-xl border border-line overflow-hidden flex flex-col">
            <Poster url={p.url} file={safeUrl(p.link) || p.file} title={p.title || t(lang, 'poster')} />
            {p.title && <div className="p-4 font-semibold leading-snug">{p.title}</div>}
          </article>
        ))}
      </div>
    </section>
  )
}
