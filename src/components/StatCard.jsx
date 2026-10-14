export default function StatCard({ label, value, hint, tone = 'ink' }) {
  const color = { ink: 'text-ink-900', blue: 'text-blue-600', amber: 'text-amber-500', green: 'text-brand-600', grey: 'text-ink-400', red: 'text-red-600' }[tone]
  return (
    <div className="card p-4">
      <div className="text-sm text-ink-600">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${color}`}>{value ?? '—'}</div>
      {hint && <div className="text-xs text-ink-400 mt-1">{hint}</div>}
    </div>
  )
}
