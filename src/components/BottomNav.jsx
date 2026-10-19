import { t } from '../lib/i18n'
import { ICON, LayoutDashboard, MessagesSquare, BadgeCheck, CalendarDays, Menu } from './Icon'

// Phones: a bottom tab bar, icon over a short label (Wan, 19 Oct 2026, same as
// KKM Complaints). Four pages and More, which opens the full menu drawer.
// Tablets and desktops keep the header tabs and the sidebar.
const TABS = [['overview', LayoutDashboard], ['faq', MessagesSquare], ['certificates', BadgeCheck, 'nav_certs'], ['events', CalendarDays]]

export default function BottomNav({ lang, tab, setTab, onMore }) {
  const inBar = TABS.some(([k]) => k === tab)
  const cell = (on) => `relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] leading-tight font-medium transition-colors ${on ? 'text-brand-700' : 'text-ink-600'}`
  const bar = (on) => <span aria-hidden className={`absolute top-0 h-[3px] w-8 rounded-b-full ${on ? 'bg-brand-600' : 'bg-transparent'}`} />
  return (
    <nav aria-label={t(lang, 'menu')} className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-line flex" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {TABS.map(([k, Icon, label]) => {
        const on = tab === k
        return (
          <button key={k} type="button" onClick={() => setTab(k)} aria-current={on ? 'page' : undefined} className={cell(on)}>
            {bar(on)}<Icon {...ICON} size={22} strokeWidth={on ? 2.25 : 1.75} /><span className="max-w-full truncate px-0.5">{t(lang, label || k)}</span>
          </button>
        )
      })}
      <button type="button" onClick={onMore} className={cell(!inBar)} aria-haspopup="dialog">
        {bar(!inBar)}<Menu {...ICON} size={22} strokeWidth={!inBar ? 2.25 : 1.75} /><span className="max-w-full truncate px-0.5">{t(lang, 'more')}</span>
      </button>
    </nav>
  )
}
