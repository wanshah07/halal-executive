import { useMemo, useState } from 'react'
import { buildIndex, search } from '../lib/search'
import { t } from '../lib/i18n'
import { ICON, ArrowUpRight } from './Icon'

export default function SearchBar({ lang, data, onOpen, onAsk }) {
  const [q, setQ] = useState('')
  const index = useMemo(() => buildIndex(data), [data])
  const hits = useMemo(() => search(index, q, 12), [index, q])
  const label = { faq: t(lang, 'faq'), guidelines: t(lang, 'guidelines'), documents: t(lang, 'documents'), events: t(lang, 'events'), news: t(lang, 'news'), vacancies: t(lang, 'vacancies'), certificates: t(lang, 'certificates'), references: t(lang, 'references') }
  return (
    <div className="relative">
      <div className="flex gap-2">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'search_ph')} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onAsk(q) }} />
        <button className="btn-brand shrink-0" onClick={() => q.trim() && onAsk(q)}>{t(lang, 'ask')} <ArrowUpRight {...ICON} size={16} /></button>
      </div>
      {q && (
        <div className="absolute z-20 mt-1 w-full card shadow-lg max-h-96 overflow-auto">
          {!hits.length && <div className="p-3 text-sm text-ink-400">{t(lang, 'no_data')}</div>}
          {hits.map((h) => (
            <button key={h.type + h.id} className="w-full text-left px-3 py-2 hover:bg-paper border-b border-line last:border-0" onClick={() => { onOpen(h.type, h.id); setQ('') }}>
              <span className="chip bg-brand-50 text-brand-700 mr-2">{label[h.type]}</span>
              <span className="text-sm">{h.title.slice(0, 140)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
