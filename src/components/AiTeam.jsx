import { useEffect, useState } from 'react'
import Robot3D from './Robot3D'
import { aiStatus } from '../lib/api'
import { API_URL } from '../lib/config'
import { t } from '../lib/i18n'
import { fmtDateTime } from '../lib/util'

// The two AI providers as their mascots, with the model each is running,
// whether its gateway answers right now, and when it last did real work.
// "Active" = answered within the last 3 hours; "Standby" = reachable but idle;
// "Offline" = the gateway did not answer the last check.
function stateOf(p) {
  if (!p || !p.key) return 'offline'
  if (!p.reachable) return 'offline'
  const last = Math.max(Date.parse(p.last_ok || 0) || 0, Date.parse(p.last_used || 0) || 0)
  return Date.now() - last < 3 * 3600e3 ? 'active' : 'standby'
}

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)

// compact = the public Overview: each robot with its name and status only. The
// full card (models, response time, average, answer rate, base URL) is in Admin.
export default function AiTeam({ lang, runs, sample, compact = false, embedded = false }) {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    if (!API_URL) { setSt(sample || null); return }
    const load = () => aiStatus().then((s) => live && setSt(s)).catch((e) => live && setErr(String(e.message || e)))
    load(); const id = setInterval(load, 5 * 60e3)
    return () => { live = false; clearInterval(id) }
  }, [])
  const fromRuns = (n) => (runs || []).find((r) => r.provider === n)
  const cards = [
    // Shown in priority order (Wan, 20 Oct 2026): Wanshah 1, then 3, then 2.
    { key: 'AFIQ', tone: 'afiq', name: 'Wanshah 1' },
    { key: 'KIOS', tone: 'kios', name: 'Wanshah 3', image: true },
    { key: 'MIRELD', tone: 'mireld', name: 'Wanshah 2' },
  ].filter((c) => c.key !== 'KIOS' || !st || !st.providers || st.providers.KIOS) // an older Code.gs has no Wanshah 3 yet
  return (
    <div className={embedded ? '' : 'card p-5 mb-4'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="font-semibold">{t(lang, 'ai_box')}</h3>
        <span className="text-xs text-ink-400">{st ? `${t(lang, 'checked')} ${fmtDateTime(st.checked_at, lang)}` : err ? err : t(lang, 'loading')}</span>
      </div>
      <div className={compact ? 'grid gap-4 grid-cols-1 min-[480px]:grid-cols-3' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}>
        {cards.map((c) => {
          const run = fromRuns(c.key)
          // Older Code.gs has no status route: judge from the pipeline's runs.
          const p = st && st.providers ? st.providers[c.key] : (run ? { key: true, reachable: true, model: run.model, last_used: run.ts } : null)
          const state = st && st.providers ? stateOf(p) : run ? stateOf(p) : 'standby'
          const chip = { active: 'bg-brand-100 text-brand-700', standby: 'bg-amber-100 text-amber-800', offline: 'bg-red-100 text-red-700' }[state]
          return (
            <div key={c.key} className={`flex ${compact ? 'flex-col items-center text-center' : 'flex-col sm:flex-row sm:items-center'} gap-3 sm:gap-4 rounded-xl border border-line p-4 bg-gradient-to-br from-paper to-white`}>
              <div className="shrink-0"><Robot3D tone={c.tone} state={state} size={compact ? 104 : 118} name={c.name} /></div>
              <div className="min-w-0 w-full sm:w-auto">
                <div className={`flex items-center gap-2 flex-wrap ${compact ? 'justify-center' : ''}`}><span className="text-lg font-bold">{c.name}</span><span className={`chip ${chip}`}><span aria-hidden="true">●</span>&nbsp;{t(lang, 'st_' + state)}{state === 'offline' && p && p.code ? ` · ${/^\d+$/.test(p.code) ? 'HTTP ' + p.code : p.code}` : ''}</span>{st && st.mode === c.key && <span className="chip bg-brand-100 text-brand-700">{t(lang, 'ai_chosen')}</span>}</div>
                <Caps lang={lang} c={c} p={p} state={state} center={compact} />
                {!compact && <div className="text-xs text-ink-400 mb-1">{c.key}</div>}
                {!compact && <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <dt className="text-ink-400">{t(lang, c.image ? 'img_reads' : 'model_used')}</dt><dd className="truncate font-medium">{(p && p.model) || (run && run.model) || '—'}</dd>
                  <dt className="text-ink-400">{t(lang, c.image ? 'img_makes' : 'fast_model')}</dt><dd className="truncate">{(p && p.fast_model) || '—'}</dd>
                  {p && p.last_model && p.last_model !== p.model && <><dt className="text-ink-400">{t(lang, 'ai_pinned_last')}</dt><dd className="truncate">{p.last_model}</dd></>}
                  <dt className="text-ink-400">{t(lang, 'last_work')}</dt><dd className="truncate">{p && (p.last_ok || p.last_used) ? fmtDateTime(p.last_ok || p.last_used, lang) : run ? fmtDateTime(run.ts, lang) : '—'}</dd>
                  <dt className="text-ink-400">{t(lang, 'sees_label')}</dt><dd>{p && p.sees === true ? <span className="text-brand-700 font-medium">{t(lang, 'sees_yes')}</span> : p && p.sees === false ? <span className="text-red-700 font-medium">{t(lang, 'sees_no')}</span> : <span className="text-ink-400">{t(lang, 'sees_untested')}</span>}</dd>
                  {p && p.ms != null && <><dt className="text-ink-400">{t(lang, 'response')}</dt><dd>{fmtMs(p.ms)}{p.host ? <span className="text-ink-400"> · {p.host}</span> : null}</dd></>}
                  {p && p.avg_ms != null && <><dt className="text-ink-400">{t(lang, 'resp_avg')}</dt><dd>{fmtMs(p.avg_ms)}{p.best_ms != null ? <span className="text-ink-400"> · {t(lang, 'resp_best')} {fmtMs(p.best_ms)}</span> : null}</dd></>}
                  {p && p.ok_rate != null && <><dt className="text-ink-400">{t(lang, 'resp_rate')}</dt><dd><span className={p.ok_rate >= 95 ? 'text-brand-700 font-medium' : p.ok_rate >= 80 ? 'text-amber-700 font-medium' : 'text-red-700 font-medium'}>{p.ok_rate}%</span> <span className="text-ink-400">({p.pings} {t(lang, 'resp_checks')})</span></dd></>}
                </dl>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// What each robot does, in one row (Wan, 20 Oct 2026: "read, write, read image").
// Wanshah 1 and 2 read and write text; reading a picture is shown only once the
// picture test has said so. Wanshah 3 reads pictures and writes (makes) them.
function Caps({ lang, c, p, state, center }) {
  const off = state === 'offline'
  const img = c.image ? !!(p && p.model) : p && p.sees
  const items = c.image
    ? [['cap_read_image', img], ['cap_make_image', !!(p && p.fast_model)]]
    : [['cap_read', true], ['cap_write', true], ['cap_read_image', img]]
  return (
    <div className={`flex flex-wrap gap-1 my-1 ${center ? 'justify-center' : ''}`}>
      {items.map(([k, on]) => {
        const cls = off ? 'bg-paper text-ink-400 border border-line' : on === true ? 'bg-brand-50 text-brand-700 border border-brand-100' : on === false ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-paper text-ink-600 border border-line'
        return <span key={k} className={`chip ${cls}`}>{on === true && !off ? '✓ ' : on === false && !off ? '✗ ' : ''}{t(lang, k)}{on == null && !off ? ' ?' : ''}</span>
      })}
    </div>
  )
}
