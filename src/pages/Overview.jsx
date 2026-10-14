import { safeUrl } from '../lib/safe'
import StatCard from '../components/StatCard'
import Bars from '../components/Bars'
import Hero from '../components/Hero'
import { CATEGORIES } from '../lib/config'
import { t } from '../lib/i18n'
import { count, daysAgo, fmtDateTime } from '../lib/util'
import { catChip } from '../components/CategoryFilter'
import MonthlyChart, { monthlySeries } from '../components/MonthlyChart'
import MapPanel from '../components/MapPanel'
import { guessState } from '../lib/config'
import { certStatus } from './Certificates'
import AiTeam from '../components/AiTeam'
import NewsCarousel from '../components/NewsCarousel'
import UpcomingEvents from '../components/UpcomingEvents'

export default function Overview({ lang, data, setTab }) {
  const faq = data.faq || [], docs = data.documents || [], events = data.events || [], news = data.news || [], gl = data.guidelines || []
  const recent = faq.filter((f) => daysAgo(f.created_at) <= 7)
  const upcoming = events.filter((e) => Date.parse(e.date_end || e.date_start) >= Date.now())
  const byCat = count(faq, 'category')
  const bySource = (data.raw_stats && data.raw_stats.by_source) || {}
  const posters = (() => { try { return JSON.parse(data.settings.posters || '[]') } catch { return [] } })()
  const topics = Object.entries(count(faq, 'subcategory')).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const certs = data.certificates || []
  const monthly = monthlySeries(faq, 'created_at')
  const byState = {}
  const src = certs.length ? certs : events
  src.forEach((x) => { const st = x.state || guessState(x.venue || x.company); if (st) byState[st] = (byState[st] || 0) + 1 })
  const certStat = count(certs.map((c) => ({ s: certStatus(c) })), 's')

  return (
    <div>
      <Hero lang={lang} settings={data.settings || {}} />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold">{t(lang, 'overview')}</h2>
          <p className="text-sm text-ink-600">{t(lang, 'updated')} {fmtDateTime(data._fetched, lang)} · {data._source === 'sample' ? 'sample data' : 'Google Sheet'}</p>
        </div>
        <a href="#faq" onClick={() => setTab('faq')} className="btn">{t(lang, 'open_faq')}</a>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 mb-4">
        <StatCard label={t(lang, 'total_faq')} value={faq.length} hint={`${gl.length} ${t(lang, 'guidelines').toLowerCase()}`} />
        <StatCard label={t(lang, 'last_7')} value={recent.length} tone="blue" hint="FAQ" />
        <StatCard label={t(lang, 'current_docs')} value={docs.filter((d) => d.status === 'current').length} tone="green" hint={t(lang, 'documents')} />
        <StatCard label={t(lang, 'archived_docs')} value={docs.filter((d) => d.status === 'archived').length} tone="grey" hint={t(lang, 'documents')} />
        <StatCard label={t(lang, 'upcoming')} value={upcoming.length} tone="amber" hint={t(lang, 'events')} />
        <StatCard label={t(lang, 'live_news')} value={news.length} tone="ink" hint="auto-expires" />
      </div>

      <div className="grid gap-4 grid-cols-3 mb-4">
        <StatCard label={t(lang, 'certificates') + ' · ' + t(lang, 'valid')} value={certStat.valid || 0} tone="green" />
        <StatCard label={t(lang, 'expiring')} value={certStat.expiring || 0} tone="amber" />
        <StatCard label={t(lang, 'expired')} value={certStat.expired || 0} tone="red" />
      </div>

      <AiTeam lang={lang} runs={data.runs} sample={data.ai_status} />

      <NewsCarousel lang={lang} news={news} />

      <UpcomingEvents lang={lang} events={events} setTab={setTab} />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] mb-4">
        <MonthlyChart lang={lang} title={t(lang, 'per_month')} data={monthly} />
        <MapPanel lang={lang} byState={byState} />
      </div>



      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] mb-4">
        <div className="card p-5">
          <h3 className="font-semibold mb-3">{t(lang, 'recent_faq')}</h3>
          {!faq.length && <div className="text-sm text-ink-400">{t(lang, 'no_data')}</div>}
          <ul className="divide-y divide-line">
            {[...faq].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 6).map((f) => (
              <li key={f.id} className="py-2.5 flex gap-3 items-start">
                {catChip(f.category, lang)}
                <a href="#faq" onClick={() => setTab('faq', f.id)} className="text-sm hover:underline">{lang === 'bm' ? f.question_bm : f.question_en}</a>
              </li>
            ))}
          </ul>
        </div>
        <Bars lang={lang} title={t(lang, 'by_category')} rows={CATEGORIES.map((c) => ({ label: c[lang] || c.en, value: byCat[c.id] || 0, pct: faq.length ? Math.round(((byCat[c.id] || 0) / faq.length) * 100) : 0 }))} />
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <div className="space-y-4">
          <Bars lang={lang} title={t(lang, 'by_source')} rows={['whatsapp', 'facebook', 'telegram', 'manual'].map((s) => ({ label: s === 'manual' ? t(lang, 'admin') : s, value: bySource[s] || 0 }))} />
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
        <div className="card p-5">
          <h3 className="font-semibold mb-3">{t(lang, 'top_topics')}</h3>
          {!topics.length && <div className="text-sm text-ink-400">{t(lang, 'no_data')}</div>}
          <div className="flex flex-wrap gap-2">{topics.map(([k, v]) => <span key={k} className="chip bg-paper border border-line">{k} <b className="ml-1">{v}</b></span>)}</div>
        </div>
        <div className="card p-5">
          <h3 className="font-semibold mb-3">{t(lang, 'posters')}</h3>
          {!posters.length && <div className="text-sm text-ink-400">{t(lang, 'no_data')}</div>}
          <div className="grid grid-cols-2 gap-2">{posters.map((p, i) => <a key={i} href={safeUrl(p.link) || safeUrl(p.url) || undefined} target="_blank" rel="noreferrer"><img src={safeUrl(p.url)} alt={p.title || ''} className="rounded-lg border border-line object-cover aspect-[4/5]" /></a>)}</div>
        </div>
      </div>
      <p className="text-xs text-ink-400">{t(lang, 'sources_note')}</p>
    </div>
  )
}
