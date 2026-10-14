import { t } from '../lib/i18n'
export default function ViewToggle({ lang, view, setView }) {
  return (
    <div className="inline-flex rounded-lg border border-line overflow-hidden text-sm">
      {['cards', 'table'].map((v) => (
        <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-paper'}`}>{t(lang, v)}</button>
      ))}
    </div>
  )
}
