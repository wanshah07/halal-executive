import { lazy, Suspense, useMemo } from 'react'
import { safeUrl } from '../lib/safe'
import { t } from '../lib/i18n'
import { SITE_NAME } from '../lib/config'

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
          <h1 className="text-2xl sm:text-3xl font-bold text-ink-900">{title}</h1>
          <p className="mt-2 text-ink-600 max-w-2xl">{sub}</p>
          {settings.hero_cta && (
            <a href={safeUrl(settings.hero_cta_url, { allowHash: true }) || '#faq'} className="btn-brand mt-4">{settings.hero_cta}</a>
          )}
        </div>
        {/* The globe card: the name in a fading gradient above a turning Earth
            that the card clips at the bottom. Decorative, so hidden from
            screen readers; the name is already the page title. */}
        <div className="relative h-[340px] md:h-auto md:min-h-[340px] overflow-hidden bg-gradient-to-b from-white to-brand-50" aria-hidden="true">
          <span className="pointer-events-none absolute inset-x-0 top-4 z-10 whitespace-pre-wrap bg-gradient-to-b from-[#063d22] via-[#0b6b3a] to-[#1f8f55] bg-clip-text whitespace-nowrap px-2 text-center text-[28px] font-bold leading-tight text-transparent">
            {SITE_NAME}
          </span>
          <Suspense fallback={null}>
            <Globe className="top-16 max-w-[300px]" markers={pins} />
          </Suspense>
        </div>
      </div>
    </section>
  )
}
