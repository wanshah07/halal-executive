import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, ChevronLeft, ChevronRight } from 'lucide-react'
import { AlertCard } from '@/components/ui/alert-card'
import { safeUrl, imageUrl } from '../lib/safe'
import { t } from '../lib/i18n'

// Popup notice, set in Admin → Notice (Settings tab: notice_enabled,
// notice_title(_bm), notice_body(_bm), notice_color, notice_button(_bm),
// notice_posters, notice_until). The card is the card-8 AlertCard; its
// background is the colour Admin picked and the text colour follows it for
// contrast. Posters added to the notice slide underneath the message, each
// shown whole (never cropped). It opens on the Overview page only and closes
// itself after 7 seconds (paused while the pointer or a finger is on it), or
// on a click (Wan, 15 Oct 2026). A click is remembered per notice content, so
// an edited notice shows again; a timed close is remembered for the visit.
const AUTO_MS = 7000
export const NOTICE_COLORS = ['#0b6b3a', '#08542e', '#0f172a', '#1e3a8a', '#7c2d12', '#b91c1c', '#c9a227', '#ffffff']
const LEVEL = { info: '#0b6b3a', warning: '#b45309', danger: '#b91c1c' }
export const textOn = (hex) => {
  const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{6})$/i)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16), lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return L > 0.45 ? '#0f172a' : '#ffffff'
}
export const parsePosters = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.filter((p) => safeUrl(p.url)) : [] } catch { return [] } }

function Slides({ posters, color }) {
  const [i, setI] = useState(0)
  const x0 = useRef(null)
  const n = posters.length
  if (!n) return null
  const go = (d) => setI((v) => (v + d + n) % n)
  const p = posters[i]
  const img = <img src={imageUrl(p.url)} alt={p.title || ''} referrerPolicy="no-referrer" className="block w-full h-auto max-h-[45vh] sm:max-h-[50vh] object-contain rounded-lg bg-white/95" />
  return (
    <div className="select-none" onTouchStart={(e) => { x0.current = e.touches[0].clientX }} onTouchEnd={(e) => { if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); x0.current = null }}>
      <div className="relative">
        {safeUrl(p.link) || safeUrl(p.file) ? <a href={safeUrl(p.link) || safeUrl(p.file)} target="_blank" rel="noreferrer">{img}</a> : img}
        {n > 1 && <>
          <button type="button" aria-label="Previous" onClick={() => go(-1)} className="absolute left-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/60"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="Next" onClick={() => go(1)} className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/60"><ChevronRight className="h-4 w-4" /></button>
        </>}
      </div>
      {p.title && <div className="mt-2 text-sm font-medium text-center">{p.title}</div>}
      {n > 1 && <div className="mt-2 flex justify-center gap-1.5">{posters.map((_, k) => <button key={k} type="button" aria-label={`Poster ${k + 1}`} onClick={() => setI(k)} className="h-2 rounded-full transition-all" style={{ width: k === i ? 18 : 8, background: color, opacity: k === i ? 1 : 0.45 }} />)}</div>}
    </div>
  )
}

export default function Notice({ lang, settings, preview, onClose, active = true }) {
  const enabled = preview || String(settings.notice_enabled) === 'true'
  const until = settings.notice_until ? Date.parse(settings.notice_until) : Infinity
  const posters = parsePosters(settings.notice_posters)
  const title = (lang === 'bm' && settings.notice_title_bm) || settings.notice_title || t(lang, 'notice')
  const body = (lang === 'bm' && settings.notice_body_bm) || settings.notice_body || ''
  const bg = /^#[0-9a-f]{6}$/i.test(settings.notice_color || '') ? settings.notice_color : (LEVEL[settings.notice_level] || LEVEL.info)
  const fg = textOn(bg)
  const button = (lang === 'bm' && settings.notice_button_bm) || settings.notice_button || t(lang, 'notice_ok')
  const key = 'he:notice:' + btoa(unescape(encodeURIComponent(`${settings.notice_title}|${settings.notice_body}|${settings.notice_posters || ''}`))).slice(-48)
  const [open, setOpen] = useState(false)
  const [hold, setHold] = useState(false)
  const [left, setLeft] = useState(AUTO_MS)
  useEffect(() => {
    if (preview) { setOpen(true); setLeft(AUTO_MS); return }
    let dismissed = false
    try { dismissed = localStorage.getItem(key) === '1' || sessionStorage.getItem(key) === '1' } catch { /* ignore */ }
    const ok = active && enabled && Date.now() < until && !dismissed && !!(settings.notice_title || body || posters.length)
    // A moment after the page appears, so the card animates in over it.
    const id = ok ? setTimeout(() => { setLeft(AUTO_MS); setOpen(true) }, 600) : null
    if (!ok) setOpen(false)
    return () => clearTimeout(id)
  }, [enabled, until, key, preview, active]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = (byClick = true) => {
    if (!preview) { try { (byClick ? localStorage : sessionStorage).setItem(key, '1') } catch { /* ignore */ } }
    setOpen(false); onClose && onClose()
  }
  // 7-second countdown, paused while held.
  useEffect(() => {
    if (!open || hold) return
    const step = 100, id = setInterval(() => setLeft((v) => { if (v <= step) { clearInterval(id); setTimeout(() => close(false), 0); return 0 } return v - step }), step)
    return () => clearInterval(id)
  }, [open, hold]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return null
  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 transition-colors ${open ? 'bg-black/40' : 'pointer-events-none bg-transparent'}`} onClick={() => close(true)}>
      <AlertCard onClick={(e) => e.stopPropagation()} isVisible={open} title={title} description={body} buttonText={button}
        onButtonClick={() => close(true)} onDismiss={() => close(true)} background={bg} foreground={fg}
        onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onTouchStart={() => setHold(true)} onTouchEnd={() => setHold(false)}
        icon={<Bell className="h-6 w-6" style={{ color: fg }} />}>
        {posters.length > 0 && <Slides posters={posters} color={fg} />}
        <div className="mt-4 flex items-center gap-2 text-[11px]" style={{ opacity: 0.8 }} aria-hidden>
          <div className="h-1 flex-1 rounded-full overflow-hidden" style={{ background: fg + '33' }}><div className="h-full rounded-full" style={{ width: `${(left / AUTO_MS) * 100}%`, background: fg, transition: 'width 100ms linear' }} /></div>
          <span>{hold ? t(lang, 'notice_paused') : `${Math.ceil(left / 1000)}s`}</span>
        </div>
      </AlertCard>
    </div>, document.body)
}
