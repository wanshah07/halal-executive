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

// An image address for <img>. A Google Drive share link ("…/file/d/<id>/view",
// "open?id=<id>", "uc?id=<id>") is a web page, not a picture, so it is turned
// into Drive's own image address for the same file (the file must be shared
// "Anyone with the link"). Anything else goes through safeUrl unchanged.
export function imageUrl(u) {
  const s = safeUrl(u)
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/)
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600` : s
}
