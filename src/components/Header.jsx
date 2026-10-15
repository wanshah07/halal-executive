import { useEffect, useRef, useState } from 'react'
import { SITE_NAME, SHEET_URL, DRIVE_FOLDER_URL, DIRECTORY_SECTIONS } from '../lib/config'
import NavHeader from '@/components/ui/nav-header'
import { t } from '../lib/i18n'
import { MENU } from './Sidebar'
import { IconBar, IconBarItem } from '@/components/ui/icon-bar'
import { ICON, Menu, ExternalLink, ChevronDown, RefreshCw, Lock } from './Icon'

export const dirSection = (s) => (s === 'sertu' || s === 'lab' ? s : 'training')
export default function Header({ lang, setLang, tab, sub, setTab, onRefresh, onExport, counts, loading, onMenu }) {
  const [exp, setExp] = useState(false)
  const ref = useRef(null)
  // The header never hides; its height (it grows with the Directory row) is
  // shared as --hh so the sidebar starts right under it.
  const head = useRef(null)
  useEffect(() => {
    const el = head.current; if (!el) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--hh', el.offsetHeight + 'px')); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setExp(false) }; addEventListener('click', h); return () => removeEventListener('click', h) }, [])
  return (
    <header ref={head} className="bg-white border-b border-line sticky top-0 z-30">
      {/* Centred over the same column as the page (right of the sidebar on
          tablets and desktops), so the header and the content line up. */}
      <div className="xl:pl-[232px]"><div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4 py-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button className="xl:hidden btn px-2.5 shrink-0" onClick={onMenu} aria-label={t(lang, 'menu')}><Menu {...ICON} size={20} /></button>
            <a href="#overview" onClick={() => setTab('overview')} className="flex items-center gap-2 sm:gap-3 min-w-0">
              <img
                src="./brand/he-logo.png"
                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = './brand/halal-logo.svg' }}
                alt="Halal Executive logo"
                className="h-11 w-11 sm:h-12 sm:w-12 object-contain shrink-0"
              />
              <div className="min-w-0">
                {/* Phones: the name on two short lines so it never runs under the buttons */}
                <div className="sm:hidden text-[12px] font-bold tracking-wide leading-[1.15] uppercase whitespace-nowrap"><div>Halal Executive</div><div>Hub</div></div>
                <div className="hidden sm:block text-lg font-bold tracking-wide leading-tight uppercase truncate">{SITE_NAME}</div>
              </div>
            </a>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button className="btn px-2.5 sm:px-3.5" onClick={() => setLang(lang === 'en' ? 'bm' : 'en')} title="Language">{lang === 'en' ? 'BM' : 'EN'}</button>
            <a className="btn hidden xl:inline-flex" href="#faq" onClick={() => setTab('faq')}>{t(lang, 'faq')}</a>
            {SHEET_URL && <a className="btn hidden xl:inline-flex" href={SHEET_URL} target="_blank" rel="noreferrer">{t(lang, 'sheet')} <ExternalLink {...ICON} size={14} /></a>}
            {DRIVE_FOLDER_URL && <a className="btn hidden 2xl:inline-flex" href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">{t(lang, 'drive')} <ExternalLink {...ICON} size={14} /></a>}
            <div className="relative hidden sm:block" ref={ref}>
              <button className="btn" onClick={() => setExp(!exp)}>{t(lang, 'export')} <ChevronDown {...ICON} size={16} /></button>
              {exp && (
                <div className="absolute right-0 mt-1 card shadow-lg py-1 w-36 z-40">
                  {['csv', 'pdf', 'docx'].map((k) => <button key={k} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-paper" onClick={() => { setExp(false); onExport(k) }}>{t(lang, 'export_' + k)}</button>)}
                </div>
              )}
            </div>
            <button className="btn px-2.5 sm:px-3.5" onClick={onRefresh} disabled={loading} aria-label={t(lang, 'refresh')} title={t(lang, 'refresh')}><RefreshCw {...ICON} size={17} className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">{t(lang, 'refresh')}</span></button>
            <a className="btn-dark px-2.5 sm:px-3.5" href="#admin" onClick={() => setTab('admin')} aria-label={t(lang, 'admin')} title={t(lang, 'admin')}><Lock {...ICON} size={17} /><span className="hidden sm:inline">{t(lang, 'admin')}</span></a>
          </div>
        </div>
        {/* Tablets and desktops: every tab by name, no icons, nothing hides;
            the nav-header pill marks the open tab (Wan, 15 Oct 2026). Admin
            is only the black button above. */}
        <nav aria-label={t(lang, 'menu')} className="hidden md:block pb-3 -mx-1 px-1 overflow-x-auto">
          <NavHeader items={MENU.map(([k]) => ({ value: k, label: t(lang, k) }))} value={tab} onChange={(k) => setTab(k)} />
        </nav>
        {/* Phones: IconBar (src/components/ui/icon-bar.tsx); the open tab shows its name. */}
        <nav aria-label={t(lang, 'menu')} className="md:hidden pb-3 -mx-1 px-1 overflow-x-auto">
          <IconBar value={tab} onValueChange={(v) => v && setTab(v)}
            className="flex-nowrap [--ic-accent:#d2efdf] [--ic-accent-foreground:#08542e] [--ic-muted:#f8fafc] [--ic-muted-foreground:#475569]">
            {MENU.map(([k, Icon]) => (
              <IconBarItem key={k} value={k} icon={Icon}
                label={t(lang, k) + (counts && counts[k] != null ? ` (${counts[k]})` : '')} />
            ))}
          </IconBar>
        </nav>
        {tab === 'directory' && (
          <nav aria-label={t(lang, 'directory')} className="flex gap-1.5 pb-3 -mt-1 overflow-x-auto">
            {DIRECTORY_SECTIONS.map((d) => {
              const on = dirSection(sub) === d.sub
              return (
                <a key={d.sub} href={`#directory/${d.sub}`} onClick={(e) => { e.preventDefault(); setTab(`directory/${d.sub}`) }} aria-current={on ? 'page' : undefined}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm whitespace-nowrap ${on ? 'bg-ink-900 text-white border-ink-900' : 'border-line text-ink-600 hover:bg-paper'}`}>
                  {d[lang] || d.en}{d.soon && <span className="rounded bg-gold-500 px-1.5 text-[10px] font-semibold uppercase text-white">{t(lang, 'soon')}</span>}
                </a>
              )
            })}
          </nav>
        )}
      </div></div>
    </header>
  )
}
