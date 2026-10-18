import { useEffect, useState } from 'react'
import { certThumb } from '../lib/api'
import { safeUrl } from '../lib/safe'
import { t } from '../lib/i18n'
import { ICON, FileText } from './Icon'
import Lightbox from './Lightbox'

// Thumbnail of a file Apps Script can preview: a certificate (id CERT-…) or a
// document (id DOC-…). Drive renders the preview and Apps Script reads it with
// the owner's rights, so the file itself is never made public. When there is no
// preview, because Drive has not made one yet or the file is gone, the card
// still gets a designed tile with the name and what it is, never a blank.
export default function FileThumb({ id, thumb, href, name, sub, altPrefix, logo = false, size = 'card', lang }) {
  const [src, setSrc] = useState(thumb || null)
  const [zoom, setZoom] = useState(false)
  useEffect(() => { let live = true; if (!thumb) certThumb(id).then((d) => live && d && setSrc(d)); return () => { live = false } }, [id, thumb])
  // Row (table): a fixed 96 x 128 tile the column can never squeeze. Card: the full width, tall enough to read.
  const box = size === 'card' ? 'w-full aspect-[3/4]' : 'w-24 h-32 min-w-24 max-w-none shrink-0'
  if (src) return (
    <>
      <button type="button" title={t(lang, 'view_larger')} onClick={() => setZoom(true)} className={`${box} block rounded-lg border border-line bg-white p-1 cursor-zoom-in hover:ring-2 hover:ring-brand-300`}>
        <img src={src} alt={`${altPrefix || ''} ${name || ''}`.trim()} loading="lazy" className="w-full h-full object-contain" />
      </button>
      <Lightbox src={zoom ? src : null} alt={name} href={safeUrl(href)} onClose={() => setZoom(false)} />
    </>
  )
  const row = size !== 'card'
  const tile = (
    <div className={`${box} rounded-lg border border-line bg-gradient-to-br from-brand-50 to-white flex flex-col items-center justify-center text-center gap-1.5 ${row ? 'p-1' : 'p-4'}`}>
      {logo ? <img src="./brand/jakim-halal-logo.png" alt="" className={row ? 'h-6 w-6 opacity-40' : 'h-14 w-14 opacity-40'} /> : <FileText {...ICON} size={row ? 22 : 40} className="text-brand-600/60" />}
      {!row && name && <div className="text-sm font-semibold leading-snug text-ink-900 line-clamp-4 break-words">{name}</div>}
      {!row && sub && <div className="text-xs text-ink-600 line-clamp-2 break-words">{sub}</div>}
      {!row && <span className="text-[11px] text-ink-400">{t(lang, 'no_preview')}</span>}
    </div>
  )
  return safeUrl(href) ? <a href={safeUrl(href)} target="_blank" rel="noreferrer" className="block" title="Drive ↗">{tile}</a> : tile
}
