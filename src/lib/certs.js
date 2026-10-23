// Certificate validity and product list, shared by the Certificates page,
// the Overview tiles and the export.
export const certStatus = (c) => {
  if (!c.valid_to) return c.status || 'valid'
  const d = (Date.parse(c.valid_to) - Date.now()) / 864e5
  return d < 0 ? 'expired' : d <= 90 ? 'expiring' : 'valid'
}
// A halal certificate keeps a Documents row only to hold its file in Drive.
// Readers meet it as a Halal Certificate (the Certificates page), never as a
// document, so every document list leaves these rows out (Wan, 18 Oct 2026).
export const isCertDoc = (d) => String((d && d.kind) || '').trim().toLowerCase() === 'certificate'
// An event poster or training flyer is an Event, never a document (Wan, 23 Oct
// 2026: "make sure event documents not listed in the documents segments"):
// kind poster/event/flyer, or a title the AI wrote as "Training Flyer – …",
// "Workshop Poster – …" and the like.
const POSTERISH = /\b(poster|flyer|brochure|pamphlet|leaflet)\b/i
export const isEventDoc = (d) => /^(poster|event|flyer)$/i.test(String((d && d.kind) || '').trim()) || POSTERISH.test(String((d && d.title) || ''))
export const filedDocs = (docs) => (docs || []).filter((d) => !isCertDoc(d) && !isEventDoc(d))
export const splitProducts = (p) => {
  if (!p) return []
  if (Array.isArray(p)) return p
  try { const j = JSON.parse(p); if (Array.isArray(j)) return j } catch { /* plain text */ }
  return String(p).split(/\s*[;\n]\s*/).filter(Boolean)
}
