// Every link or image address that comes from the Sheet passes through here.
// Text in the Sheet can come from a WhatsApp message via the AI, so a
// "javascript:" or "data:" link must never reach an href or src.
export function safeUrl(u, { allowHash = false } = {}) {
  const s = String(u || '').trim()
  if (!s) return ''
  if (allowHash && /^#[A-Za-z0-9_-]*$/.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (/^\.\/[A-Za-z0-9_./-]+$/.test(s)) return s
  return ''
}
