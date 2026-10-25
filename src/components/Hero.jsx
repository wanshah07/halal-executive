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
  // The old titles (Halal Executive, Halal Executive Hub, the welcome line) count as not typed too,
  // so the site follows the new name (Malaysian Halal Practitioners Hub, 25 Oct 2026).
  const typed = settings.hero_title && !/^(welcome to |selamat datang ke )?halal executive( hub)?$/i.test(settings.hero_title.trim())
  const title = (lang === 'bm' && settings.hero_title_bm) || (typed ? settings.hero_title : t(lang, 'hero_welcome'))
  const oldSub = (v) => !v || /for halal executives, in one place|untuk eksekutif halal, di satu tempat/i.test(v)
  const sub = (lang === 'bm' && !oldSub(settings.hero_subtitle_bm) && settings.hero_subtitle_bm) || (!oldSub(settings.hero_subtitle) && settings.hero_subtitle) || t(lang, 'hero_default_sub')
  const pins = useMemo(() => [KL, ...markers], [markers])
  return (
    <section className="card overflow-hidden mb-6">
      <div className="grid md:grid-cols-[1fr_340px]">
        <div className="p-6 sm:p-8 bg-gradient-to-br from-brand-50 to-white">
          <div className="chip bg-brand-100 text-brand-700 mb-3">HALAL PRACTITIONERS</div>
          {/* The name is long now: wraps on phones and on tablets (768-1023 px, where the globe takes a third), one line otherwise, sized to the column it sits in. */}
          <h1 className={`text-[1.2rem] leading-tight text-balance sm:whitespace-nowrap md:whitespace-normal md:text-[1.3rem] lg:whitespace-nowrap font-bold text-ink-900 ${lang === 'bm' ? 'sm:text-[clamp(0.8rem,calc((100vw_-_112px)/31),1.6rem)] lg:text-[clamp(0.7rem,calc((100vw_-_452px)/31),1.4rem)] xl:text-[clamp(0.9rem,calc((100vw_-_684px)/31),1.6rem)]' : 'sm:text-[clamp(0.8rem,calc((100vw_-_112px)/27),1.75rem)] lg:text-[clamp(0.7rem,calc((100vw_-_452px)/27),1.5rem)] xl:text-[clamp(0.9rem,calc((100vw_-_684px)/27),1.75rem)]'}`}>{title}</h1>
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
