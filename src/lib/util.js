export const fmtDate = (iso, lang = 'en') => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return String(iso)
  return d.toLocaleDateString(lang === 'bm' ? 'ms-MY' : 'en-MY', { year: 'numeric', month: 'short', day: 'numeric' })
}
export const fmtDateTime = (iso, lang = 'en') => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return String(iso)
  return d.toLocaleString(lang === 'bm' ? 'ms-MY' : 'en-MY', { dateStyle: 'medium', timeStyle: 'short' })
}
export const hoursLeft = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 36e5))
export const daysAgo = (iso) => (Date.now() - Date.parse(iso)) / 864e5
export const count = (arr, key) => arr.reduce((m, x) => { const k = x[key] || '—'; m[k] = (m[k] || 0) + 1; return m }, {})
export const toCSV = (rows) => {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}
export const download = (name, text, type = 'text/csv') => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
}
