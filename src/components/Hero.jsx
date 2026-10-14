import { useState } from 'react'
import { safeUrl, imageUrl } from '../lib/safe'
import { t } from '../lib/i18n'

export default function Hero({ lang, settings }) {
  const title = settings.hero_title || t(lang, 'hero_default_title')
  const sub = (lang === 'bm' && settings.hero_subtitle_bm) || settings.hero_subtitle || t(lang, 'hero_default_sub')
  const img = imageUrl(settings.hero_image)
  const [bad, setBad] = useState(false)
  return (
    <section className="card overflow-hidden mb-6">
      <div className="grid md:grid-cols-[1fr_320px]">
        <div className="p-6 sm:p-8 bg-gradient-to-br from-brand-50 to-white">
          <div className="chip bg-brand-100 text-brand-700 mb-3">HALAL EXECUTIVE</div>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink-900">{title}</h1>
          <p className="mt-2 text-ink-600 max-w-2xl">{sub}</p>
          {settings.hero_cta && (
            <a href={safeUrl(settings.hero_cta_url, { allowHash: true }) || '#faq'} className="btn-brand mt-4">{settings.hero_cta}</a>
          )}
        </div>
        {/* The picture fills the height of the text beside it (it never sets
            the height itself), cropped to fit; on phones a 16:9 strip. */}
        {img && !bad
          ? <div className="relative aspect-[16/9] md:aspect-auto bg-brand-600"><img src={img} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} className="absolute inset-0 h-full w-full object-cover" /></div>
          : <div className="hidden md:block bg-brand-600" />}
      </div>
    </section>
  )
}
