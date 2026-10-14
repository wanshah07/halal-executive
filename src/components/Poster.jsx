import { useState } from 'react'
import { safeUrl, imageUrl } from '../lib/safe'

// Formats Admin accepts for a poster. Drive turns a PDF, PowerPoint, Word or
// HEIC file into a preview image, so every one of them shows as a picture.
export const POSTER_ACCEPT = 'image/*,.heic,.heif,.pdf,.ppt,.pptx,.doc,.docx,application/pdf'
export const POSTER_MAX = 10 * 1024 * 1024

// Event poster (whole image, autofit), opening the original file (the full PDF
// or deck) when there is one. A preview Drive has not made yet, or a broken
// link, falls back to the title on the brand gradient.
export default function Poster({ url, file, title, className = '' }) {
  const [bad, setBad] = useState(false)
  const src = imageUrl(url), href = safeUrl(file) || src
  const fallback = <div className={`w-full aspect-[16/9] bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center text-white/80 text-sm font-semibold px-4 text-center ${className}`}>{title}</div>
  if (!src || bad) return fallback
  // The whole poster is shown, never cropped: natural height up to a limit,
  // centred on a soft background when it is taller than that.
  const img = <img src={src} alt={title || ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className={`block w-full h-auto max-h-[560px] object-contain bg-paper ${className}`} />
  return href ? <a href={href} target="_blank" rel="noreferrer" aria-label={title}>{img}</a> : img
}
