import StatCard from '../components/StatCard'
import Bars from '../components/Bars'
import Hero from '../components/Hero'
import { CATEGORIES } from '../lib/config'
import { t } from '../lib/i18n'
import Pager from '../components/Pager'
import { count, daysAgo, fmtDateTime } from '../lib/util'
import { catChip } from '../components/CategoryFilter'
import { lazy, Suspense, useMemo, useState } from 'react'
import { monthlySeries } from '../lib/series'
import { guessState, guessCountry, countryCoords } from '../lib/config'
import { certStatus, filedDocs } from '../lib/certs'
import AiTeam from '../components/AiTeam'
import NewsCarousel from '../components/NewsCarousel'
import UpcomingEvents from '../components/UpcomingEvents'

// Leaflet and the chart library are the heaviest code on the page; they load
// after the sections above them are already on screen.
const MonthlyChart = lazy(() => import('../components/MonthlyChart'))
const MapPanel = lazy(() => import('../components/MapPanel'))
const Slot = ({ h = 'h-72' }) => <div className={`card ${h} animate-pulse bg-paper`} />

export default function Overview({ lang, data, setTab }) {
  const faq = data.faq || [], docs = filedDocs(data.documents), events = data.events || [], news = data.news || [], gl = data.guidelines || []
  // One dot per country that has a JAKIM-recognised foreign certification body.
  const globeMarkers = useMemo(() => {
    const n = {}; (data.fhcb || []).forEach((r) => { n[r.country] = (n[r.country] || 0) + 1 })
    return Object.entries(n).map(([c, k]) => { const ll = countryCoords(c); return ll && { location: ll, size: 0.03 + Math.min(k, 6) * 0.008 } }).filter(Boolean)
  }, [data.fhcb])
  const recent = faq.filter((f) => daysAgo(f.created_at) <= 7)
  const upcoming = events.filter((e) => Date.parse(e.date_end || e.date_start) >= Date.now())
  const byCat = count(faq, 'category')
  const bySource = (data.raw_stats && data.raw_stats.by_source) || {}
  const posters = (() => { try { return JSON.parse(data.settings.posters || '[]') } catch { return [] } })()
  const topics = Object.entries(count(faq, 'subcategory')).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const certs = data.certificates || []
  const monthly = monthlySeries(faq, 'created_at')
  // Map: Malaysian certificates and event venues by state; certificates from
  // abroad are counted by country beside it (they have no state to plot).
  const byState = {}, abroad = {}
  certs.forEach((c) => {
    const st = guessState(c.state) || guessState(c.company)
    if (st) byState[st] = (byState[st] || 0) + 1
    else { const k = guessCountry(`${c.state} ${c.company}`) || t(lang, 'other_country'); abroad[k] = (abroad[k] || 0) + 1 }
  })
  events.forEach((e) => { const st = guessState(e.venue); if (st) byState[st] = (byState[st] || 0) + 1 })
  const certStat = count(certs.map((c) => ({ s: certStatus(c) })), 's')

  // Newest FAQ first, 10 to a page (Wan, 14 Oct 2026).
  const PER = 10
  const sorted = [...faq].sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at))
  const pages = Math.max(1, Math.ceil(sorted.length / PER))
  const [pg, setPg] = useState(0)
  const page = Math.min(pg, pages - 1)
  const recentList = sorted.slice(page * PER, page * PER + PER)

  // Order (Wan, 14 Oct 2026): hero → recently added FAQ → news → upcoming
  // events with posters → map → overview figures and charts → AI team.
  return (
    <div>
      <Hero lang={lang} settings={data.settings || {}} markers={globeMarkers} />

      <section className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">{t(lang, 'recent_faq')}</h3><a href="#faq" onClick={() => setTab('faq')} className="text-sm text-brand-600 hover:underline">{t(lang, 'open_faq')}</a></div>
        {!faq.length && <div className="text-sm text-ink-400">{t(lang, 'no_data')}</div>}
        <ul className="divide-y divide-line">
          {recentList.map((f) => (
            <li key={f.id} className="py-2.5 flex gap-3 items-start">
              {catChip(f.category, lang)}
              <a href={`#faq`} onClick={(e) => { e.preventDefault(); setTab('faq', f.id) }} className="text-sm hover:underline min-w-0">{lang === 'bm' ? f.question_bm || f.question_en : f.question_en || f.question_bm}</a>
              <span className="ml-auto shrink-0 text-xs text-ink-400 hidden sm:inline">{fmtDateTime(f.updated_at || f.created_at, lang)}</span>
            </li>
          ))}
        </ul>
        <Pager lang={lang} page={page} pages={pages} onPage={setPg} label="FAQ pages" />
      </section>

      <NewsCarousel lang={lang} news={news} />

      <UpcomingEvents lang={lang} events={events} posters={posters} setTab={setTab} />

      <div className="mb-4"><Suspense fallback={<Slot />}><MapPanel lang={lang} byState={byState} abroad={abroad} /></Suspense></div>

      <section className="card p-5 mb-4">
        <div className="mb-4">
          <h2 className="text-xl font-bold">{t(lang, 'overview')}</h2>
          <p className="text-sm text-ink-600">{t(lang, 'updated')} {fmtDateTime(data._fetched, lang)} · {data._source === 'sample' ? 'sample data' : 'Google Sheet'}</p>
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 mb-4">
          <StatCard label={t(lang, 'total_faq')} value={faq.length} hint={`${gl.length} ${t(lang, 'guidelines').toLowerCase()}`} />
          <StatCard label={t(lang, 'last_7')} value={recent.length} tone="blue" hint="FAQ" />
          <StatCard label={t(lang, 'current_docs')} value={docs.filter((d) => d.status === 'current').length} tone="green" hint={t(lang, 'documents')} />
          <StatCard label={t(lang, 'archived_docs')} value={docs.filter((d) => d.status === 'archived').length} tone="grey" hint={t(lang, 'documents')} />
          <StatCard label={t(lang, 'upcoming')} value={upcoming.length} tone="amber" hint={t(lang, 'events')} />
          <StatCard label={t(lang, 'live_news')} value={news.length} tone="ink" hint="auto-expires" />
          <StatCard label={t(lang, 'certificates') + ' · ' + t(lang, 'valid')} value={certStat.valid || 0} tone="green" />
          <StatCard label={t(lang, 'expiring')} value={certStat.expiring || 0} tone="amber" />
          <StatCard label={t(lang, 'expired')} value={certStat.expired || 0} tone="red" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr] mb-4">
          <Suspense fallback={<Slot />}><MonthlyChart lang={lang} title={t(lang, 'per_month')} data={monthly} /></Suspense>
          <Bars lang={lang} title={t(lang, 'by_category')} rows={CATEGORIES.map((c) => ({ label: c[lang] || c.en, value: byCat[c.id] || 0, pct: faq.length ? Math.round(((byCat[c.id] || 0) / faq.length) * 100) : 0 }))} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Bars lang={lang} title={t(lang, 'by_source')} rows={['whatsapp', 'facebook', 'telegram', 'manual'].map((s) => ({ label: s === 'manual' ? t(lang, 'admin') : s, value: bySource[s] || 0 }))} />
          <div className="card p-5">
            <h3 className="font-semibold mb-3">{t(lang, 'top_topics')}</h3>
            {!topics.length && <div className="text-sm text-ink-400">{t(lang, 'no_data')}</div>}
            <div className="flex flex-wrap gap-2">{topics.map(([k, v]) => <span key={k} className="chip bg-paper border border-line">{k} <b className="ml-1">{v}</b></span>)}</div>
          </div>
          <div className="card p-5">
            <h3 className="font-semibold mb-3">{t(lang, 'collectors')}</h3>
            {['whatsapp', 'telegram', 'facebook'].map((s) => {
              const hb = (data.collectors || {})[s]
              const age = hb ? (Date.now() - Date.parse(hb.ts)) / 60000 : null
              const live = age != null && age < 15
              return <div key={s} className="flex items-center justify-between text-sm py-1"><span className="capitalize">{s}</span><span className={`chip ${live ? 'bg-brand-100 text-brand-700' : age != null ? 'bg-red-100 text-red-700' : 'bg-paper text-ink-400 border border-line'}`}>{live ? `● ${t(lang, 'live')}` : age != null ? `${t(lang, 'offline')} · ${Math.round(age)} min` : t(lang, 'not_started')}</span></div>
            })}
            <p className="text-xs text-ink-400 mt-2">{t(lang, 'collectors_hint')}</p>
          </div>
        </div>
      </section>

      <AiTeam lang={lang} runs={data.runs} sample={data.ai_status} compact />

      <p className="text-xs text-ink-400">{t(lang, 'sources_note')}</p>
    </div>
  )
}
