import { useEffect, useState } from 'react'
import Segment from '../components/Segment'
import CategoryFilter, { catChip } from '../components/CategoryFilter'
import { t } from '../lib/i18n'
import { fmtDate } from '../lib/util'

export default function FAQ({ lang, data, focusId }) {
  const [cat, setCat] = useState('all')
  const [mode, setMode] = useState('formal')
  const [open, setOpen] = useState(focusId || null)
  useEffect(() => { if (focusId) { setOpen(focusId); setCat('all'); setTimeout(() => document.getElementById(`faq-${focusId}`)?.scrollIntoView({ block: 'center' }), 50) } }, [focusId])
  const rows = (data.faq || []).filter((f) => f.status !== 'hidden' && (cat === 'all' || f.category === cat))
  const q = (f) => (lang === 'bm' ? f.question_bm || f.question_en : f.question_en || f.question_bm)
  const a = (f) => f[`answer_${mode}_${lang}`] || f[`answer_formal_${lang}`] || f.answer_formal_en
  const filters = (
    <>
      <CategoryFilter lang={lang} value={cat} onChange={setCat} />
      <div className="inline-flex rounded-lg border border-line overflow-hidden text-sm">
        {['formal', 'layman'].map((m) => <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 ${mode === m ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-paper'}`}>{t(lang, m)}</button>)}
      </div>
    </>
  )
  return (
    <Segment id="faq" lang={lang} title={t(lang, 'faq')} rows={rows} filters={filters}
      columns={[
        { key: 'category', label: t(lang, 'category'), render: (f) => catChip(f.category, lang) },
        { key: 'subcategory', label: 'Topic' },
        { key: 'q', label: t(lang, 'question'), render: q },
        { key: 'a', label: t(lang, 'answer'), render: (f) => <span className="whitespace-pre-wrap">{a(f)}</span> },
        { key: 'updated_at', label: t(lang, 'updated'), render: (f) => fmtDate(f.updated_at, lang) },
      ]}
      renderCard={(f) => (
        <article key={f.id} id={`faq-${f.id}`} className={`card p-4 ${open === f.id ? 'ring-2 ring-brand-300' : ''}`}>
          <div className="flex items-center justify-between gap-2 mb-2">{catChip(f.category, lang)}<span className="text-xs text-ink-400">{f.subcategory}</span></div>
          <button className="text-left font-semibold leading-snug" onClick={() => setOpen(open === f.id ? null : f.id)}>{q(f)}</button>
          {(open === f.id) && <p className="mt-2 text-sm whitespace-pre-wrap text-ink-900">{a(f)}</p>}
          {open !== f.id && <p className="mt-2 text-sm text-ink-600 line-clamp-3">{a(f)}</p>}
          <div className="mt-3 text-xs text-ink-400 flex justify-between"><span>{f.source_refs}</span><span>{fmtDate(f.updated_at, lang)}</span></div>
        </article>
      )} />
  )
}
