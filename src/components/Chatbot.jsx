import { useEffect, useMemo, useState } from 'react'
import { askAssistant } from '../lib/api'
import { buildIndex, search } from '../lib/search'
import { t } from '../lib/i18n'
import { ICON, MessageCircle, X } from './Icon'

// Retrieval first, model second. The page searches its own FAQ and guidelines,
// shows the top hits immediately, then asks the Apps Script chat endpoint
// (MIRELD / AFIQ, alternating) for a grounded answer over those hits only.
export default function Chatbot({ lang, data, open, setOpen, seed }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const index = useMemo(() => buildIndex(data), [data])

  async function ask(question) {
    if (!question.trim()) return
    const hits = search(index, question, 6)
    const context = hits.map((h) => ({ type: h.type, id: h.id, title: h.title, body: h.body.slice(0, 1200) }))
    setMsgs((m) => [...m, { role: 'user', text: question }, { role: 'hits', hits }])
    setQ(''); setBusy(true)
    try {
      const r = await askAssistant(question, lang, context)
      if (r.offline) setMsgs((m) => [...m, { role: 'bot', text: lang === 'bm' ? 'Mod luar talian: carian sahaja. Tetapkan VITE_API_URL untuk jawapan daripada model.' : 'Offline mode: search only. Set VITE_API_URL to get model answers.' }])
      else setMsgs((m) => [...m, { role: 'bot', text: r.answer || r.error || '—', meta: r.provider ? `${r.provider} · ${r.model}` : '' }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: String(e.message || e) }])
    } finally { setBusy(false) }
  }

  // A question pushed from the search bar arrives as {q, n}; n changes per push.
  useEffect(() => { if (seed && seed.n) { setOpen(true); ask(seed.q) } /* eslint-disable-next-line */ }, [seed && seed.n])

  return (
    <>
      <button onClick={() => setOpen(!open)} className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-5 right-4 sm:right-5 z-40 rounded-full bg-brand-600 text-white shadow-lg px-4 py-3 font-semibold hover:bg-brand-700 inline-flex items-center gap-2"><MessageCircle {...ICON} size={20} /> {t(lang, 'chatbot')}</button>
      {open && (
        <div className="fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] md:bottom-20 right-4 sm:right-5 z-40 w-[min(420px,calc(100vw-2.5rem))] card shadow-2xl flex flex-col max-h-[calc(100dvh-13rem)] md:max-h-[70vh]">
          <div className="px-4 py-3 border-b border-line font-semibold flex justify-between"><span>{t(lang, 'chatbot')}</span><button onClick={() => setOpen(false)} aria-label="close" className="text-ink-400 hover:text-ink-900"><X {...ICON} /></button></div>
          <div className="flex-1 overflow-auto p-4 space-y-3 text-sm">
            {!msgs.length && <div className="text-ink-400">{t(lang, 'sources_note')}</div>}
            {msgs.map((m, i) => m.role === 'hits' ? (
              <div key={i} className="space-y-1">{m.hits.map((h) => <div key={h.type + h.id} className="chip bg-paper border border-line mr-1">{h.type}: {h.title.slice(0, 60)}</div>)}</div>
            ) : (
              <div key={i} className={`rounded-lg px-3 py-2 whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand-50 ml-8' : 'bg-paper mr-8'}`}>{m.text}{m.meta && <div className="text-[10px] text-ink-400 mt-1">{m.meta}</div>}</div>
            ))}
            {busy && <div className="text-ink-400">…</div>}
          </div>
          <div className="p-3 border-t border-line flex gap-2">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(q)} placeholder={t(lang, 'search_ph')} />
            <button className="btn-brand" onClick={() => ask(q)} disabled={busy}>{t(lang, 'ask')}</button>
          </div>
        </div>
      )}
    </>
  )
}
