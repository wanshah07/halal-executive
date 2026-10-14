import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'

// Popup notification controlled from the Admin panel (Settings tab:
// notice_enabled, notice_title, notice_body, notice_level, notice_until).
// Dismissal is remembered per notice text so an edited notice shows again.
export default function Notice({ lang, settings }) {
  const enabled = String(settings.notice_enabled) === 'true'
  const until = settings.notice_until ? Date.parse(settings.notice_until) : Infinity
  const key = 'he:notice:' + btoa(unescape(encodeURIComponent(`${settings.notice_title}|${settings.notice_body}`))).slice(0, 40)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let dismissed = false
    try { dismissed = localStorage.getItem(key) === '1' } catch { /* ignore */ }
    setOpen(enabled && Date.now() < until && !dismissed && !!(settings.notice_title || settings.notice_body))
  }, [enabled, until, key, settings.notice_title, settings.notice_body])
  if (!open) return null
  const tone = { info: 'bg-brand-600', warning: 'bg-amber-500', danger: 'bg-red-600' }[settings.notice_level] || 'bg-brand-600'
  const close = () => { try { localStorage.setItem(key, '1') } catch { /* ignore */ } setOpen(false) }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={close}>
      <div className="card max-w-md w-full overflow-hidden shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className={`${tone} text-white px-5 py-3 font-semibold flex justify-between items-center`}>
          <span>{settings.notice_title || t(lang, 'notice')}</span>
          <button onClick={close} aria-label="close" className="text-white/80 hover:text-white">✕</button>
        </div>
        <div className="p-5 text-sm whitespace-pre-wrap">{lang === 'bm' && settings.notice_body_bm ? settings.notice_body_bm : settings.notice_body}</div>
        <div className="px-5 pb-4 flex justify-end"><button className="btn" onClick={close}>{t(lang, 'dismiss')}</button></div>
      </div>
    </div>
  )
}
