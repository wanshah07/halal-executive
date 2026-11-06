import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Header from './components/Header'
import Sidebar, { NAV } from './components/Sidebar'
import BottomNav from './components/BottomNav'
import SearchBar from './components/SearchBar'
import Chatbot from './components/Chatbot'
import { certStatus, splitProducts, filedDocs } from './lib/certs'
import { eventPast, vacancyOver } from './lib/util'
import { loadData, savedData, snapshotData, snapshotFresh, loadSettings, routeParts, withAnswers, loadAllAnswers, answersPending, wantEverything } from './lib/api'
// Admin upload queue: loaded with the app so it keeps sending on every page.
import './lib/uploadQueue'
import { t } from './lib/i18n'

// Every page, Overview too, loads on first visit (src/boot.js preloads the one
// a link opens on while this code downloads), so the first screen only
// downloads what it shows. After a new deploy, a page opened before it asks
// for file names that no longer exist: reload once to pick up the new ones
// instead of crashing to a blank screen.
const lazyPage = (load) => lazy(() => load().then((m) => { try { sessionStorage.removeItem('he:reloaded') } catch { /* ignore */ } return m }).catch((e) => {
  let again = false
  try { again = !sessionStorage.getItem('he:reloaded'); if (again) sessionStorage.setItem('he:reloaded', '1') } catch { /* ignore */ }
  if (again) { location.reload(); return new Promise(() => {}) }
  throw e
}))
const PAGES = {
  overview: () => import('./pages/Overview'),
  faq: () => import('./pages/FAQ'), certificates: () => import('./pages/Certificates'), guidelines: () => import('./pages/Guidelines'),
  references: () => import('./pages/References'), documents: () => import('./pages/Documents'), events: () => import('./pages/Events'),
  fhcb: () => import('./pages/Fhcb'), directory: () => import('./pages/Directory'), news: () => import('./pages/News'),
  vacancies: () => import('./pages/Vacancies'), admin: () => import('./pages/Admin'),
}
// The page a link opens on starts downloading now, beside the feed, instead of
// after the feed has arrived and the first render asks for it.
{ const first = PAGES[location.hash.replace('#', '').split('/')[0] || 'overview']; if (first) first().catch(() => {}) }
const Overview = lazyPage(PAGES.overview)
const FAQ = lazyPage(PAGES.faq)
const Certificates = lazyPage(PAGES.certificates)
const Guidelines = lazyPage(PAGES.guidelines)
const References = lazyPage(PAGES.references)
const Documents = lazyPage(PAGES.documents)
const Events = lazyPage(PAGES.events)
const Fhcb = lazyPage(PAGES.fhcb)
const Directory = lazyPage(PAGES.directory)
const News = lazyPage(PAGES.news)
const Vacancies = lazyPage(PAGES.vacancies)
const Admin = lazyPage(PAGES.admin)
const Notice = lazy(() => import('./components/Notice'))

// Any error inside a page shows a message and a Reload button instead of
// blanking the whole site.
class PageGuard extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidUpdate(prev) { if (prev.tab !== this.props.tab && this.state.err) this.setState({ err: null }) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="card p-6 text-sm">
        <div className="font-semibold mb-1">{t(this.props.lang, 'page_error')}</div>
        <button className="btn-brand mt-2" onClick={() => location.reload()}>{t(this.props.lang, 'refresh')}</button>
      </div>
    )
  }
}

// Drawn while a page's code or its part of the feed is on the way: the page's
// shape at once, so nothing jumps when the cards arrive.
function PageSkeleton({ lang }) {
  return (
    <div role="status" aria-live="polite" data-skeleton>
      <span className="sr-only">{t(lang, 'loading')}</span>
      <div className="h-7 w-48 mb-4 rounded bg-line/70 animate-pulse" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="card h-56 animate-pulse bg-paper" />)}
      </div>
    </div>
  )
}

const TABS = NAV.map(([k]) => k)
const fromHash = () => { const h = location.hash.replace('#', '').split('/')[0]; return TABS.includes(h) ? h : 'overview' }
const subFromHash = () => location.hash.replace('#', '').split('/')[1] || ''
const ls = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }

