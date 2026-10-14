import { SITE_NAME, SITE_SUB, SHEET_URL, DRIVE_FOLDER_URL } from '../lib/config'
import { t } from '../lib/i18n'

const TABS = ['overview', 'faq', 'guidelines', 'documents', 'events', 'news', 'admin']

export default function Header({ lang, setLang, tab, setTab, onRefresh, onExport, counts, loading }) {
  return (
    <header className="bg-white border-b border-line sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between gap-4 py-3">
          <a href="#overview" onClick={() => setTab('overview')} className="flex items-center gap-3 min-w-0">
            <img
              src="/brand/jakim-halal-logo.png"
              onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/brand/halal-logo.svg' }}
              alt="Halal Malaysia logo"
              className="h-11 w-11 rounded-full object-contain bg-white ring-1 ring-line"
            />
            <div className="min-w-0">
              <div className="text-lg font-bold tracking-wide leading-tight uppercase">{SITE_NAME}</div>
              <div className="text-xs text-ink-600 truncate hidden sm:block">{SITE_SUB}</div>
            </div>
          </a>
          <div className="flex items-center gap-2 shrink-0">
            <button className="btn" onClick={() => setLang(lang === 'en' ? 'bm' : 'en')} title="Language">{lang === 'en' ? 'BM' : 'EN'}</button>
            <a className="btn hidden md:inline-flex" href="#faq" onClick={() => setTab('faq')}>{t(lang, 'faq')}</a>
            {SHEET_URL && <a className="btn hidden md:inline-flex" href={SHEET_URL} target="_blank" rel="noreferrer">{t(lang, 'sheet')} ↗</a>}
            {DRIVE_FOLDER_URL && <a className="btn hidden lg:inline-flex" href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">{t(lang, 'drive')} ↗</a>}
            <button className="btn hidden sm:inline-flex" onClick={onExport}>{t(lang, 'export')} ▾</button>
            <button className="btn" onClick={onRefresh} disabled={loading}>{loading ? '…' : '⟳'} {t(lang, 'refresh')}</button>
            <a className="btn-dark" href="#admin" onClick={() => setTab('admin')}>+ {t(lang, 'admin')}</a>
          </div>
        </div>
        <nav className="flex gap-6 overflow-x-auto -mb-px">
          {TABS.map((k) => (
            <a key={k} href={`#${k}`} onClick={() => setTab(k)} className={`tab ${tab === k ? 'tab-active' : ''}`}>
              {t(lang, k)}
              {counts && counts[k] != null && <span className="ml-1 text-ink-400">({counts[k]})</span>}
            </a>
          ))}
        </nav>
      </div>
    </header>
  )
}
