import { useCallback, useEffect, useState } from 'react'
import Header from './components/Header'
import Notice from './components/Notice'
import SearchBar from './components/SearchBar'
import Chatbot from './components/Chatbot'
import Overview from './pages/Overview'
import FAQ from './pages/FAQ'
import Guidelines from './pages/Guidelines'
import Documents from './pages/Documents'
import Events from './pages/Events'
import News from './pages/News'
import Admin from './pages/Admin'
import { loadData } from './lib/api'
import { toCSV, download } from './lib/util'
import { t } from './lib/i18n'

const TABS = ['overview', 'faq', 'guidelines', 'documents', 'events', 'news', 'admin']
const fromHash = () => { const h = location.hash.replace('#', '').split('/')[0]; return TABS.includes(h) ? h : 'overview' }

export default function App() {
  const [lang, setLangState] = useState(() => { try { return localStorage.getItem('he:lang') || 'en' } catch { return 'en' } })
  const setLang = (l) => { setLangState(l); try { localStorage.setItem('he:lang', l) } catch { /* ignore */ } }
  const [tab, setTabState] = useState(fromHash)
  const [focus, setFocus] = useState(null)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [seed, setSeed] = useState(null)

  const setTab = (k, id) => { setTabState(k); setFocus(id || null); if (location.hash !== `#${k}`) history.replaceState(null, '', `#${k}`); window.scrollTo({ top: 0 }) }
  useEffect(() => { const h = () => setTabState(fromHash()); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])

  const refresh = useCallback(async (force) => {
    setLoading(true); setErr('')
    try { setData(await loadData({ force })) } catch (e) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh(false) }, [refresh])

  const exportCSV = () => {
    if (!data) return
    const key = tab === 'overview' || tab === 'admin' ? 'faq' : tab
    download(`halal-executive-${key}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(data[key] || []))
  }

  if (!data) return <div className="p-8 text-ink-600">{err || t(lang, 'loading')}</div>
  const counts = { faq: (data.faq || []).length, guidelines: (data.guidelines || []).length, documents: (data.documents || []).filter((d) => d.status === 'current').length, events: (data.events || []).length, news: (data.news || []).filter((n) => !n.expires_at || Date.parse(n.expires_at) > Date.now()).length }

  return (
    <div className="min-h-screen">
      <Header lang={lang} setLang={setLang} tab={tab} setTab={setTab} onRefresh={() => refresh(true)} onExport={exportCSV} counts={counts} loading={loading} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {err && <div className="card p-3 mb-4 text-sm bg-red-50 border-red-200">{err}</div>}
        <div className="mb-6"><SearchBar lang={lang} data={data} onOpen={(type, id) => setTab(type, id)} onAsk={(q) => setSeed({ q, n: Date.now() })} /></div>
        {tab === 'overview' && <Overview lang={lang} data={data} setTab={setTab} />}
        {tab === 'faq' && <FAQ lang={lang} data={data} focusId={focus} />}
        {tab === 'guidelines' && <Guidelines lang={lang} data={data} />}
        {tab === 'documents' && <Documents lang={lang} data={data} />}
        {tab === 'events' && <Events lang={lang} data={data} />}
        {tab === 'news' && <News lang={lang} data={data} />}
        {tab === 'admin' && <Admin lang={lang} data={data} onSaved={() => refresh(true)} />}
      </main>
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-8 text-xs text-ink-400">
        Halal Executive · halalexecutive.kkmhalalconsultant.com · {t(lang, 'updated')} {new Date(data._fetched).toLocaleString()}
      </footer>
      <Notice lang={lang} settings={data.settings || {}} />
      <Chatbot lang={lang} data={data} open={chatOpen} setOpen={setChatOpen} seed={seed} />
    </div>
  )
}
