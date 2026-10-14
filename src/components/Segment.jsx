import { useState } from 'react'
import ViewToggle from './ViewToggle'
import { t } from '../lib/i18n'

// One segment = header row (title, count, filters, card/table toggle) and
// either a card grid or a table over the same rows. `columns` drives the
// table; `renderCard` draws a card. Both receive the same row objects.
export default function Segment({ lang, title, rows, columns, renderCard, filters, defaultView = 'cards', empty, id }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem('he:view:' + id) || defaultView } catch { return defaultView } })
  const pick = (v) => { setView(v); try { localStorage.setItem('he:view:' + id, v) } catch { /* ignore */ } }
  return (
    <section id={id} className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-xl font-bold">{title} <span className="text-ink-400 font-normal text-base">({rows.length})</span></h2>
        <div className="flex flex-wrap items-center gap-2">{filters}<ViewToggle lang={lang} view={view} setView={pick} /></div>
      </div>
      {!rows.length && <div className="card p-6 text-sm text-ink-400">{empty || t(lang, 'no_data')}</div>}
      {!!rows.length && view === 'cards' && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map(renderCard)}</div>}
      {!!rows.length && view === 'table' && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} id={`row-${r.id}`} className="hover:bg-paper">{columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
