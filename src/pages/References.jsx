import { useState } from 'react'
import { askRefs } from '../lib/api'
import { API_URL } from '../lib/config'
import { t } from '../lib/i18n'
import { fmtDate } from '../lib/util'
import { catChip } from '../components/CategoryFilter'
import { ICON, ChevronDown, ChevronRight } from '../components/Icon'

// Ask the references library. The answer comes in plain words first, then
// the detail, then the exact pages it rests on. Nothing outside the uploaded
// references is used; a citation the AI makes up is dropped by the server.
const EXAMPLES = {
  bm: ['Berapa lama sijil halal sah?', 'Siapa wajib ada Eksekutif Halal?', 'Bolehkah logo halal dicetak warna lain?'],
  en: ['How long is a halal certificate valid?', 'Who must appoint a Halal Executive?', 'Can the halal logo be printed in another colour?'],
}
const guessLang = (q) => (/\b(apa|berapa|siapa|bila|bagaimana|boleh|perlu|ke|tak|sijil|syarikat|wajib|mana)\b/i.test(q) ? 'bm' : 'en')

export default function References({ lang, data }) {
  const [q, setQ] = useState('')
  const [ans, setAns] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const refs = data.references || []
  async function ask(question) {
    const text = (question ?? q).trim()
    if (text.length < 3) return
    setQ(text); setBusy(true); setErr(''); setAns(null); setOpen(false)
    try { setAns(await askRefs(text, guessLang(text))) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 className="text-xl font-bold mb-1">{t(lang, 'references')}</h2>
        <p className="text-sm text-ink-600 mb-4">{t(lang, 'refs_sub')}</p>
        <form onSubmit={(e) => { e.preventDefault(); ask() }} className="flex gap-2 mb-3">
          <input id="ref-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'refs_ph')} maxLength={600} />
          <button className="btn-brand shrink-0" disabled={busy || !API_URL}>{busy ? '…' : t(lang, 'ask')}</button>
        </form>
        <div className="flex flex-wrap gap-2 mb-5">{[...EXAMPLES.bm, ...EXAMPLES.en].map((x) => <button key={x} type="button" className="chip bg-paper border border-line hover:bg-brand-50" onClick={() => ask(x)}>{x}</button>)}</div>
        {!API_URL && <div className="card p-4 text-sm text-ink-600">{t(lang, 'not_connected')}</div>}
        {busy && <div className="card p-5 animate-pulse text-sm text-ink-400">{t(lang, 'refs_thinking')}</div>}
        {err && <div className="card p-4 text-sm text-red-600">{err}</div>}
        {ans && (
          <article className="card p-5 space-y-4">
            {ans.none ? <p className="text-ink-600">{ans.message || t(lang, 'refs_none')}</p> : <>
              <section>
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-700 mb-1">{t(lang, 'in_simple')}</div>
                <p className="text-lg leading-relaxed whitespace-pre-wrap">{ans.layman}</p>
              </section>
              {ans.details && (
                <section>
                  <button className="text-sm font-semibold text-ink-900 flex items-center gap-1" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown {...ICON} size={16} /> : <ChevronRight {...ICON} size={16} />} {t(lang, 'details')}</button>
                  {open && <p className="text-sm mt-2 leading-relaxed whitespace-pre-wrap text-ink-900">{ans.details}</p>}
                </section>
              )}
              <section>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-600 mb-2">{t(lang, 'citations')}</div>
                {!ans.citations?.length && <div className="text-sm text-ink-400">{t(lang, 'no_citation')}</div>}
                <ol className="space-y-2">{(ans.citations || []).map((c, k) => (
                  <li key={k} className="rounded-lg border border-line bg-paper p-3 text-sm">
                    <div className="font-medium [overflow-wrap:anywhere]">{c.title} · <span className="text-brand-700">{/^\d+$/.test(c.page) ? `${t(lang, 'page')} ${c.page}` : c.page}</span></div>
                    {c.quote && <blockquote className="text-ink-600 mt-1 italic">“{c.quote}”</blockquote>}
                  </li>
                ))}</ol>
              </section>
              <div className="text-xs text-ink-400">{ans.cached ? t(lang, 'from_cache') : `${(ans.ms / 1000).toFixed(1)} s`}{ans.provider ? ` · ${ans.provider === 'AFIQ' ? 'Wanshah 1' : 'Wanshah 2'} (${ans.model})` : ''}{ans.confidence ? ` · ${ans.confidence}` : ''}</div>
            </>}
          </article>
        )}
      </div>
      <aside className="min-w-0">
        <h3 className="font-semibold mb-2">{t(lang, 'library')} <span className="text-ink-400 font-normal">({refs.length})</span></h3>
        {!refs.length && <div className="card p-4 text-sm text-ink-400">{t(lang, 'library_empty')}</div>}
        <ul className="space-y-3">{refs.map((r) => {
          let kp = []; try { kp = JSON.parse(r.key_points || '[]') } catch { /* plain */ }
          return (
            <li key={r.id} className="card p-4 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">{catChip(r.category, lang)}<span className="text-xs text-ink-400">{r.pages ? `${r.pages} ${t(lang, 'pages')}` : ''}</span></div>
              <div className="font-semibold leading-snug [overflow-wrap:anywhere]">{r.title}</div>
              <div className="text-xs text-ink-400 [overflow-wrap:anywhere]">{[r.issuer, r.edition].filter(Boolean).join(' · ')}</div>
              {(lang === 'bm' ? r.summary_bm || r.summary_en : r.summary_en) && <p className="text-sm text-ink-600 mt-2 line-clamp-4">{lang === 'bm' ? r.summary_bm || r.summary_en : r.summary_en}</p>}
              {!!kp.length && <details className="mt-2 text-sm"><summary className="cursor-pointer text-brand-600">{t(lang, 'key_points')}</summary><ul className="list-disc pl-5 mt-1 space-y-0.5">{kp.map((p, k) => <li key={k}>{p}</li>)}</ul></details>}
            </li>
          )
        })}</ul>
      </aside>
    </div>
  )
}
