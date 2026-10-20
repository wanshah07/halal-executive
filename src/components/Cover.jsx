import { CATEGORIES } from '../lib/config'
import { ICON } from './Icon'

// The top box every card carries, like an event's poster (Wan, 20 Oct 2026:
// "all segments got their own box same like event"). Segments with no picture
// of their own (FAQ, guidelines, news, vacancies without a poster) get the
// segment's icon on the colour of the item's category, with a short label, so
// every grid reads as a row of boxes and no card is a bare block of text.
const TONE = {
  halal: 'from-brand-600 to-brand-900',
  food: 'from-amber-500 to-orange-700',
  cosmetic: 'from-pink-500 to-rose-800',
}
export default function Cover({ icon: Icon, category, label, sub, lang = 'en' }) {
  const cat = CATEGORIES.find((c) => c.id === category)
  return (
    <div className={`relative w-full aspect-[16/7] bg-gradient-to-br ${TONE[category] || 'from-ink-600 to-ink-900'} text-white overflow-hidden`}>
      {/* the icon, large and faint, as the picture */}
      {Icon && <Icon {...ICON} size={120} strokeWidth={1.1} className="absolute -right-5 -bottom-6 opacity-20" />}
      <div className="absolute inset-0 p-4 flex flex-col justify-between">
        <span className="self-start rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">{cat ? cat[lang] || cat.en : category || label}</span>
        <div className="min-w-0">
          {Icon && <Icon {...ICON} size={22} className="mb-1 opacity-90" />}
          <div className="text-sm font-semibold leading-snug line-clamp-2 [overflow-wrap:anywhere]">{label}</div>
          {sub && <div className="text-xs text-white/80 truncate">{sub}</div>}
        </div>
      </div>
    </div>
  )
}
