import { useState } from 'react'
import { t } from '../lib/i18n'
import { safeUrl } from '../lib/safe'
import { fmtDateTime } from '../lib/util'
import Poster from './Poster'
import { ICON, ArrowUpRight } from './Icon'

// One event, the same size and shape everywhere (Wan, 31 Oct 2026): a fixed poster frame
// (the whole poster fitted inside, never cropped), the date and the title (two lines at
// most), and the Register button always at the bottom, even when the event has no details
// or no link yet. The details (kind, venue, description) are hidden until the cursor is on
// the card; on a touch screen or with a keyboard the Details button opens them.
export default function EventCard({ lang, title, url, file, date, venue, description, link, chip, action, className = '' }) {
  const [open, setOpen] = useState(false)
  const fine = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const reg = safeUrl(link)
  return (
    <article className={`flex h-full flex-col overflow-hidden rounded-xl border border-line bg-white ${className}`}>
      <div className="relative aspect-[3/4] w-full bg-paper"
        onMouseEnter={fine ? () => setOpen(true) : undefined} onMouseLeave={fine ? () => setOpen(false) : undefined}
        onFocus={() => setOpen(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
        <Poster fill url={url} file={file} title={title} />
        <div aria-hidden={!open} className={`absolute inset-0 z-10 overflow-y-auto bg-ink-900/90 p-4 text-sm text-white transition duration-200 ${open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}>
          {chip && <div className="mb-2">{chip}</div>}
          {date && <div className="font-semibold">{date}</div>}
          {venue && <div className="mt-1 text-white/80">{venue}</div>}
          {description ? <p className="mt-3 whitespace-pre-line text-white/90 [overflow-wrap:anywhere]">{description}</p> : <p className="mt-3 text-white/60">{title}</p>}
          {safeUrl(file) && <a href={safeUrl(file)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 underline">{t(lang, 'ev_view')} <ArrowUpRight {...ICON} size={14} /></a>}
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="absolute right-2 top-2 z-20 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink-900 shadow transition hover:bg-white focus-visible:outline-2">
          {open ? t(lang, 'ev_hide') : t(lang, 'ev_details')}
        </button>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="line-clamp-1 text-xs text-ink-400">{date}{venue && ` · ${venue}`}</div>
        <h4 className="mt-1 min-h-[2.6rem] font-semibold leading-snug line-clamp-2">{title}</h4>
        <div className="mt-auto pt-3">
          {action || (reg
            ? <a className="btn-brand w-full justify-center" href={reg} target="_blank" rel="noreferrer">{t(lang, 'register')} <ArrowUpRight {...ICON} size={15} /></a>
            : <button type="button" disabled title={t(lang, 'ev_nolink')} className="btn w-full cursor-not-allowed justify-center opacity-50">{t(lang, 'register')}</button>)}
        </div>
      </div>
    </article>
  )
}

export const dateOf = (e, lang) => fmtDateTime(e.date_start, lang)
