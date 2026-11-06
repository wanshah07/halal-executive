import { useMemo, useState } from 'react'
import { buildIndex, search } from '../lib/search'
import { t } from '../lib/i18n'
import { loadAllAnswers, answersPending, wantEverything } from '../lib/api'
import { ICON, ArrowUpRight } from './Icon'

export default function SearchBar({ lang, data, onOpen, onAsk }) {
  const [q, setQ] = useState('')
  // Built only once something is typed: tokenising every segment on each
  // feed update cost the first paint on phones.
  const typed = q.trim() !== ''
  const index = useMemo(() => (typed ? buildIndex(data) : null), [data, typed])
  const hits = useMemo(() => (index ? search(index, q, 12) : []), [index, q])
  // Search reads every FAQ answer text: the deploy's snapshot sends them in
  // chunks only when needed, so they are fetched the moment the box is used,
  // and the results grow to the full set when they land.
  const want = () => { wantEverything(data).then((w) => loadAllAnswers(w || data)) }
  const pending = !!q && (answersPending(data) || !!(data._missing && data._missing.length))
  const label = { faq: t(lang, 'faq'), guidelines: t(lang, 'guidelines'), documents: t(lang, 'documents'), events: t(lang, 'events'), news: t(lang, 'news'), vacancies: t(lang, 'vacancies'), certificates: t(lang, 'certificates'), references: t(lang, 'references') }
  return (
    <div className="relative">
      <div className="flex gap-2">
        <input className="input" type="search" aria-label={t(lang, 'search_ph')} value={q} onFocus={want} onChange={(e) => { setQ(e.target.value); want() }} placeholder={t(lang, 'search_ph')} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onAsk(q) }} />
        <button className="btn-brand shrink-0" onClick={() => q.trim() && onAsk(q)}>{t(lang, 'ask')} <ArrowUpRight {...ICON} size={16} /></button>
      </div>
      {q && (
        <div className="absolute z-20 mt-1 w-full card shadow-lg max-h-96 overflow-auto">
          {pending && <div className="px-3 py-2 text-xs text-ink-400 border-b border-line" role="status">{t(lang, 'search_answers_loading')}</div>}
          {!hits.length && !pending && <div className="p-3 text-sm text-ink-400">{t(lang, 'no_data')}</div>}
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
