import { useEffect, useState } from 'react'
import { adminPost } from '../lib/api'
import { API_URL } from '../lib/config'
import { t } from '../lib/i18n'

// Admin panel. Everything here is a Settings-tab key. The token is the
// ADMIN_TOKEN Script Property; it is typed once and kept in localStorage.
// The notice block drives the Overview popup; posters feed the Events page.
const FIELDS = [
  ['hero_title', 'hero_title'], ['hero_subtitle', 'hero_sub'], ['hero_subtitle_bm', 'hero_sub'], ['hero_image', 'hero_image'], ['hero_cta', 'hero_cta'], ['hero_cta_url', 'hero_cta_url'],
]

export default function Admin({ lang, data, onSaved }) {
  const [token, setToken] = useState(() => { try { return localStorage.getItem('he:token') || '' } catch { return '' } })
  const [s, setS] = useState({})
  const [posters, setPosters] = useState([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const st = data.settings || {}
    setS(st)
    try { setPosters(JSON.parse(st.posters || '[]')) } catch { setPosters([]) }
  }, [data])

  const set = (k, v) => setS((x) => ({ ...x, [k]: v }))
  async function save() {
    setBusy(true); setMsg('')
    try {
      try { localStorage.setItem('he:token', token) } catch { /* ignore */ }
      const settings = { ...s, posters: JSON.stringify(posters.filter((p) => p.url)) }
      await adminPost('settings', { settings }, token)
      setMsg(t(lang, 'saved')); onSaved && onSaved()
    } catch (e) { setMsg(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold mb-1">{t(lang, 'admin')}</h2>
      <p className="text-sm text-ink-600 mb-4">{t(lang, 'admin_intro')}</p>
      {!API_URL && <div className="card p-3 mb-4 text-sm bg-amber-50 border-amber-200">VITE_API_URL is empty. Writes are disabled until the Apps Script endpoint is set.</div>}

      <div className="card p-5 mb-4">
        <label className="label">{t(lang, 'token')}</label>
        <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN" />
      </div>

      <div className="card p-5 mb-4 space-y-3">
        <h3 className="font-semibold">Hero</h3>
        {FIELDS.map(([k, label]) => (
          <div key={k}><label className="label">{t(lang, label)} <span className="text-ink-400">({k})</span></label><input className="input" value={s[k] || ''} onChange={(e) => set(k, e.target.value)} /></div>
        ))}
      </div>

      <div className="card p-5 mb-4 space-y-3">
        <h3 className="font-semibold">{t(lang, 'notice')}</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={String(s.notice_enabled) === 'true'} onChange={(e) => set('notice_enabled', e.target.checked ? 'true' : 'false')} /> {t(lang, 'notice_enabled')}</label>
        <div><label className="label">{t(lang, 'notice_title')}</label><input className="input" value={s.notice_title || ''} onChange={(e) => set('notice_title', e.target.value)} /></div>
        <div><label className="label">{t(lang, 'notice_body')} (EN)</label><textarea className="input" rows={3} value={s.notice_body || ''} onChange={(e) => set('notice_body', e.target.value)} /></div>
        <div><label className="label">{t(lang, 'notice_body')} (BM)</label><textarea className="input" rows={3} value={s.notice_body_bm || ''} onChange={(e) => set('notice_body_bm', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">{t(lang, 'notice_level')}</label><select className="input" value={s.notice_level || 'info'} onChange={(e) => set('notice_level', e.target.value)}><option value="info">info</option><option value="warning">warning</option><option value="danger">danger</option></select></div>
          <div><label className="label">{t(lang, 'notice_until')}</label><input className="input" value={s.notice_until || ''} onChange={(e) => set('notice_until', e.target.value)} placeholder="2026-12-31" /></div>
        </div>
      </div>

      <div className="card p-5 mb-4 space-y-3">
        <div className="flex justify-between items-center"><h3 className="font-semibold">{t(lang, 'posters')}</h3><button className="btn" onClick={() => setPosters((p) => [...p, { title: '', url: '', link: '' }])}>+ {t(lang, 'add_poster')}</button></div>
        {posters.map((p, i) => (
          <div key={i} className="grid md:grid-cols-[1fr_2fr_2fr_auto] gap-2 items-start">
            <input className="input" placeholder="Title" value={p.title} onChange={(e) => setPosters((ps) => ps.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
            <input className="input" placeholder="Image URL (Drive share link, Unsplash, Canva export…)" value={p.url} onChange={(e) => setPosters((ps) => ps.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
            <input className="input" placeholder="Click-through link" value={p.link} onChange={(e) => setPosters((ps) => ps.map((x, j) => j === i ? { ...x, link: e.target.value } : x))} />
            <button className="btn" onClick={() => setPosters((ps) => ps.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-brand" onClick={save} disabled={busy || !API_URL}>{busy ? '…' : t(lang, 'save')}</button>
        {msg && <span className="text-sm text-ink-600">{msg}</span>}
      </div>
    </div>
  )
}
