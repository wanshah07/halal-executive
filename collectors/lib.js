// Shared by the three collectors: one POST to the Apps Script ingest action
// with retry. Rows: {source, group, msg_id, sender_hash, ts, text, attachments}.
const API = process.env.HE_API_URL
const TOKEN = process.env.HE_INGEST_TOKEN

export async function post(action, payload) {
  if (!API || !TOKEN) throw new Error('HE_API_URL and HE_INGEST_TOKEN are required')
  let last
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: TOKEN, ...payload }) })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      return j
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500 * 2 ** i)) }
  }
  throw last
}
export const ingest = (rows) => post('ingest', { rows })
