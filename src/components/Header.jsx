import { useEffect, useRef, useState } from 'react'
import { SITE_NAME, SITE_SUB, SHEET_URL, DRIVE_FOLDER_URL } from '../lib/config'
import { t } from '../lib/i18n'
import { NAV } from './Sidebar'
import { IconBar, IconBarItem } from '@/components/ui/icon-bar'
import { ICON, Menu, ExternalLink, ChevronDown, RefreshCw, Lock } from './Icon'

export default function Header({ lang, setLang, tab, setTab, onRefresh, onExport, counts, loading, onMenu }) {
  const [exp, setExp] = useState(false)
  const ref = useRef(null)
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setExp(false) }; addEventListener('click', h); return () => removeEventListener('click', h) }, [])
  return (
    <header className="bg-white border-b border-line sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4 py-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button className="md:hidden btn px-2.5 shrink-0" onClick={onMenu} aria-label={t(lang, 'menu')}><Menu {...ICON} size={20} /></button>
            <a href="#overview" onClick={() => setTab('overview')} className="flex items-center gap-2 sm:gap-3 min-w-0">
              <img
                src="./brand/he-logo.png"
                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = './brand/halal-logo.svg' }}
                alt="Halal Executive logo"
                className="h-11 w-11 sm:h-12 sm:w-12 object-contain shrink-0"
              />
              <div className="min-w-0">
                {/* Phones: the name on two short lines so it never runs under the buttons */}
                <div className="sm:hidden text-[13px] font-bold tracking-wide leading-[1.1] uppercase"><div>Halal</div><div>Executive</div></div>
                <div className="hidden sm:block text-lg font-bold tracking-wide leading-tight uppercase truncate">{SITE_NAME}</div>
                <div className="text-xs text-ink-600 truncate hidden sm:block">{SITE_SUB}</div>
              </div>
            </a>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button className="btn px-2.5 sm:px-3.5" onClick={() => setLang(lang === 'en' ? 'bm' : 'en')} title="Language">{lang === 'en' ? 'BM' : 'EN'}</button>
            <a className="btn hidden md:inline-flex" href="#faq" onClick={() => setTab('faq')}>{t(lang, 'faq')}</a>
            {SHEET_URL && <a className="btn hidden md:inline-flex" href={SHEET_URL} target="_blank" rel="noreferrer">{t(lang, 'sheet')} <ExternalLink {...ICON} size={14} /></a>}
            {DRIVE_FOLDER_URL && <a className="btn hidden lg:inline-flex" href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">{t(lang, 'drive')} <ExternalLink {...ICON} size={14} /></a>}
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
        {/* Main navigation: IconBar (src/components/ui/icon-bar.tsx). The open
            tab shows its name; the others show it on hover or keyboard focus.
            Selected colour is the site green instead of the component's grey. */}
        <nav aria-label={t(lang, 'menu')} className="pb-3 -mx-1 px-1 overflow-x-auto">
          <IconBar value={tab} onValueChange={(v) => v && setTab(v)}
            className="flex-nowrap [--ic-accent:#d2efdf] [--ic-accent-foreground:#08542e] [--ic-muted:#f8fafc] [--ic-muted-foreground:#475569]">
            {NAV.map(([k, Icon]) => (
              <IconBarItem key={k} value={k} icon={Icon}
                label={t(lang, k) + (counts && counts[k] != null ? ` (${counts[k]})` : '')} />
            ))}
          </IconBar>
        </nav>
      </div>
    </header>
  )
}
