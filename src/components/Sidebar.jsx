import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { DIRECTORY_SECTIONS, CATEGORIES, EVENT_KINDS } from '../lib/config'
import { ICON, LayoutDashboard, MessagesSquare, Library, BadgeCheck, ScrollText, FolderOpen, CalendarDays, Newspaper, Settings, Globe, MapPinned, Briefcase, ChevronDown } from './Icon'

// Left rail. On tablets and desktops it is always open with its labels (Wan,
// 15 Oct 2026: no hiding and unhiding there). On phones it is a drawer opened
// from the header's menu button.
export const NAV = [
  ['overview', LayoutDashboard], ['news', Newspaper], ['faq', MessagesSquare], ['references', Library], ['certificates', BadgeCheck], ['guidelines', ScrollText],
  ['fhcb', Globe], ['directory', MapPinned], ['vacancies', Briefcase], ['documents', FolderOpen], ['events', CalendarDays], ['admin', Settings],
]
// Header and sidebar list every page but Admin; Admin is the black button
// at the top right (Wan, 15 Oct 2026).
export const MENU = NAV.filter(([k]) => k !== 'admin')

// Sub-menus (Wan, 20 Oct 2026: "sidebar got subsidebar which autodrop"). Each
// opens #page/<sub>, which the page reads as its first filter. A sub-menu
// drops open by itself on the page you are on; clicking the title of the page
// you are on, or its arrow, folds and unfolds it (Wan, 20 Oct 2026).
const byCat = CATEGORIES.map((c) => ({ sub: c.id, en: c.en, bm: c.bm }))
export const SUBNAV = {
  faq: byCat, certificates: byCat, guidelines: byCat, vacancies: byCat, documents: byCat, news: byCat,
  events: EVENT_KINDS.map((k) => ({ sub: k.id, en: k.en, bm: k.bm })),
  directory: DIRECTORY_SECTIONS,
}
// The sub a page shows when its hash has none: Directory always opens on a section.
const current = (k, sub) => (k === 'directory' ? (sub === 'sertu' || sub === 'lab' ? sub : 'training') : sub || '')

export default function Sidebar({ lang, tab, sub, setTab, counts, mobileOpen, setMobileOpen }) {
  useEffect(() => { setMobileOpen(false) }, [tab, sub, setMobileOpen])
  // Which sub-menus are open. With a mouse every one opens while the cursor is on it and
  // folds when the cursor leaves (Wan, 31 Oct 2026: "all auto hide unhide when cursor
  // there"), the page you are on included. A touch screen has no cursor: there the page you
  // are on starts open and any can be toggled by its arrow.
  const [unfold, setUnfold] = useState({})
  const [hover, setHover] = useState(null)
  const timer = useRef(null)
  const canHover = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  useEffect(() => { if (!canHover) setUnfold((u) => ({ ...u, [tab]: true })) }, [tab, canHover])
  useEffect(() => () => clearTimeout(timer.current), [])
  const enter = (k) => { clearTimeout(timer.current); setHover(k) }
  const leave = (k) => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover((h) => (h === k ? null : h)), 180) }
  const items = MENU.map(([k, Icon]) => {
    const subs = SUBNAV[k], here = tab === k, open = !!subs && (canHover ? hover === k : (unfold[k] ?? here))
    const toggle = () => setUnfold((u) => ({ ...u, [k]: !open }))
    return (
      <div key={k} className="group" onMouseEnter={canHover && subs ? () => enter(k) : undefined} onMouseLeave={canHover && subs ? () => leave(k) : undefined}
        onFocus={canHover && subs ? () => enter(k) : undefined} onBlur={canHover && subs ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) leave(k) } : undefined}>
        <div className={`flex items-center rounded-lg transition ${here ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-paper hover:text-ink-900'}`}>
        <a href={`#${k}`} onClick={(e) => { e.preventDefault(); if (here && subs && !canHover) toggle(); else { setTab(k); if (!canHover) setUnfold((u) => ({ ...u, [k]: true })) } }} title={t(lang, k)} aria-current={here ? 'page' : undefined} aria-expanded={subs ? open : undefined}
          className="flex flex-1 min-w-0 items-center gap-3 px-2.5 py-2 text-sm font-medium">
          <span className="w-6 flex justify-center shrink-0"><Icon {...ICON} size={19} /></span>
          <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">{t(lang, k === 'certificates' ? 'nav_certs' : k)}{counts && counts[k] != null && <span className="ml-1 text-xs opacity-70">({counts[k]})</span>}</span>
        </a>
        {subs && <button type="button" onClick={toggle} aria-label={t(lang, k)} aria-expanded={open} className="shrink-0 px-2 py-2 rounded-lg"><ChevronDown {...ICON} size={15} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} /></button>}
        </div>
        {subs && (
          // grid-rows 0fr → 1fr animates to the list's own height, whatever it is.
          <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="ml-6 mt-0.5 mb-1 border-l border-line pl-2 flex flex-col gap-0.5">
                {k !== 'directory' && <SubLink lang={lang} href={`#${k}`} on={here && !current(k, sub)} onGo={() => setTab(k)} label={t(lang, 'sub_all')} />}
                {subs.map((d) => <SubLink key={d.sub} lang={lang} href={`#${k}/${d.sub}`} on={here && current(k, sub) === d.sub} onGo={() => setTab(`${k}/${d.sub}`)} label={d[lang] || d.en} soon={d.soon} />)}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  })
  return (
    <>
      <aside className="hidden xl:flex fixed left-0 top-[var(--hh,117px)] bottom-0 z-20 w-[232px] flex-col gap-1 border-r border-line bg-white p-2 overflow-y-auto">
        {items}
      </aside>
      {mobileOpen && (
        <div className="xl:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMobileOpen(false)}>
          <nav className="absolute left-0 top-0 bottom-0 w-64 bg-white p-3 flex flex-col gap-1 shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold px-2 py-2">{t(lang, 'menu')}</div>{items}
          </nav>
        </div>
      )}
    </>
  )
}

function SubLink({ lang, href, on, onGo, label, soon }) {
  return (
    <a href={href} onClick={(e) => { e.preventDefault(); onGo() }} tabIndex={0}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition ${on ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-ink-600 hover:bg-paper hover:text-ink-900'}`}>
      <span className="truncate">{label}</span>{soon && <span className="shrink-0 rounded bg-gold-500 px-1.5 text-[9px] font-semibold uppercase text-white">{t(lang, 'soon')}</span>}
    </a>
  )
}
