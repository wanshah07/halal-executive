import { useCallback, useEffect, useState } from 'react'
import Header from './components/Header'
import Sidebar, { NAV } from './components/Sidebar'
import Notice from './components/Notice'
import SearchBar from './components/SearchBar'
import Chatbot from './components/Chatbot'
import Overview from './pages/Overview'
import FAQ from './pages/FAQ'
import Certificates, { certStatus, splitProducts } from './pages/Certificates'
import Guidelines from './pages/Guidelines'
import Documents from './pages/Documents'
import Events from './pages/Events'
import News from './pages/News'
import Admin from './pages/Admin'
import { loadData } from './lib/api'
import { t } from './lib/i18n'

const TABS = NAV.map(([k]) => k)
const fromHash = () => { const h = location.hash.replace('#', '').split('/')[0]; return TABS.includes(h) ? h : 'overview' }
const ls = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }

// Export columns per segment: the same fields the table view shows.
const EXPORT = (lang, data) => ({
  faq: { title: t(lang, 'faq'), rows: data.faq || [], cols: ['id', 'category', 'subcategory', 'question_en', 'question_bm', 'answer_formal_en', 'answer_layman_en', 'answer_formal_bm', 'answer_layman_bm', 'confidence', 'status', 'updated_at'] },
  certificates: { title: t(lang, 'certificates'), rows: (data.certificates || []).map((c) => ({ ...c, validity: certStatus(c), products: splitProducts(c.products).join('; ') })), cols: ['id', 'validity', 'company', 'cert_no', 'scheme', 'category', 'state', 'valid_from', 'valid_to', 'products', 'drive_url', 'updated_at'] },
  guidelines: { title: t(lang, 'guidelines'), rows: data.guidelines || [], cols: ['id', 'category', 'title', 'title_bm', 'issuer', 'summary_en', 'summary_bm', 'link', 'effective_date', 'updated_at'] },
  documents: { title: t(lang, 'documents'), rows: data.documents || [], cols: ['id', 'status', 'title', 'kind', 'category', 'version', 'supersedes_id', 'received_at', 'updated_at', 'drive_url'] },
  events: { title: t(lang, 'events'), rows: data.events || [], cols: ['id', 'title', 'title_bm', 'date_start', 'date_end', 'venue', 'link', 'description'] },
  news: { title: t(lang, 'news'), rows: data.news || [], cols: ['id', 'category', 'title', 'source', 'url', 'published_at', 'expires_at', 'summary_en', 'summary_bm'] },
})

export default function App() {
  const [lang, setLangState] = useState(() => ls('he:lang', 'en'))
  const setLang = (l) => { setLangState(l); try { localStorage.setItem('he:lang', l) } catch { /* ignore */ } }
  const [tab, setTabState] = useState(fromHash)
  const [focus, setFocus] = useState(null)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [seed, setSeed] = useState(null)
  const [menu, setMenu] = useState(false)
  const [pinned, setPinnedState] = useState(() => ls('he:pin', '0') === '1')
  const setPinned = (v) => { setPinnedState(v); try { localStorage.setItem('he:pin', v ? '1' : '0') } catch { /* ignore */ } }

  const setTab = (k, id) => { setTabState(k); setFocus(id || null); if (location.hash !== `#${k}`) history.replaceState(null, '', `#${k}`); window.scrollTo({ top: 0 }) }
  useEffect(() => { const h = () => setTabState(fromHash()); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])

  const refresh = useCallback(async (force) => {
    setLoading(true); setErr('')
    try { setData(await loadData({ force })) } catch (e) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh(false) }, [refresh])

  const doExport = async (kind) => {
    if (!data) return
    const key = EXPORT(lang, data)[tab] ? tab : 'faq'
    const { title, rows, cols } = EXPORT(lang, data)[key]
    const columns = cols.map((c) => ({ key: c, label: t(lang, c) === c ? c.replace(/_/g, ' ') : t(lang, c) }))
    const ex = await import('./lib/export')
    if (kind === 'csv') ex.exportCSV(key, rows, columns)
    else if (kind === 'pdf') ex.exportPDF(key, title, rows, columns)
    else await ex.exportDOCX(key, title, rows, columns)
  }

  if (!data) return <div className="p-8 text-ink-600">{err || t(lang, 'loading')}</div>
  const live = (n) => !n.expires_at || Date.parse(n.expires_at) > Date.now()
  const counts = { faq: (data.faq || []).length, certificates: (data.certificates || []).length, guidelines: (data.guidelines || []).length, documents: (data.documents || []).filter((d) => d.status === 'current').length, events: (data.events || []).length, news: (data.news || []).filter(live).length }

  return (
    <div className="min-h-screen">
      <Header lang={lang} setLang={setLang} tab={tab} setTab={setTab} onRefresh={() => refresh(true)} onExport={doExport} counts={counts} loading={loading} onMenu={() => setMenu(true)} />
      <Sidebar lang={lang} tab={tab} setTab={setTab} counts={counts} mobileOpen={menu} setMobileOpen={setMenu} pinned={pinned} setPinned={setPinned} />
      <div className={`min-h-[calc(100vh-106px)] flex flex-col transition-[padding] duration-200 ${pinned ? 'md:pl-[232px]' : 'md:pl-14'}`}>
        <main className="w-full flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {err && <div className="card p-3 mb-4 text-sm bg-red-50 border-red-200">{err}</div>}
          <div className="mb-6"><SearchBar lang={lang} data={data} onOpen={(type, id) => setTab(type, id)} onAsk={(q) => setSeed({ q, n: Date.now() })} /></div>
          {tab === 'overview' && <Overview lang={lang} data={data} setTab={setTab} />}
          {tab === 'faq' && <FAQ lang={lang} data={data} focusId={focus} />}
          {tab === 'certificates' && <Certificates lang={lang} data={data} />}
          {tab === 'guidelines' && <Guidelines lang={lang} data={data} />}
          {tab === 'documents' && <Documents lang={lang} data={data} />}
          {tab === 'events' && <Events lang={lang} data={data} />}
          {tab === 'news' && <News lang={lang} data={data} />}
          {tab === 'admin' && <Admin lang={lang} data={data} onSaved={() => refresh(true)} />}
        </main>
        <footer className="border-t border-line bg-white">
          {/* right padding keeps the floating Assistant button off the text */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-24 sm:pb-5 sm:pr-48 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-ink-400">
            <div><span className="font-semibold text-ink-600">Halal Executive</span> · halalexecutive.kkmhalalconsultant.com · {t(lang, 'updated')} {new Date(data._fetched).toLocaleString()}</div>
            <div className="font-medium text-ink-600">{t(lang, 'developed')}</div>
          </div>
        </footer>
      </div>
      <Notice lang={lang} settings={data.settings || {}} />
      <Chatbot lang={lang} data={data} open={chatOpen} setOpen={setChatOpen} seed={seed} />
    </div>
  )
}
