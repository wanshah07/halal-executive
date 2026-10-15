import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ICON, X, ExternalLink } from './Icon'

// A picture opened full size over the page: an FHCB or provider logo, a
// certificate preview. The whole picture fits the screen (never cropped);
// Esc, the X or a click outside closes it.
export default function Lightbox({ src, alt = '', href, onClose }) {
  useEffect(() => {
    if (!src) return
    const k = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k); const o = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', k); document.body.style.overflow = o }
  }, [src, onClose])
  if (!src) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
        <div className="absolute -top-11 right-0 flex gap-2">
          {href && <a className="btn px-2.5" href={href} target="_blank" rel="noreferrer" aria-label="Open original"><ExternalLink {...ICON} size={16} /></a>}
          <button className="btn px-2.5" onClick={onClose} aria-label="Close"><X {...ICON} size={16} /></button>
        </div>
        <img src={src} alt={alt} className="block mx-auto max-w-full max-h-[85vh] object-contain bg-white rounded-xl p-2 shadow-2xl" />
        {alt && <div className="mt-2 text-center text-sm text-white/90">{alt}</div>}
      </div>
    </div>, document.body)
}
