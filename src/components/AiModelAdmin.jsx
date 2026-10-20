import { useEffect, useState } from 'react'
import { adminPost } from '../lib/api'
import { t } from '../lib/i18n'
import { ICON, Sparkles, Check } from './Icon'

// Admin -> AI model (Wan, 18 Oct 2026): which AI answers and which model each
// one uses. Saved in the Sheet's Settings (llm_*), read by Code.gs for site
// questions and by pipeline/llm_router.py for everything the runs do. Test
// sends one real question to exactly the model shown, with no handover.
const NAMES = { AFIQ: 'Wanshah 1', MIRELD: 'Wanshah 2' }
const ORDER = ['AFIQ', 'MIRELD']
const FIELDS = [['model', 'ai_main_model'], ['fast', 'ai_fast_model']]
const SEES = 'vision' // third test per AI: can it read a picture?
const fill = (s, o) => Object.keys(o).reduce((a, k) => a.replace('{' + k + '}', o[k]), s)
const draftOf = (r) => ({ mode: r.mode || 'auto', strict: !!r.strict, model: { AFIQ: '', MIRELD: '', ...(r.model || {}) }, fast: { AFIQ: '', MIRELD: '', ...(r.fast || {}) }, keys: r.keys || {} })

export default function AiModelAdmin({ lang, embedded = false }) {
  const [cfg, setCfg] = useState(null)
  const [models, setModels] = useState(null)
  const [old, setOld] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [tests, setTests] = useState({})

  const load = () => {
    adminPost('llm_config').then((r) => setCfg(draftOf(r))).catch((e) => { if (/unknown action/i.test(e.message)) setOld(true); else setMsg(e.message) })
    adminPost('llm_models').then(setModels).catch(() => setModels({ providers: {} }))
  }
  useEffect(() => { load() }, [])

  const setTest = (k, v) => setTests((x) => ({ ...x, [k]: v }))
  async function runTest(n, f, value) {
    const k = n + ':' + f
    setTest(k, { run: true })
    try { const r = await adminPost('llm_test', { provider: n, model: value, fast: f === 'fast', vision: f === SEES }); setTest(k, r); return r }
    catch (e) { const r = { works: false, code: 'NO REPLY', why: 'network', error: e.message }; setTest(k, r); return r }
  }
  async function save() {
    setBusy(true); setMsg('')
    try {
      const r = await adminPost('llm_config_save', { mode: cfg.mode, strict: cfg.strict, model: cfg.model, fast: cfg.fast })
      const c = draftOf(r); setCfg(c); setTests({}); setMsg(t(lang, 'ai_verify'))
      // Prove what was just saved: every AI that can now be asked, main and quick model.
      const who = c.mode === 'auto' ? ORDER.filter((n) => c.keys[n]) : [c.mode]
      const jobs = who.flatMap((n) => FIELDS.map(([f]) => [n, f]))
      const res = await Promise.all(jobs.map(([n, f]) => runTest(n, f, c[f][n])))
      const bad = jobs.map(([n, f], k) => [n, f, res[k]]).filter((x) => !x[2].works).map(([n, f, r]) => `${NAMES[n]} ${t(lang, f === 'fast' ? 'ai_short_fast' : 'ai_short_main')}: ${r.code || 'ERROR'}`)
      setMsg(bad.length ? `${t(lang, 'ai_verified_bad')} (${bad.join('; ')})` : t(lang, 'ai_verified_ok'))
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const auto = (n, f) => { const p = models && models.providers && models.providers[n]; return p ? (f === 'fast' ? p.auto_fast : p.auto_main) : '' }
  const options = (n, f) => {
    const p = models && models.providers && models.providers[n], list = (p && p.models) || [], cur = cfg[f][n]
    return (
      <>
        <option value="">{auto(n, f) ? fill(t(lang, 'ai_auto_now'), { m: auto(n, f) }) : t(lang, 'ai_auto')}</option>
        {list.map((m) => <option key={m} value={m}>{m}</option>)}
        {cur && !list.includes(cur) && <option value={cur}>{list.length ? fill(t(lang, 'ai_not_offered'), { m: cur }) : cur}</option>}
      </>
    )
  }
  const result = (n, f) => {
    const r = tests[n + ':' + f]
    if (!r) return null
    if (r.run) return <span className="text-xs text-ink-400">{t(lang, 'ai_testing')}</span>
    return r.works
      ? <div className="text-xs"><span className="chip bg-brand-100 text-brand-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_active')}</span> <span className="text-brand-700">{fill(t(lang, 'ai_test_ok'), { m: r.model, s: (r.ms / 1000).toFixed(1), c: r.code || 'HTTP 200' })}{r.vision && r.text ? ` · “${r.text}”` : ''}</span></div>
      : <div className="text-xs space-y-0.5">
          <div><span className="chip bg-red-100 text-red-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_inactive')} · {r.code || 'ERROR'}</span> <span className="text-red-700">{why(r.why)}</span></div>
          {r.error && <div className="font-mono text-[11px] text-ink-400 break-words">{r.error}</div>}
        </div>
  }
  const why = (w) => { const k = 'ai_why_' + (w || 'other'); const v = t(lang, k); return v === k ? t(lang, 'ai_why_other') : v }

  return (
    <div className={embedded ? 'space-y-4 border-t border-line pt-5' : 'card p-5 mb-4 space-y-4'}>
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Sparkles {...ICON} size={17} />{t(lang, 'ai_model_title')}</h3>
        <p className="text-sm text-ink-600 mt-1">{t(lang, 'ai_model_sub')}</p>
      </div>
      {old && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{t(lang, 'ai_old_backend')}</p>}
      {!cfg && !old && !msg && <div className="text-sm text-ink-400">{t(lang, 'loading')}</div>}
      {cfg && (<>
        <fieldset>
          <legend className="label">{t(lang, 'ai_mode_label')}</legend>
          <div className="grid sm:grid-cols-3 gap-2">
            {['auto', ...ORDER].map((m) => {
              const off = m !== 'auto' && !cfg.keys[m]
              return (
                <label key={m} className={`flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer ${cfg.mode === m ? 'border-brand-500 bg-brand-50' : 'border-line'} ${off ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input type="radio" name="ai-mode" className="mt-0.5" checked={cfg.mode === m} disabled={off} onChange={() => setCfg({ ...cfg, mode: m })} />
                  <span><b>{m === 'auto' ? t(lang, 'ai_mode_auto') : `${NAMES[m]} (${m})`}</b>
                    <span className="block text-xs text-ink-600">{m === 'auto' ? t(lang, 'ai_mode_auto_sub') : off ? t(lang, 'ai_no_key') : t(lang, 'ai_mode_pin_sub')}</span></span>
                </label>
              )
            })}
          </div>
          <label className={`mt-2 flex items-center gap-2 text-sm ${cfg.mode === 'auto' ? 'opacity-50' : ''}`}>
            <input type="checkbox" checked={cfg.mode !== 'auto' && cfg.strict} disabled={cfg.mode === 'auto'} onChange={(e) => setCfg({ ...cfg, strict: e.target.checked })} />
            {t(lang, 'ai_strict')}
          </label>
        </fieldset>

        <div className="grid lg:grid-cols-2 gap-3">
          {ORDER.map((n) => {
            const p = models && models.providers && models.providers[n]
            return (
              <div key={n} className="rounded-xl border border-line p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold">{NAMES[n]}</span><span className="text-xs text-ink-400">{n}</span>
                  {cfg.mode === n && <span className="chip bg-brand-100 text-brand-700">{t(lang, 'ai_chosen')}</span>}
                  {!cfg.keys[n] && <span className="chip bg-red-100 text-red-700">{t(lang, 'ai_inactive')} · NO KEY</span>}
                  {cfg.keys[n] && p && (p.reachable
                    ? <span className="chip bg-brand-100 text-brand-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_gateway')} {t(lang, 'ai_active')} · HTTP {p.code || 200}</span>
                    : <span className="chip bg-red-100 text-red-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_gateway')} {t(lang, 'ai_inactive')} · {p.code || 'ERROR'}</span>)}
                </div>
                {cfg.keys[n] && p && !p.reachable && <p className="text-xs text-red-700">{why(p.why)}</p>}
                {FIELDS.map(([f, label]) => (
                  <div key={f}>
                    <label className="label" htmlFor={`ai-${n}-${f}`}>{t(lang, label)}</label>
                    <div className="flex gap-2">
                      <select id={`ai-${n}-${f}`} className="input" value={cfg[f][n]} disabled={!cfg.keys[n]} onChange={(e) => { setCfg({ ...cfg, [f]: { ...cfg[f], [n]: e.target.value } }); setTest(n + ':' + f, null) }}>{options(n, f)}</select>
                      <button type="button" className="btn shrink-0" disabled={!cfg.keys[n] || (tests[n + ':' + f] || {}).run} onClick={() => runTest(n, f, cfg[f][n])}>{t(lang, 'ai_test')}</button>
                    </div>
                    <div className="mt-1 min-h-4">{result(n, f)}</div>
                  </div>
                ))}
                <div>
                  <div className="label">{t(lang, 'ai_vision_test')}</div>
                  <div className="flex gap-2 items-center">
                    <button type="button" className="btn shrink-0" disabled={!cfg.keys[n] || (tests[n + ':' + SEES] || {}).run} onClick={() => runTest(n, SEES, cfg.model[n])}>{t(lang, 'ai_vision_btn')}</button>
                    <span className="text-xs text-ink-400">{t(lang, 'ai_vision_hint')}</span>
                  </div>
                  <div className="mt-1 min-h-4">{result(n, SEES)}</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-brand" disabled={busy} onClick={save}>{busy ? '…' : t(lang, 'ai_save')}</button>
          {msg && <span className="text-sm text-ink-600">{msg}</span>}
        </div>
      </>)}
      {!cfg && !old && msg && <div className="text-sm text-red-700 flex flex-wrap items-center gap-3">{msg}<button type="button" className="btn" onClick={() => { setMsg(''); load() }}>{t(lang, 'cf_check')}</button></div>}
    </div>
  )
}
