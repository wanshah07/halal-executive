import { t } from '../lib/i18n'

// Page numbers in blocks of 10 (1-10, 11-20, ...) with previous / next page
// and « » to jump a block, so a long list never shows 45 buttons
// (Wan, 15 Oct 2026). `page` is 0-based.
export default function Pager({ lang, page, pages, onPage, label = 'pages' }) {
  if (pages <= 1) return null
  const first = Math.floor(page / 10) * 10, last = Math.min(pages, first + 10)
  const go = (p) => onPage(Math.max(0, Math.min(pages - 1, p)))
  const btn = 'btn px-2.5 py-1 min-w-9 justify-center'
  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5 mt-3" aria-label={label}>
      {pages > 10 && <button className={btn} disabled={first === 0} onClick={() => go(first - 10)} aria-label={t(lang, 'prev_block')} title={t(lang, 'prev_block')}>«</button>}
      <button className={btn} disabled={page === 0} onClick={() => go(page - 1)} aria-label={t(lang, 'prev')} title={t(lang, 'prev')}>‹</button>
      {Array.from({ length: last - first }, (_, k) => first + k).map((i) => (
        <button key={i} onClick={() => go(i)} aria-current={i === page ? 'page' : undefined}
          className={`${btn} ${i === page ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700' : ''}`}>{i + 1}</button>
      ))}
      <button className={btn} disabled={page === pages - 1} onClick={() => go(page + 1)} aria-label={t(lang, 'next')} title={t(lang, 'next')}>›</button>
      {pages > 10 && <button className={btn} disabled={last >= pages} onClick={() => go(last)} aria-label={t(lang, 'next_block')} title={t(lang, 'next_block')}>»</button>}
      <span className="text-xs text-ink-400 ml-1">{t(lang, 'page_of').replace('{p}', page + 1).replace('{n}', pages)}</span>
    </nav>
  )
}
