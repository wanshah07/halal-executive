// Last 12 months, one row per month, counts split by category.
export function monthlySeries(rows, dateKey, months = 12) {
  const out = []
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-MY', { month: 'short', year: '2-digit' }), halal: 0, food: 0, cosmetic: 0, total: 0 })
  }
  const idx = Object.fromEntries(out.map((m, i) => [m.key, i]))
  for (const r of rows) {
    const d = new Date(r[dateKey]); if (isNaN(d)) continue
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (idx[k] == null) continue
    const c = ['halal', 'food', 'cosmetic'].includes(r.category) ? r.category : 'halal'
    out[idx[k]][c]++; out[idx[k]].total++
  }
  return out
}
