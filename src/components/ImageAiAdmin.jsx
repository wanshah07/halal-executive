import { useEffect, useState } from 'react'
import { adminPost } from '../lib/api'
import { t } from '../lib/i18n'
import { ICON, Sparkles, ExternalLink } from './Icon'

// Admin -> Wanshah 3 (Wan, 19 Oct 2026): the image expert, https://kiosapi.com/v1.
// It reads pictures (a certificate OCR could not read) and makes pictures. It is
// not in the text rotation of Wanshah 1 and 2. The key is the Script Property
// KIOS_API_KEY; this card shows whether it works, lets Wan pick the two models
// (the one that reads, the one that draws), tests each with one real call, and
// holds a small Image studio.
const fill = (s, o) => Object.keys(o).reduce((a, k) => a.replace('{' + k + '}', o[k]), s)
const SIZES = ['auto', '1024x1024', '1024x1536', '1536x1024', '512x512']

export default function ImageAiAdmin({ lang }) {
  const [cfg, setCfg] = useState(null)
  const [pick, setPick] = useState({ vision: '', image: '' })
  const [old, setOld] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [tests, setTests] = useState({})
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('auto')
  const [keep, setKeep] = useState(true)
  const [pic, setPic] = useState(null)
  const [making, setMaking] = useState(false)

  const load = (fresh) => adminPost('img_config', { fresh: !!fresh }).then((r) => { setCfg(r); setPick({ vision: r.vision || '', image: r.image || '' }) })
    .catch((e) => { if (/unknown action/i.test(e.message)) setOld(true); else setMsg(e.message) })
  useEffect(() => { load() }, [])

  async function runTest(kind) {
    setTests((x) => ({ ...x, [kind]: { run: true } }))
    try { const r = await adminPost('img_test', { kind, model: pick[kind] }); setTests((x) => ({ ...x, [kind]: r })) }
    catch (e) { setTests((x) => ({ ...x, [kind]: { works: false, code: 'NO REPLY', why: 'network', error: e.message } })) }
  }
  // One press, three real calls: reads a picture, writes (makes) a picture, and
  // reads and writes plain text. Each result shows under its own button.
  const [all, setAll] = useState(false)
  async function checkAll() {
    setAll(true)
    try { await Promise.all(['vision', 'image', 'text'].map((k) => runTest(k))) } finally { setAll(false) }
  }
  async function save() {
    setBusy(true); setMsg('')
    try { const r = await adminPost('img_config_save', pick); setCfg(r); setTests({}); setMsg(t(lang, 'img_saved')); runTest('vision') }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  async function make() {
    setMaking(true); setPic(null)
    try { setPic(await adminPost('image_generate', { prompt, size, keep, model: pick.image })) }
    catch (e) { setPic({ made: false, code: 'NO REPLY', why: 'network', error: e.message }) } finally { setMaking(false) }
  }

  const why = (w) => { const k = 'ai_why_' + (w || 'other'); const v = t(lang, k); return v === k ? t(lang, 'ai_why_other') : v }
  const options = (kind) => {
    const list = (cfg && (kind === 'image' ? cfg.image_models : cfg.vision_models)) || [], auto = cfg && (kind === 'image' ? cfg.auto_image : cfg.auto_vision), cur = pick[kind]
    return (
      <>
        <option value="">{auto ? fill(t(lang, 'ai_auto_now'), { m: auto }) : t(lang, 'ai_auto')}</option>
        {list.map((m) => <option key={m} value={m}>{m}</option>)}
        {cur && !list.includes(cur) && <option value={cur}>{list.length ? fill(t(lang, 'ai_not_offered'), { m: cur }) : cur}</option>}
      </>
    )
  }
  const result = (kind) => {
    const r = tests[kind]
    if (!r) return null
    if (r.run) return <span className="text-xs text-ink-400">{t(lang, 'ai_testing')}</span>
    return r.works
      ? <div className="text-xs"><span className="chip bg-brand-100 text-brand-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_active')}</span> <span className="text-brand-700">{fill(t(lang, 'ai_test_ok'), { m: r.model, s: (r.ms / 1000).toFixed(1), c: r.code || 'HTTP 200' })}{r.text ? ` · ${r.text}` : ''}</span></div>
      : <div className="text-xs space-y-0.5">
          <div><span className="chip bg-red-100 text-red-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_inactive')} · {r.code || 'ERROR'}</span> <span className="text-red-700">{why(r.why)}</span></div>
          {r.error && <div className="font-mono text-[11px] text-ink-400 break-words">{r.error}</div>}
        </div>
  }
  const row = (kind, label, hint) => (
    <div>
      <label className="label" htmlFor={`img-${kind}`}>{t(lang, label)}</label>
      <div className="flex gap-2">
        <select id={`img-${kind}`} className="input" value={pick[kind]} disabled={!cfg.key} onChange={(e) => { setPick({ ...pick, [kind]: e.target.value }); setTests((x) => ({ ...x, [kind]: null })) }}>{options(kind)}</select>
        <button type="button" className="btn shrink-0" disabled={!cfg.key || (tests[kind] || {}).run} onClick={() => runTest(kind)}>{t(lang, 'ai_test')}</button>
      </div>
      <p className="text-xs text-ink-400 mt-1">{t(lang, hint)}</p>
      <div className="mt-1 min-h-4">{result(kind)}</div>
    </div>
  )

  return (
    <div className="card p-5 mb-4 space-y-4">
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Sparkles {...ICON} size={17} />{t(lang, 'img_title')}</h3>
        <p className="text-sm text-ink-600 mt-1">{t(lang, 'img_sub')}</p>
      </div>
      {old && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{t(lang, 'ai_old_backend')}</p>}
      {!cfg && !old && !msg && <div className="text-sm text-ink-400">{t(lang, 'loading')}</div>}
      {cfg && (<>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold">{cfg.name}</span><span className="text-xs text-ink-400">KIOS · kiosapi.com</span>
          {!cfg.key && <span className="chip bg-red-100 text-red-700">{t(lang, 'ai_inactive')} · NO KEY</span>}
          {cfg.key && (cfg.reachable
            ? <span className="chip bg-brand-100 text-brand-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_gateway')} {t(lang, 'ai_active')} · HTTP {cfg.code || 200}</span>
            : <span className="chip bg-red-100 text-red-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_gateway')} {t(lang, 'ai_inactive')} · {cfg.code || 'ERROR'}</span>)}
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => load(true)}>{t(lang, 'cf_check')}</button>
        </div>
        {!cfg.key && <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">
          <b>{t(lang, 'img_setup_title')}</b>
          <ol className="list-decimal pl-5 mt-1 space-y-0.5">{['img_setup_1', 'img_setup_2', 'img_setup_3', 'img_setup_4'].map((k) => <li key={k}>{t(lang, k)}</li>)}</ol>
        </div>}
        {cfg.key && !cfg.reachable && <p className="text-xs text-red-700">{why(cfg.why)}{cfg.error ? ` (${cfg.error})` : ''}</p>}
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="rounded-xl border border-line p-4 space-y-3">{row('vision', 'img_vision_model', 'img_vision_hint')}</div>
          <div className="rounded-xl border border-line p-4 space-y-3">{row('image', 'img_image_model', 'img_image_hint')}</div>
        </div>
        <div className="rounded-xl border border-line p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <b className="text-sm">{t(lang, 'img_all_title')}</b>
            <button type="button" className="btn" disabled={!cfg.key || all} onClick={checkAll}>{all ? t(lang, 'ai_testing') : t(lang, 'img_all')}</button>
          </div>
          <p className="text-xs text-ink-400">{t(lang, 'img_text_hint')}</p>
          <div className="min-h-4">{result('text')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-brand" disabled={busy || !cfg.key} onClick={save}>{busy ? '…' : t(lang, 'ai_save')}</button>
          {msg && <span className="text-sm text-ink-600">{msg}</span>}
        </div>

        <div className="rounded-xl border border-line p-4 space-y-3">
          <div><h4 className="font-semibold">{t(lang, 'img_studio')}</h4><p className="text-xs text-ink-400">{t(lang, 'img_studio_sub')}</p></div>
          <textarea className="input min-h-20" value={prompt} maxLength={1500} onChange={(e) => setPrompt(e.target.value)} placeholder={t(lang, 'img_prompt_ph')} aria-label={t(lang, 'img_prompt')} />
          <div className="flex flex-wrap items-center gap-3">
            <select className="input w-auto" value={size} onChange={(e) => setSize(e.target.value)} aria-label={t(lang, 'img_size')}>{SIZES.map((s) => <option key={s} value={s}>{s === 'auto' ? t(lang, 'img_size_auto') : s}</option>)}</select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />{t(lang, 'img_keep')}</label>
            <button type="button" className="btn-brand" disabled={!cfg.key || making || prompt.trim().length < 3} onClick={make}>{making ? t(lang, 'img_making') : t(lang, 'img_make')}</button>
          </div>
          {pic && pic.made === false && <div className="text-xs space-y-0.5"><span className="chip bg-red-100 text-red-700"><span aria-hidden="true">●</span>&nbsp;{t(lang, 'ai_inactive')} · {pic.code || 'ERROR'}</span> <span className="text-red-700">{why(pic.why)}</span>{pic.error && <div className="font-mono text-[11px] text-ink-400 break-words">{pic.error}</div>}</div>}
          {pic && pic.made !== false && (
            <div className="space-y-2">
              {pic.data ? <img src={pic.data} alt={prompt.slice(0, 80)} className="max-h-96 rounded-lg border border-line bg-white" /> : <p className="text-sm text-ink-600">{t(lang, 'img_too_big')}</p>}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-ink-400">{pic.model} · {(pic.ms / 1000).toFixed(1)} s</span>
                {pic.data && <a className="btn px-2.5 py-1" href={pic.data} download={`halal-executive-${Date.now()}.${pic.mime === 'image/jpeg' ? 'jpg' : 'png'}`}>{t(lang, 'img_download')}</a>}
                {pic.drive_url && <a className="btn px-2.5 py-1" href={pic.drive_url} target="_blank" rel="noreferrer">{t(lang, 'img_in_drive')} <ExternalLink {...ICON} size={14} /></a>}
              </div>
              {pic.revised && <p className="text-xs text-ink-400">{pic.revised}</p>}
            </div>
          )}
        </div>
      </>)}
      {!cfg && !old && msg && <div className="text-sm text-red-700 flex flex-wrap items-center gap-3">{msg}<button type="button" className="btn" onClick={() => { setMsg(''); load() }}>{t(lang, 'cf_check')}</button></div>}
    </div>
  )
}
