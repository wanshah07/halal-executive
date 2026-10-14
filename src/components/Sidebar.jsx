import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { ICON, LayoutDashboard, MessagesSquare, Library, BadgeCheck, ScrollText, FolderOpen, CalendarDays, Newspaper, Settings, PanelLeftClose, PanelLeftOpen } from './Icon'

// Left rail that hides itself: 56 px of icons at rest, 232 px with labels
// while the pointer or keyboard focus is on it, and pinned open on request.
// On phones it is a drawer opened from the header's menu button.
export const NAV = [
  ['overview', LayoutDashboard], ['faq', MessagesSquare], ['references', Library], ['certificates', BadgeCheck], ['guidelines', ScrollText],
  ['documents', FolderOpen], ['events', CalendarDays], ['news', Newspaper], ['admin', Settings],
]

export default function Sidebar({ lang, tab, setTab, counts, mobileOpen, setMobileOpen, pinned, setPinned }) {
  const [hover, setHover] = useState(false)
  const open = pinned || hover
  useEffect(() => { setMobileOpen(false) }, [tab, setMobileOpen])
  const items = NAV.map(([k, Icon]) => (
    <a key={k} href={`#${k}`} onClick={() => setTab(k)} title={t(lang, k)}
      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition ${tab === k ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-paper hover:text-ink-900'}`}>
      <span className="w-6 flex justify-center shrink-0"><Icon {...ICON} size={19} /></span>
      <span className={`whitespace-nowrap overflow-hidden transition-all ${open || mobileOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>{t(lang, k)}{counts && counts[k] != null && <span className="ml-1 text-xs opacity-70">({counts[k]})</span>}</span>
    </a>
  ))
  return (
    <>
      <aside onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        className={`hidden md:flex fixed left-0 top-[117px] bottom-0 z-20 flex-col gap-1 border-r border-line bg-white p-2 transition-[width] duration-200 ${open ? 'w-[232px] shadow-lg' : 'w-14'}`}>
        {items}
        <button onClick={() => setPinned(!pinned)} title={t(lang, pinned ? 'unpin' : 'pin')} className="mt-auto flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-400 hover:bg-paper">
          <span className="w-6 flex justify-center">{pinned ? <PanelLeftClose {...ICON} /> : <PanelLeftOpen {...ICON} />}</span><span className={`whitespace-nowrap overflow-hidden ${open ? 'opacity-100' : 'opacity-0 w-0'}`}>{t(lang, pinned ? 'unpin' : 'pin')}</span>
        </button>
      </aside>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMobileOpen(false)}>
          <nav className="absolute left-0 top-0 bottom-0 w-64 bg-white p-3 flex flex-col gap-1 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold px-2 py-2">{t(lang, 'menu')}</div>{items}
          </nav>
        </div>
      )}
    </>
  )
}
