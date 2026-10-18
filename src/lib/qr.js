// Registration links printed as QR codes on posters (Wan, 18 Oct 2026). A model
// reading a poster's text never sees a QR code, so it is decoded here, in the
// browser, with jsQR. A picture is read from the file itself; a PDF or Office
// poster is read from the first-page preview Apps Script returns with it.
// Only http(s) addresses come out, like every other link on this site.
const MAX_SIDE = 2400

const cleanUrl = (raw) => {
  let u = String(raw || '').trim()
  if (/^www\.[^\s/]+\.[a-z]{2,}/i.test(u)) u = 'https://' + u
  return /^https?:\/\/[^\s<>"']+$/i.test(u) ? u.slice(0, 500) : ''
}

const toBlob = (src) => {
  if (typeof src !== 'string') return src
  const m = src.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!m) return null
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
  const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i)
  return new Blob([a], { type: m[1] || 'image/png' })
}

// Read the picture onto a canvas no bigger than MAX_SIDE. An SVG or a format
// the browser cannot draw (HEIC outside Safari) simply has no code to find.
async function draw(blob) {
  let bmp
  try { bmp = await createImageBitmap(blob) } catch { return null }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d', { willReadFrequently: true })
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h) // a transparent PNG is white paper
  x.drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close()
  return { c, x, w, h }
}

// Whole picture first, then overlapping tiles (a small code on a big poster),
// each also enlarged: jsQR wants a code at least ~100 px across.
export async function qrLinks(src) {
  const blob = toBlob(src); if (!blob) return []
  const { default: jsQR } = await import('jsqr')
  const pic = await draw(blob); if (!pic) return []
  const found = []
  const tryRegion = (sx, sy, sw, sh, scale) => {
    const w = Math.round(sw * scale), h = Math.round(sh * scale)
    if (w < 60 || h < 60 || w * h > 16e6) return false
    const t = document.createElement('canvas'); t.width = w; t.height = h
    const tx = t.getContext('2d', { willReadFrequently: true }); tx.imageSmoothingQuality = 'high'
    tx.drawImage(pic.c, sx, sy, sw, sh, 0, 0, w, h)
    const r = jsQR(tx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' })
    const u = r && cleanUrl(r.data)
    if (u && !found.includes(u)) { found.push(u); return true }
    return false
  }
  const { w, h } = pic
  if (tryRegion(0, 0, w, h, 1) || tryRegion(0, 0, w, h, 0.6)) return found
  for (const n of [2, 3, 4]) {
    const tw = Math.min(w, Math.round((w / n) * 1.5)), th = Math.min(h, Math.round((h / n) * 1.5))
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const sx = Math.min(Math.round((j * w) / n), w - tw), sy = Math.min(Math.round((i * h) / n), h - th)
      if (tryRegion(sx, sy, tw, th, 1) || tryRegion(sx, sy, tw, th, 2)) return found
    }
    await new Promise((r) => setTimeout(r)) // let the page breathe between rounds
  }
  return found
}
