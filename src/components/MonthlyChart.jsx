import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { CHART, CATEGORIES } from '../lib/config'
import { t } from '../lib/i18n'

// Stacked bars, one hue per category in fixed order (halal, food, cosmetic),
// 2 px surface gap between segments, rounded data-end on the top segment only,
// recessive grid, hover tooltip on every bar. Same form as "Complaints detected
// per month" on the KKM Complaints page.
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

const Tip = ({ active, payload, label, lang }) => {
  if (!active || !payload || !payload.length) return null
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold mb-1">{label} · {total}</div>
      {payload.map((p) => <div key={p.dataKey} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.fill }} />{(CATEGORIES.find((c) => c.id === p.dataKey) || {})[lang] || p.dataKey}<span className="ml-auto font-medium">{p.value}</span></div>)}
    </div>
  )
}

export default function MonthlyChart({ lang, title, data, dark = false }) {
  const c = dark ? CHART.dark : CHART.light
  const any = data.some((m) => m.total)
  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-3">{title}</h3>
      {!any && <div className="text-sm text-ink-400">{t(lang, 'nothing_in_range')}</div>}
      {any && (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.ink }} axisLine={{ stroke: c.grid }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: c.ink }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<Tip lang={lang} />} />
              <Legend content={() => <div className="flex justify-center gap-4 text-xs mt-1">{['halal', 'food', 'cosmetic'].map((k) => <span key={k} className="inline-flex items-center gap-1.5 text-ink-600"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c[k] }} />{(CATEGORIES.find((x) => x.id === k) || {})[lang] || k}</span>)}</div>} />
              <Bar dataKey="halal" stackId="a" fill={c.halal} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="food" stackId="a" fill={c.food} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="cosmetic" stackId="a" fill={c.cosmetic} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
