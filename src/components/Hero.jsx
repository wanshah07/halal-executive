import { lazy, Suspense, useMemo } from 'react'
import { safeUrl } from '../lib/safe'
import { t } from '../lib/i18n'

// The globe is its own chunk: the headline and the button paint first.
const Globe = lazy(() => import('./ui/globe').then((m) => ({ default: m.Globe })))

// Orange pins on the Earth: KL is the biggest; the others are the countries of
// the foreign halal certification bodies JAKIM recognises (Overview passes them
// in), so the globe shows the hub's reach.
const KL = { location: [3.139, 101.6869], size: 0.1 }

export default function Hero({ lang, settings, markers = [] }) {
  // The welcome line replaces the old plain "Halal Executive" title; a title Admin
  // has typed (hero_title, or hero_title_bm for Bahasa Malaysia) still wins.
  const typed = settings.hero_title && !/^halal executive$/i.test(settings.hero_title.trim())
  const title = (lang === 'bm' && settings.hero_title_bm) || (typed ? settings.hero_title : t(lang, 'hero_welcome'))
  const sub = (lang === 'bm' && settings.hero_subtitle_bm) || settings.hero_subtitle || t(lang, 'hero_default_sub')
  const pins = useMemo(() => [KL, ...markers], [markers])
  return (
    <section className="card overflow-hidden mb-6">
      <div className="grid md:grid-cols-[1fr_340px]">
        <div className="p-6 sm:p-8 bg-gradient-to-br from-brand-50 to-white">
          <div className="chip bg-brand-100 text-brand-700 mb-3">HALAL EXECUTIVE</div>
          <h1 className={`whitespace-nowrap ${lang === 'bm' ? 'text-[clamp(0.85rem,3.75vw,1.875rem)]' : 'text-[clamp(1.05rem,4.7vw,1.875rem)]'} md:text-[clamp(1.2rem,2.3vw,1.875rem)] font-bold text-ink-900`}>{title}</h1>
          <p className="mt-2 text-ink-600 max-w-2xl">{sub}</p>
          {settings.hero_cta && (
            <a href={safeUrl(settings.hero_cta_url, { allowHash: true }) || '#faq'} className="btn-brand mt-4">{settings.hero_cta}</a>
          )}
        </div>
        {/* The globe card: a turning Earth on its own, centred, with no text and no
            glow (Wan, 18 Oct 2026). Decorative, so hidden from screen readers. */}
        <div className="relative h-[340px] md:h-auto md:min-h-[340px] overflow-hidden bg-gradient-to-b from-white to-brand-50" aria-hidden="true">
          <Suspense fallback={null}>
            <Globe className="top-5 max-w-[300px]" markers={pins} />
          </Suspense>
        </div>
      </div>
    </section>
  )
}
