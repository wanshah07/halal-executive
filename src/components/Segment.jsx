import { useEffect, useState } from 'react'
import Pager from './Pager'
import ViewToggle from './ViewToggle'
import { t } from '../lib/i18n'

// One segment = header row (title, count, filters, card/table toggle) and
// either a card grid or a table over the same rows. `columns` drives the
// table; `renderCard` draws a card. Both receive the same row objects.
// Long lists are shown 20 at a time with the shared page bar. A row the page
// is asked to show (focusId, e.g. a question clicked on the Overview) opens
// the page it is on.
export default function Segment({ lang, title, rows, columns, renderCard, filters, defaultView = 'cards', empty, id, cardGrid = 'grid gap-4 md:grid-cols-2 xl:grid-cols-3', perPage = 20, focusId, focusKey }) {
  const [pg, setPg] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / perPage))
  useEffect(() => { setPg(0) }, [rows.length]) // a filter changed the list
  useEffect(() => {
    if (!focusId) return
    const i = rows.findIndex((r) => String(r.id) === String(focusId))
    if (i >= 0) setPg(Math.floor(i / perPage))
  }, [focusId, focusKey, rows.length])
  const page = Math.min(pg, pages - 1)
  const shown = rows.slice(page * perPage, page * perPage + perPage)
  const turn = (p) => { setPg(p); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  // Phones start on cards (tables need sideways scrolling there); a choice the
  // reader made before is kept.
  const start = typeof window !== 'undefined' && window.innerWidth < 640 ? 'cards' : defaultView
  const [view, setView] = useState(() => { try { return localStorage.getItem('he:view:' + id) || start } catch { return start } })
  const pick = (v) => { setView(v); try { localStorage.setItem('he:view:' + id, v) } catch { /* ignore */ } }
  return (
    <section id={id} className="mb-8 scroll-mt-32">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-xl font-bold">{title} <span className="text-ink-400 font-normal text-base">({rows.length})</span></h2>
        <div className="flex flex-wrap items-center gap-2">{filters}<ViewToggle lang={lang} view={view} setView={pick} /></div>
      </div>
      {!rows.length && <div className="card p-6 text-sm text-ink-400">{empty || t(lang, 'no_data')}</div>}
      {!!rows.length && view === 'cards' && <div className={cardGrid}>{shown.map(renderCard)}</div>}
      {!!rows.length && view === 'table' && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{shown.map((r) => <tr key={r.id} id={`row-${r.id}`} className="hover:bg-paper">{columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      <Pager lang={lang} page={page} pages={pages} onPage={turn} label={`${title} pages`} />
    </section>
  )
}