// Export columns per segment: the same fields the table view shows.
const EXPORT = (lang, data, fhcbRows) => ({
  faq: { title: t(lang, 'faq'), rows: data.faq || [], cols: ['id', 'category', 'subcategory', 'question_en', 'question_bm', 'answer_formal_en', 'answer_layman_en', 'answer_formal_bm', 'answer_layman_bm', 'confidence', 'status', 'updated_at', 'created_at', 'published_at'] },
  certificates: { title: t(lang, 'certificates'), rows: (data.certificates || []).map((c) => ({ ...c, validity: certStatus(c), products: splitProducts(c.products).join('; ') })), cols: ['id', 'validity', 'company', 'cert_no', 'scheme', 'category', 'state', 'valid_from', 'valid_to', 'products', 'drive_url', 'updated_at', 'created_at', 'published_at'] },
  guidelines: { title: t(lang, 'guidelines'), rows: data.guidelines || [], cols: ['id', 'category', 'title', 'title_bm', 'issuer', 'summary_en', 'summary_bm', 'link', 'effective_date', 'updated_at', 'created_at', 'published_at'] },
  documents: { title: t(lang, 'documents'), rows: filedDocs(data.documents), cols: ['id', 'status', 'title', 'kind', 'category', 'version', 'supersedes_id', 'received_at', 'updated_at', 'drive_url', 'published_at'] },
  events: { title: t(lang, 'events'), rows: data.events || [], cols: ['id', 'kind', 'title', 'title_bm', 'date_start', 'date_end', 'venue', 'link', 'description', 'created_at', 'published_at'] },
  fhcb: { title: t(lang, 'fhcb'), rows: fhcbRows(data), cols: ['id', 'no', 'country', 'name', 'kind', 'address', 'persons', 'tel', 'fax', 'email', 'website', 'source_ref', 'effective_date', 'updated_at'] },
  directory: { title: t(lang, 'directory'), rows: data.directory || [], cols: ['id', 'type', 'subtype', 'name', 'state', 'country', 'coverage', 'address', 'pic', 'phone', 'email', 'website', 'website2', 'accreditation', 'description', 'source_ref', 'updated_at'] },
  vacancies: { title: t(lang, 'vacancies'), rows: data.vacancies || [], cols: ['id', 'category', 'title', 'title_bm', 'employer', 'location', 'state', 'job_type', 'salary', 'requirements', 'description', 'apply_link', 'apply_email', 'apply_phone', 'closing_date', 'updated_at'] },
  news: { title: t(lang, 'news'), rows: data.news || [], cols: ['id', 'category', 'title', 'source', 'url', 'published_at', 'expires_at', 'summary_en', 'summary_bm'] },
})

