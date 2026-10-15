import { useEffect } from 'react'
import { t } from '../lib/i18n'
import { DIRECTORY_SECTIONS } from '../lib/config'
import { ICON, LayoutDashboard, MessagesSquare, Library, BadgeCheck, ScrollText, FolderOpen, CalendarDays, Newspaper, Settings, Globe, MapPinned } from './Icon'

// Left rail. On tablets and desktops it is always open with its labels (Wan,
// 15 Oct 2026: no hiding and unhiding there). On phones it is a drawer opened
// from the header's menu button.
export const NAV = [
  ['overview', LayoutDashboard], ['faq', MessagesSquare], ['references', Library], ['certificates', BadgeCheck], ['guidelines', ScrollText],
  ['fhcb', Globe], ['directory', MapPinned], ['documents', FolderOpen], ['events', CalendarDays], ['news', Newspaper], ['admin', Settings],
]
// Header and sidebar list every page but Admin; Admin is the black button
// at the top right (Wan, 15 Oct 2026).
export const MENU = NAV.filter(([k]) => k !== 'admin')

export default function Sidebar({ lang, tab, sub, setTab, counts, mobileOpen, setMobileOpen }) {
  const open = true
  useEffect(() => { setMobileOpen(false) }, [tab, sub, setMobileOpen])
  const items = MENU.flatMap(([k, Icon]) => [(
    <a key={k} href={`#${k}`} onClick={(e) => { e.preventDefault(); setTab(k) }} title={t(lang, k)}
      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition ${tab === k ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-paper hover:text-ink-900'}`}>
      <span className="w-6 flex justify-center shrink-0"><Icon {...ICON} size={19} /></span>
      <span className={`whitespace-nowrap overflow-hidden transition-all ${open || mobileOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>{t(lang, k)}{counts && counts[k] != null && <span className="ml-1 text-xs opacity-70">({counts[k]})</span>}</span>
    </a>),
    // Directory's sub-sections sit under it, always listed.
    ...(k === 'directory' ? DIRECTORY_SECTIONS.map((d) => {
      const on = tab === 'directory' && (sub === 'sertu' || sub === 'lab' ? sub : 'training') === d.sub
      return (
        <a key={'dir-' + d.sub} href={`#directory/${d.sub}`} onClick={(e) => { e.preventDefault(); setTab(`directory/${d.sub}`) }}
          className={`ml-9 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition ${on ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink-600 hover:bg-paper'}`}>
          <span className="truncate">{d[lang] || d.en}</span>{d.soon && <span className="shrink-0 rounded bg-gold-500 px-1.5 text-[9px] font-semibold uppercase text-white">{t(lang, 'soon')}</span>}
        </a>
      )
    }) : []),
  ])
  return (
    <>
      <aside className="hidden xl:flex fixed left-0 top-[var(--hh,117px)] bottom-0 z-20 w-[232px] flex-col gap-1 border-r border-line bg-white p-2 overflow-y-auto">
        {items}
      </aside>
      {mobileOpen && (
        <div className="xl:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMobileOpen(false)}>
          <nav className="absolute left-0 top-0 bottom-0 w-64 bg-white p-3 flex flex-col gap-1 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold px-2 py-2">{t(lang, 'menu')}</div>{items}
          </nav>
        </div>
      )}
    </>
  )
}
