import { adminPost, getSession } from './api'

// Admin uploads go through a queue that lives outside any page component, so
// moving to another tab of the site does not stop or lose them. Each file is
// saved in this browser (IndexedDB) the moment it is picked and is only
// removed once Apps Script has it; a reload or a crash resumes the queue.
// The browser warns before closing the tab while something is still sending.
const DB = 'he-uploads', STORE = 'q'
let db = null, running = false
const subs = new Set()
let items = []

function open() {
  if (db) return Promise.resolve(db)
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
    r.onsuccess = () => { db = r.result; res(db) }
    r.onerror = () => rej(r.error)
  })
}
const tx = (mode, fn) => open().then((d) => new Promise((res, rej) => {
  const t = d.transaction(STORE, mode), out = fn(t.objectStore(STORE))
  t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error)
}))
const emit = () => subs.forEach((f) => f(items.slice()))

async function reload() {
  try { items = (await tx('readonly', (s) => s.getAll())) || [] } catch { /* private mode: memory only */ }
  items.sort((a, b) => a.added - b.added); emit()
}
async function put(it) {
  const i = items.findIndex((x) => x.id === it.id); if (i >= 0) items[i] = it; else items.push(it)
  emit(); try { await tx('readwrite', (s) => s.put(it)) } catch { /* memory only */ }
}
async function drop(id) {
  items = items.filter((x) => x.id !== id); emit()
  try { await tx('readwrite', (s) => s.delete(id)) } catch { /* memory only */ }
}

const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob) })

export function subscribe(fn) { subs.add(fn); fn(items.slice()); return () => subs.delete(fn) }
export const pending = () => items.some((x) => x.state === 'waiting' || x.state === 'sending')

// files: File[] (may be empty for a note only)
export async function enqueue({ kind, note, files }) {
  const list = files.length ? files : [null]
  for (const f of list) {
    await put({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, added: Date.now(), kind, note, name: f ? f.name : '', mime: f ? f.type || '' : '', size: f ? f.size : 0, blob: f || null, state: 'waiting', msg: '' })
  }
  work()
}
export function forget(id) { return drop(id) }
export function retry(id) { const it = items.find((x) => x.id === id); if (it) { put({ ...it, state: 'waiting', msg: '' }).then(work) } }

async function work() {
  if (running) return
  running = true
  try {
    for (;;) {
      const it = items.find((x) => x.state === 'waiting')
      if (!it) break
      await put({ ...it, state: 'sending' })
      try {
        const b64 = it.blob ? await toB64(it.blob) : ''
        const r = await adminPost('manual_upload', { kind: it.kind, note: it.note, name: it.name || undefined, mime: it.mime, b64 })
        // Sent: the file is in Drive and Raw now, so the browser copy goes.
        await put({ ...it, blob: null, state: 'sent', msg: '', result: { chat: !!r.chat, messages: r.messages, added: r.added, skipped: r.skipped, run: r.run }, sent: Date.now() })
      } catch (e) {
        const m = String(e.message || e)
        // Signed out or a network drop: keep it waiting for the next try.
        const again = /unauthor|sign in|network|fetch|timeout/i.test(m)
        await put({ ...it, state: again ? 'waiting' : 'failed', msg: m })
        if (again) break
      }
    }
  } finally { running = false }
}

// Sent rows stay listed for a day so the admin sees what went, then go.
async function tidy() { for (const it of items) if (it.state === 'sent' && Date.now() - (it.sent || 0) > 24 * 3600e3) await drop(it.id) }

if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  addEventListener('online', work)
  addEventListener('beforeunload', (e) => { if (pending()) { e.preventDefault(); e.returnValue = '' } })
  // Resume what a closed tab left behind (only for a signed-in admin; anything
  // left "sending" is sent again).
  if (getSession()) {
    reload().then(tidy).then(() => {
      items.filter((x) => x.state === 'sending').forEach((x) => put({ ...x, state: 'waiting' }))
      work()
    })
  }
}
