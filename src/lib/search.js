// Small client-side search over every segment. Tokenises on word boundaries,
// scores by term hits weighted by field, and returns mixed results so one box
// covers FAQ, guidelines, references, certificates, documents, events and news.
import { filedDocs } from './certs'
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ')
const tokens = (s) => norm(s).split(/\s+/).filter((w) => w.length > 1)

export function buildIndex(data) {
  const docs = []
  const push = (type, id, title, body, extra = {}) => docs.push({ type, id, title: title || '', body: body || '', extra, _t: tokens(title), _b: tokens(body) })
  ;(data.faq || []).forEach((f) => push('faq', f.id, `${f.question_en} ${f.question_bm}`, `${f.answer_formal_en} ${f.answer_layman_en} ${f.answer_formal_bm} ${f.answer_layman_bm} ${f.category} ${f.subcategory}`, f))
  ;(data.guidelines || []).forEach((g) => push('guidelines', g.id, `${g.title} ${g.title_bm}`, `${g.summary_en} ${g.summary_bm} ${g.issuer} ${g.category}`, g))
  ;filedDocs(data.documents).forEach((d) => push('documents', d.id, d.title, `${d.kind} ${d.category} ${d.notes || ''}`, d))
  ;(data.events || []).forEach((e) => push('events', e.id, `${e.title} ${e.title_bm}`, `${e.description} ${e.venue}`, e))
  ;(data.certificates || []).forEach((c) => push('certificates', c.id, `${c.company} ${c.cert_no}`, `${c.scheme} ${c.category} ${c.state} ${c.products}`, c))
  ;(data.vacancies || []).forEach((v) => push('vacancies', v.id, `${v.title} ${v.title_bm || ''}`, `${v.employer || ''} ${v.location || ''} ${v.state || ''} ${v.job_type || ''} ${v.requirements || ''} ${v.description || ''}`, v))
  ;(data.news || []).forEach((n) => push('news', n.id, n.title, `${n.summary_en} ${n.summary_bm} ${n.source}`, n))
  ;(data.references || []).forEach((r) => push('references', r.id, `${r.title} ${r.edition || ''}`, `${r.summary_en || ''} ${r.summary_bm || ''} ${r.key_points || ''} ${r.issuer || ''}`, r))
  return docs
}

export function search(index, q, limit = 30) {
  const qs = tokens(q)
  if (!qs.length) return []
  const out = []
  for (const d of index) {
    let score = 0
    for (const w of qs) {
      if (d._t.some((t) => t.startsWith(w))) score += 3
      if (d._b.some((t) => t.startsWith(w))) score += 1
    }
    if (score) out.push({ ...d, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
