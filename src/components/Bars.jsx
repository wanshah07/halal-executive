// Horizontal bar list, like the "From detection to filing" panel on the KKM
// Complaints dashboard. One colour per panel; the number is the fact.
export default function Bars({ title, rows, lang, empty = 'No data yet.' }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-3">{title}</h3>
      {!rows.length && <div className="text-sm text-ink-400">{empty}</div>}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-sm"><span>{r.label}</span><span className="font-semibold">{r.value}{r.pct != null && <span className="text-ink-400 font-normal ml-1">{r.pct}%</span>}</span></div>
            <div className="h-2 rounded bg-paper mt-1 overflow-hidden"><div className="h-2 bg-brand-500 rounded" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
