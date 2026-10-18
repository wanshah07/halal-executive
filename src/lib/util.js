// Every date on the site is Malaysia time, wherever the reader is.
const MYT = 'Asia/Kuala_Lumpur'
export const fmtDate = (iso, lang = 'en') => {
  if (!iso) return '—'
  // A bare year ("2020", or 2020 once the Sheet turns it into a number) is an
  // edition year, not a timestamp.
  if (/^\d{4}$/.test(String(iso).trim())) return String(iso).trim()
  const d = new Date(iso)
  if (isNaN(d)) return String(iso)
  return d.toLocaleDateString(lang === 'bm' ? 'ms-MY' : 'en-MY', { year: 'numeric', month: 'short', day: 'numeric', timeZone: MYT })
}
export const fmtDateTime = (iso, lang = 'en') => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return String(iso)
  // A date with no time (midnight Malaysia time) reads "21 Oct 2026", not "12:00 am".
  if (((d.getTime() / 60000 + 480) % 1440 + 1440) % 1440 === 0) return fmtDate(iso, lang)
  return d.toLocaleString(lang === 'bm' ? 'ms-MY' : 'en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: MYT })
}
export const hoursLeft = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 36e5))
export const daysAgo = (iso) => (Date.now() - Date.parse(iso)) / 864e5
export const count = (arr, key) => arr.reduce((m, x) => { const k = x[key] || '—'; m[k] = (m[k] || 0) + 1; return m }, {})
export const toCSV = (rows) => {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v) => { let c = String(v ?? ''); if (/^[=+\-@\t\r]/.test(c)) c = "'" + c; return `"${c.replace(/"/g, '""')}"` }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}
export const download = (name, text, type = 'text/csv') => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
}

// When a row was uploaded and when it was published (Wan, 18 Oct 2026). The
// Sheet now stamps both (created_at, published_at); rows from before that fall
// back to the best moment they carry: the file's received/added/fetched time,
// the time inside a hand-made id (EV-M261016011450 is 16 Oct 2026 01:14:50 MYT),
// then the last update.
const LIVE = ['published', 'current', 'indexed']
const idStamp = (r) => { const m = /-M?(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String((r && r.id) || '')); return m ? `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00` : '' }
export const uploadedAt = (r) => (r && (r.created_at || r.received_at || r.added_at || r.fetched_at || idStamp(r) || r.updated_at)) || ''
export const publishedAt = (r) => (r && (r.published_at || r.indexed_at || (LIVE.includes(r.status) ? r.updated_at || uploadedAt(r) : ''))) || ''
