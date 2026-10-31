import { useEffect, useRef, useState } from 'react'
import { CATEGORIES } from '../lib/config'
import { safeUrl } from '../lib/safe'
import { t } from '../lib/i18n'
import { hoursLeft } from '../lib/util'
import { ICON, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from './Icon'

// Halal news, right under the welcome (Wan, 31 Oct 2026: "make the news segment more
// impress and attract people to check the news"). One lead story on a green panel that
// turns by itself every 7 seconds (story-style progress bars, arrows, swipe on phones;
// it rests while a mouse is over it and the pause button stops it for good, WCAG 2.2.2),
// and beside it the next headlines as links, each with how fresh it is. A story under 12
// hours old carries a NEW badge. With Reduce Motion on, slides still change without
// the animation. Stories live 72 hours (rule 5).
const SLIDE_MS = 7000
const DOT = { halal: 'bg-brand-500', food: 'bg-amber-400', cosmetic: 'bg-pink-400' }

const catName = (lang, id) => { const c = CATEGORIES.find((x) => x.id === id) || CATEGORIES[0]; return c[lang] || c.en }
const ageH = (it) => Math.max(0, (Date.now() - Date.parse(it.published_at || it.fetched_at)) / 36e5)
export const agoText = (lang, h) => {
  const f = (k, n) => t(lang, k).replace('{n}', n)
  return h < 1 ? f('nw_ago_m', Math.max(1, Math.round(h * 60))) : h < 24 ? f('nw_ago_h', Math.round(h)) : f('nw_ago_d', Math.round(h / 24))
}

export default function NewsCarousel({ lang, news, setTab }) {
  const items = (news || []).filter((n) => !n.expires_at || Date.parse(n.expires_at) > Date.now())
    .sort((a, b) => Date.parse(b.published_at || b.fetched_at) - Date.parse(a.published_at || a.fetched_at)).slice(0, 10)
  const [i, setI] = useState(0)
  const [hover, setHover] = useState(false)
  const [stopped, setStopped] = useState(false)
  const still = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const paused = hover || stopped
  const x0 = useRef(null)
  const n = items.length
  const go = (d) => setI((v) => (v + d + n) % n)
  useEffect(() => { if (i >= n) setI(0) }, [n, i])
  useEffect(() => {
    if (n < 2 || paused) return
    const id = setTimeout(() => setI((v) => (v + 1) % n), SLIDE_MS)
    return () => clearTimeout(id)
  }, [n, paused, i])
  const text = (it) => (lang === 'bm' ? it.summary_bm || it.summary_en : it.summary_en)
  const lead = items[i]
  // The next headlines in turn after the lead one, so the list moves on with it.
  const next = n > 1 ? Array.from({ length: Math.min(5, n - 1) }, (_, k) => items[(i + 1 + k) % n]) : []
  return (
    <section className="mb-4 rounded-2xl border border-line bg-white shadow-sm overflow-hidden" aria-roledescription="carousel" aria-label={t(lang, 'news')}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true) }} onPointerLeave={() => setHover(false)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 motion-safe:animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-white" /></span>
            {t(lang, 'nw_live')}
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-bold leading-tight">{t(lang, 'news')} <span className="text-ink-400 font-normal text-sm">· {n} {t(lang, 'nw_stories')}</span></h3>
            <p className="text-xs text-ink-600 hidden sm:block">{t(lang, 'nw_pitch')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {n > 1 && <>
            <button className="btn px-2" onClick={() => setStopped(!stopped)} aria-label={stopped ? t(lang, 'play') : t(lang, 'pause')} title={stopped ? t(lang, 'play') : t(lang, 'pause')}>{stopped ? <Play {...ICON} /> : <Pause {...ICON} />}</button>
            <button className="btn px-2" onClick={() => go(-1)} aria-label={t(lang, 'prev')}><ChevronLeft {...ICON} /></button>
            <button className="btn px-2" onClick={() => go(1)} aria-label={t(lang, 'next')}><ChevronRight {...ICON} /></button>
          </>}
          <a href="#news" onClick={() => setTab && setTab('news')} className="btn-brand">{t(lang, 'nw_all')} <ArrowRight {...ICON} size={15} /></a>
        </div>
      </div>
      {!n && <div className="px-5 pb-5 text-sm text-ink-400">{t(lang, 'no_news')}</div>}
      {!!n && (
        <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[3fr_2fr]">
          <article key={lead.id} aria-live={stopped ? 'polite' : 'off'}
            onTouchStart={(e) => { x0.current = e.touches[0].clientX }}
            onTouchEnd={(e) => { if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1) }}
            className={`relative overflow-hidden rounded-xl text-white p-5 sm:p-7 min-h-[300px] flex flex-col bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 ${still ? '' : 'motion-safe:animate-[news-in_.5s_ease-out]'}`}>
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -left-16 -bottom-24 h-64 w-64 rounded-full bg-gold-500/25 blur-3xl" />
            <div className="relative flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-white/15 px-2.5 py-1 font-semibold uppercase tracking-wide">{catName(lang, lead.category)}</span>
              {ageH(lead) < 12 && <span className="rounded-full bg-gold-500 px-2.5 py-1 font-bold uppercase tracking-wide text-white">{t(lang, 'nw_new')}</span>}
              <span className="ml-auto text-white/70">{t(lang, 'nw_left').replace('{n}', hoursLeft(lead.expires_at))}</span>
            </div>
            <a href={safeUrl(lead.url) || undefined} target="_blank" rel="noreferrer" className="relative mt-4 block text-2xl sm:text-3xl font-bold leading-tight decoration-2 underline-offset-4 hover:underline line-clamp-4">{lead.title}</a>
            <p className="relative mt-3 text-sm sm:text-base text-white/80 line-clamp-3">{text(lead)}</p>
            <div className="relative mt-auto pt-5 flex flex-wrap items-center gap-3">
              {safeUrl(lead.url) && <a href={safeUrl(lead.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-brand-700 shadow-lg transition motion-safe:hover:scale-105 hover:bg-gold-500 hover:text-white">{t(lang, 'nw_read')} <ArrowUpRight {...ICON} size={16} /></a>}
              <span className="text-xs text-white/70">{lead.source} · {agoText(lang, ageH(lead))}</span>
            </div>
            {n > 1 && (
              <div className="relative mt-4 flex gap-1.5" role="tablist" aria-label={t(lang, 'news')}>
                {items.map((_, k) => (
                  <button key={k} type="button" role="tab" aria-selected={k === i} aria-label={`${k + 1} / ${n}`} onClick={() => setI(k)} className="group h-4 flex-1 flex items-center">
                    <span className="block h-1 w-full overflow-hidden rounded-full bg-white/25"><span key={k === i ? i + (paused ? 'p' : 'r') : k} className="block h-full rounded-full bg-white"
                      style={{ width: k < i ? '100%' : k === i ? (still || paused ? '100%' : undefined) : '0%', animation: k === i && !still && !paused ? `he-progress ${SLIDE_MS}ms linear forwards` : 'none' }} /></span>
                  </button>
                ))}
              </div>
            )}
          </article>
          <div className="min-w-0">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">{t(lang, 'nw_more')}</div>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {!next.length && <li className="p-4 text-sm text-ink-400">{t(lang, 'no_news')}</li>}
              {next.map((it, k) => (
                <li key={it.id + k}>
                  <a href={safeUrl(it.url) || undefined} target="_blank" rel="noreferrer" className="group flex gap-3 p-3.5 transition hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-none">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[it.category] || 'bg-brand-500'}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-snug line-clamp-2 group-hover:text-brand-700">{it.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
                        {ageH(it) < 12 && <span className="rounded bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">{t(lang, 'nw_new')}</span>}
                        <span>{it.source}</span><span>· {agoText(lang, ageH(it))}</span>
                      </span>
                    </span>
                    <ArrowUpRight {...ICON} size={16} className="mt-1 shrink-0 text-ink-400 transition group-hover:text-brand-600 motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" />
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-400">{t(lang, 'nw_note')}</p>
          </div>
        </div>
      )}
    </section>
  )
}
