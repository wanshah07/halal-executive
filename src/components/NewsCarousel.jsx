import { useEffect, useRef, useState } from 'react'
import { catChip } from './CategoryFilter'
import { safeUrl } from '../lib/safe'
import { t } from '../lib/i18n'
import { fmtDateTime, hoursLeft } from '../lib/util'

// Halal news, one slide at a time: arrows, dots, swipe on phones, and an
// auto-advance every 7 seconds that pauses on hover, on focus and for people
// who ask for reduced motion.
export default function NewsCarousel({ lang, news }) {
  const items = (news || []).filter((n) => !n.expires_at || Date.parse(n.expires_at) > Date.now())
    .sort((a, b) => Date.parse(b.published_at || b.fetched_at) - Date.parse(a.published_at || a.fetched_at)).slice(0, 12)
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const x0 = useRef(null)
  const n = items.length
  const go = (d) => setI((v) => (v + d + n) % n)
  useEffect(() => { if (i >= n) setI(0) }, [n, i])
  useEffect(() => {
    if (n < 2 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setI((v) => (v + 1) % n), 7000)
    return () => clearInterval(id)
  }, [n, paused])
  return (
    <section className="card p-5 mb-4" aria-roledescription="carousel" aria-label={t(lang, 'news')}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{t(lang, 'news')} <span className="text-ink-400 font-normal text-sm">· {t(lang, 'live_news')}</span></h3>
        {n > 1 && <div className="flex gap-1.5"><button className="btn px-2.5" onClick={() => go(-1)} aria-label={t(lang, 'prev')}>‹</button><button className="btn px-2.5" onClick={() => go(1)} aria-label={t(lang, 'next')}>›</button></div>}
      </div>
      {!n && <div className="text-sm text-ink-400">{t(lang, 'no_news')}</div>}
      {!!n && (
        <div className="overflow-hidden" onTouchStart={(e) => { x0.current = e.touches[0].clientX }} onTouchEnd={(e) => { if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); x0.current = null }}>
          <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${i * 100}%)` }}>
            {items.map((it, k) => (
              <article key={it.id} className="w-full shrink-0 pr-1" aria-roledescription="slide" aria-label={`${k + 1} / ${n}`} aria-hidden={k !== i}>
                <div className="rounded-xl bg-gradient-to-br from-brand-50 to-white border border-line p-5 min-h-[150px] flex flex-col">
                  <div className="flex items-center justify-between gap-2 mb-2">{catChip(it.category, lang)}<span className="text-xs text-ink-400">{t(lang, 'expires')} {hoursLeft(it.expires_at)} h</span></div>
                  <a href={safeUrl(it.url) || undefined} target="_blank" rel="noreferrer" tabIndex={k === i ? 0 : -1} className="text-lg font-semibold leading-snug hover:underline">{it.title}</a>
                  <p className="text-sm text-ink-600 mt-2 line-clamp-3">{lang === 'bm' ? it.summary_bm || it.summary_en : it.summary_en}</p>
                  <div className="mt-auto pt-3 text-xs text-ink-400">{it.source} · {fmtDateTime(it.published_at, lang)}</div>
                </div>
              </article>
            ))}
          </div>
          {n > 1 && <div className="flex justify-center gap-1.5 mt-3">{items.map((_, k) => <button key={k} onClick={() => setI(k)} aria-label={`${k + 1}`} className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-brand-600' : 'w-2 bg-line hover:bg-ink-400'}`} />)}</div>}
        </div>
      )}
    </section>
  )
}
