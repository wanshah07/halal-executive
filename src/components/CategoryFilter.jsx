import { CATEGORIES } from '../lib/config'
import { t } from '../lib/i18n'
export default function CategoryFilter({ lang, value, onChange }) {
  const opts = [{ id: 'all', en: t('en', 'all'), bm: t('bm', 'all') }, ...CATEGORIES]
  return (
    <div className="inline-flex rounded-lg border border-line overflow-hidden text-sm">
      {opts.map((c) => <button key={c.id} onClick={() => onChange(c.id)} className={`px-3 py-1.5 ${value === c.id ? 'bg-brand-600 text-white' : 'bg-white text-ink-600 hover:bg-paper'}`}>{c[lang] || c.en}</button>)}
    </div>
  )
}
export const catChip = (id, lang) => { const c = CATEGORIES.find((x) => x.id === id); const tone = { halal: 'bg-brand-100 text-brand-700', food: 'bg-amber-100 text-amber-800', cosmetic: 'bg-pink-100 text-pink-800' }[id] || 'bg-paper text-ink-600'; return <span className={`chip ${tone}`}>{c ? c[lang] || c.en : id || '—'}</span> }
