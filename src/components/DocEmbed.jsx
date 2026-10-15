import { useState } from 'react'
import { safeUrl } from '../lib/safe'
import { t } from '../lib/i18n'
import { ICON, FileText, ExternalLink, ChevronDown, ChevronRight } from './Icon'

// A document kept in Drive (the FHCB list, a JAKIM circular) shown in place:
// a row with its title and a Drive preview that opens underneath on request.
// Drive's own viewer is embedded (frame-src allows drive.google.com only), so
// the file must be shared "Anyone with the link" (Code.gs does that on upload).
export const driveId = (u) => { const m = String(u || '').match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/); return m ? m[1] : '' }
export default function DocEmbed({ lang, doc, open: start = false }) {
  const [open, setOpen] = useState(start)
  const id = driveId(doc.drive_url), href = safeUrl(doc.drive_url)
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm bg-paper">
        <FileText {...ICON} size={16} className="text-brand-600 shrink-0" />
        <span className="font-medium min-w-0 flex-1 break-words">{doc.title}</span>
        {doc.received_at && <span className="text-xs text-ink-400">{String(doc.received_at).slice(0, 10)}</span>}
        {id && <button type="button" className="btn px-2.5 py-1" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown {...ICON} size={15} /> : <ChevronRight {...ICON} size={15} />}{t(lang, open ? 'doc_close' : 'doc_view')}</button>}
        {href && <a className="btn px-2.5 py-1" href={href} target="_blank" rel="noreferrer">{t(lang, 'open')} <ExternalLink {...ICON} size={14} /></a>}
      </div>
      {open && id && <iframe title={doc.title} src={`https://drive.google.com/file/d/${id}/preview`} className="w-full h-[60vh] sm:h-[70vh] bg-white" allow="autoplay" loading="lazy" />}
    </div>
  )
}