export default function App() {
  const [lang, setLangState] = useState(() => ls('he:lang', 'en'))
  const setLang = (l) => { setLangState(l); try { localStorage.setItem('he:lang', l) } catch { /* ignore */ } }
  const [tab, setTabState] = useState(fromHash)
  const [focus, setFocus] = useState(null)
  const [sub, setSub] = useState(subFromHash)
  const [raw, setData] = useState(savedData)
  // FAQ answer texts of a split snapshot arrive in chunks (lib/api.js); every
  // page reads the rows with whatever has arrived filled in.
  const [ansVer, setAnsVer] = useState(0)
  useEffect(() => { const h = () => setAnsVer((v) => v + 1); addEventListener('he:answers', h); return () => removeEventListener('he:answers', h) }, [])
  const data = useMemo(() => withAnswers(raw), [raw, ansVer])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  // The popup reads the small settings request first (fresh colour and
  // posters); if neither it nor the full feed answers in 8 s, it uses the
  // saved copy.
  const [waited, setWaited] = useState(false)
  const [liveSettings, setLiveSettings] = useState(null)
  useEffect(() => {
    loadSettings().then((st) => st && setLiveSettings(st))
    const id = setTimeout(() => setWaited(true), 8000); return () => clearTimeout(id)
  }, [])
  // The FHCB seed (101 bodies, lib/fhcb.js) only feeds the sidebar count here:
  // it loads after the first screen instead of riding in the main bundle.
  const [fhcbLib, setFhcbLib] = useState(null)
  useEffect(() => { const id = setTimeout(() => import('./lib/fhcb').then(setFhcbLib).catch(() => {}), 1500); return () => clearTimeout(id) }, [])
  const [seed, setSeed] = useState(null)
  const [menu, setMenu] = useState(false)

  // 'directory/sertu' opens a sub-section; the hash keeps it so a link or a
  // reload lands on the same place.
  const setTab = (k, id) => { const [base, s2 = ''] = String(k).split('/'); setTabState(base); setSub(s2); setFocus(id ? { id, n: Date.now() } : null); if (location.hash !== `#${k}`) history.replaceState(null, '', `#${k}`); window.scrollTo({ top: 0 }) }
  useEffect(() => { const h = () => { setTabState(fromHash()); setSub(subFromHash()) }; addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])
  // Admin Delete / Hide: drop the row at once (lib/api.js dropLocal).
  useEffect(() => {
    const drop = (e) => { const { key, id } = e.detail; setData((d) => (d && Array.isArray(d[key]) ? { ...d, [key]: d[key].filter((r) => String(r.id) !== id) } : d)) }
    addEventListener('he:drop', drop)
    return () => removeEventListener('he:drop', drop)
  }, [])

  const retries = useRef(0)
  const refresh = useCallback(async (force) => {
    setLoading(true); setErr('')
    try {
      const d = await loadData({ force }); setData(d)
      // Google was busy and the saved copy is on screen: ask again in 30 s, up to 6 times.
      if (d._error && retries.current++ < 6) setTimeout(() => refresh(true), 30000); else if (!d._error) retries.current = 0
    } catch (e) { setErr(String(e.message || e)); if (retries.current++ < 6) setTimeout(() => refresh(true), 30000) } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    // A browser that has a saved copy asks the Sheet on every page load (the
    // saved copy shows meanwhile), so a change made in Admin (notice colour,
    // posters) shows on the next refresh on every device, not after the
    // 5-minute browser cache runs out.
    // A first visit shows the deploy's snapshot (data.json, next to the page)
    // and asks the Sheet only when that snapshot is missing or stale: both
    // are the same ~2 MB feed, and fetching them together (29 Oct 2026) made
    // every first visit download it twice and the slower connection pay for
    // it in time to first content.
    let on = true
    const boot = async () => {
      if (savedData()) { refresh(true); return }
      // Split snapshot (feed/, 6 Nov 2026, CLAUDE.md rule 55): the page is
      // drawn as soon as the core lands and each route waits only for its tabs;
      // a live copy that answered first is never replaced by the snapshot.
      const snap = await snapshotData(fromHash(), (d) => { if (on) setData((cur) => (cur && !cur._snapshot ? cur : d)) })
      if (!on) return
      if (snapshotFresh(snap)) setLoading(false); else refresh(true)
    }
    boot()
    const again = () => refresh(true)
    addEventListener('he:refresh', again)
    return () => { on = false; removeEventListener('he:refresh', again) }
  }, [refresh])

  const doExport = async (kind) => {
    if (!data) return
    const key = EXPORT(lang, data, () => [])[tab] ? tab : 'faq'
    // The FAQ export carries every answer text: fetch the chunks not here yet.
    const all = (await wantEverything(raw)) || raw
    if (key === 'faq') await loadAllAnswers(all)
    const { fhcbRows } = await import('./lib/fhcb')
    const { title, rows, cols } = EXPORT(lang, withAnswers(all), fhcbRows)[key]
    const columns = cols.map((c) => ({ key: c, label: t(lang, c) === c ? c.replace(/_/g, ' ') : t(lang, c) }))
    const ex = await import('./lib/export')
    if (kind === 'csv') ex.exportCSV(key, rows, columns)
    else if (kind === 'pdf') ex.exportPDF(key, title, rows, columns)
    else await ex.exportDOCX(key, title, rows, columns)
  }

  // Admin edits FAQ rows (ContentManager): fetch every answer text first.
  useEffect(() => { if (tab === 'admin' && raw) loadAllAnswers(raw) }, [tab, raw])

  if (!data) return <div className="p-8 text-ink-600">{err || t(lang, 'loading')}</div>
  const live = (n) => !n.expires_at || Date.parse(n.expires_at) > Date.now()
  // A part of the split snapshot not here yet: its count is left out and its
  // pages show a placeholder in place of an empty list. Admin also waits for
  // every FAQ answer text, so an edit never starts from a row without them.
  const missing = new Set(data._missing || [])
  const waiting = routeParts(tab, [...missing]).some((p) => missing.has(p)) || (tab === 'admin' && answersPending(data))
  const noticeSettings = (!data._stale ? data.settings : liveSettings || data.settings) || {}
  const n = (k, f) => (missing.has(k) ? undefined : f())
  const counts = { references: n('references', () => (data.references || []).length), faq: n('faq', () => (data.faq || []).length), certificates: n('certificates', () => (data.certificates || []).length), guidelines: n('guidelines', () => (data.guidelines || []).length), documents: n('documents', () => filedDocs(data.documents).filter((d) => d.status === 'current').length), events: n('events', () => (data.events || []).filter((e) => !eventPast(e)).length), fhcb: missing.has('fhcb') || !fhcbLib ? undefined : fhcbLib.fhcbRows(data).length || undefined, directory: n('directory', () => (data.directory || []).length || undefined), vacancies: n('vacancies', () => (data.vacancies || []).filter((v) => v.status !== 'hidden' && v.status !== 'draft' && !vacancyOver(v)).length), news: n('news', () => (data.news || []).filter(live).length) }

  return (
    <div className="min-h-screen">
      <Header lang={lang} setLang={setLang} tab={tab} sub={sub} setTab={setTab} onRefresh={() => refresh(true)} onExport={doExport} counts={counts} loading={loading} onMenu={() => setMenu(true)} />
      <Sidebar lang={lang} tab={tab} sub={sub} setTab={setTab} counts={counts} mobileOpen={menu} setMobileOpen={setMenu} />
      <BottomNav lang={lang} tab={tab} setTab={setTab} onMore={() => setMenu(true)} />
      <div className="min-h-[calc(100vh-118px)] flex flex-col xl:pl-[232px]">
        <main className="w-full flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {err && <div className="card p-3 mb-4 text-sm bg-red-50 border-red-200">{err}</div>}
          <div className="mb-6"><SearchBar lang={lang} data={data} onOpen={(type, id) => setTab(type, id)} onAsk={(q) => setSeed({ q, n: Date.now() })} /></div>
          {/* Every page but Overview opens on its toolbar, so the page name is
              the document's one h1 for screen readers and outlines; Overview's
              hero already carries a visible h1. */}
          {tab !== 'overview' && <h1 className="sr-only">{t(lang, tab)}</h1>}
          <PageGuard lang={lang} tab={tab}>
          <Suspense fallback={<PageSkeleton lang={lang} />}>
          {waiting && <PageSkeleton lang={lang} />}
          {!waiting && <>
          {tab === 'overview' && <Overview lang={lang} data={data} setTab={setTab} />}
          {tab === 'faq' && <FAQ lang={lang} data={data} sub={sub} focusId={focus && focus.id} focusKey={focus && focus.n} />}
          {tab === 'certificates' && <Certificates lang={lang} data={data} sub={sub} />}
          {tab === 'references' && <References lang={lang} data={data} />}
          {tab === 'guidelines' && <Guidelines lang={lang} data={data} sub={sub} />}
          {tab === 'documents' && <Documents lang={lang} data={data} sub={sub} />}
          {tab === 'events' && <Events lang={lang} data={data} sub={sub} />}
          {tab === 'fhcb' && <Fhcb lang={lang} data={data} focusId={focus && focus.id} focusKey={focus && focus.n} />}
          {tab === 'directory' && <Directory lang={lang} data={data} sub={sub} setTab={setTab} />}
          {tab === 'news' && <News lang={lang} data={data} sub={sub} />}
          {tab === 'vacancies' && <Vacancies lang={lang} data={data} sub={sub} />}
          {tab === 'admin' && <Admin lang={lang} data={data} onSaved={() => refresh(true)} />}
          </>}
          </Suspense>
          </PageGuard>
        </main>
        <footer className="border-t border-line bg-white">
          {/* right padding keeps the floating Assistant button off the text */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-24 sm:pb-5 sm:pr-48 text-xs text-ink-400">
            <p className="mb-3 text-ink-600 leading-relaxed"><b>{t(lang, 'disclaimer_title')}.</b> {t(lang, 'disclaimer_body')}</p>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div><span className="font-semibold text-ink-600">Malaysian Halal Practitioners Hub</span> · halalexecutive.kkmhalalconsultant.com · {t(lang, 'updated')} {new Date(data._fetched).toLocaleString()}</div>
              <div className="font-medium text-ink-600">{t(lang, 'developed')}</div>
            </div>
          </div>
        </footer>
      </div>
      {/* Opens on fresh settings only (a saved copy may hold an old colour or
          posters); if the Sheet does not answer, the saved copy is used. */}
      {/* Its code (and the motion library) loads only when a notice is switched on. */}
      {tab === 'overview' && String(noticeSettings.notice_enabled) === 'true' && <Suspense fallback={null}>
        <Notice lang={lang} settings={noticeSettings} active={!!liveSettings || !data._stale || !!err || !loading || waited} />
      </Suspense>}
      <Chatbot lang={lang} data={data} open={chatOpen} setOpen={setChatOpen} seed={seed} />
    </div>
  )
}
