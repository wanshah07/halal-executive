import { useState } from 'react'
import { adminPost } from '../lib/api'
import { t } from '../lib/i18n'
import { ICON, Sparkles } from './Icon'

// "Make one with Wanshah 3" beside every poster upload (Wan, 19 Oct 2026:
// connect the image expert to the segments that actually use pictures).
//
// It adds NO new server action, and that is the point. image_generate already
// hands the picture back as a data URI, and poster_upload already takes base64,
// so a generated poster reaches Drive by exactly the route an uploaded one
// does and is the same kind of thing afterwards: same folder, same url, same
// poster_file, same thumbnail, same purge rules. A second upload path would
// have been a second set of rules to keep in step.
//
// Portrait by default because a poster is portrait; the notice slider asks for
// a square instead.
export default function PosterGen({ lang, size = '1024x1536', onDone, disabled, title }) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    setBusy(true); setErr('')
    try {
      const g = await adminPost('image_generate', { prompt, size, keep: false })
      if (g.made === false) throw new Error(g.error || g.code || 'Wanshah 3 could not make it.')
      // Over ~3 MB Code.gs leaves the data URI out rather than sending it, so
      // there is nothing to hand the uploader. Say so instead of failing blank.
      if (!g.data) throw new Error(t(lang, 'pg_too_big'))
      const mime = g.mime || 'image/png'
      const b64 = String(g.data).split(',')[1] || ''
      const up = await adminPost('poster_upload', { name: 'wanshah3-' + Date.now() + (mime === 'image/jpeg' ? '.jpg' : '.png'), mime, b64 })
      onDone(up)
      setOpen(false); setPrompt('')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!open) return (
    <button type="button" className="btn whitespace-nowrap" disabled={disabled} onClick={() => setOpen(true)} title={title || t(lang, 'pg_make')}>
      <Sparkles {...ICON} size={15} /> {t(lang, 'pg_make')}
    </button>
  )
  return (
    <div className="sm:col-span-2 w-full rounded-lg border border-line bg-paper p-3 space-y-2">
      <label className="label mb-0" htmlFor="pg-prompt">{t(lang, 'pg_make')}</label>
      <textarea id="pg-prompt" className="input min-h-16" maxLength={1500} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t(lang, 'pg_ph')} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-brand" disabled={busy || prompt.trim().length < 3} onClick={go}>{busy ? t(lang, 'pg_making') : t(lang, 'pg_go')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { setOpen(false); setErr('') }}>{t(lang, 'cancel')}</button>
        <span className="text-xs text-ink-400">{t(lang, 'pg_hint')}</span>
      </div>
      {err && <p className="text-xs text-red-700 break-words">{err}</p>}
    </div>
  )
}
