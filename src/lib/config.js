// Runtime configuration. The Apps Script web-app URL is the only thing the page
// needs to reach the Sheet; it holds no keys. Set it in .env (VITE_API_URL) or
// leave it empty to run on the bundled sample data.
export const API_URL = import.meta.env.VITE_API_URL || ''
export const SHEET_URL = import.meta.env.VITE_SHEET_URL || ''
export const DRIVE_FOLDER_URL = import.meta.env.VITE_DRIVE_FOLDER_URL || ''
export const SITE_NAME = 'Halal Executive'
export const SITE_SUB = 'Knowledge hub for halal executives · JAKIM, JAIN/MAIN, KKM, NPRA, MS 1500, MS 2200, MS 2400'
export const NEWS_TTL_HOURS = 72
export const CATEGORIES = [
  { id: 'halal',    en: 'Halal',    bm: 'Halal',    hint_en: 'Certification, MS 1500, MS 2200, MS 2400, Halal Assurance System, logo use', hint_bm: 'Pensijilan, MS 1500, MS 2200, MS 2400, Sistem Jaminan Halal, penggunaan logo' },
  { id: 'food',     en: 'Food',     bm: 'Makanan',  hint_en: 'Food Act 1983, Food Regulations 1985, labelling, additives, MeSTI, GMP, HACCP', hint_bm: 'Akta Makanan 1983, Peraturan-Peraturan Makanan 1985, pelabelan, bahan tambah, MeSTI, GMP, HACCP' },
  { id: 'cosmetic', en: 'Cosmetic', bm: 'Kosmetik', hint_en: 'NPRA Notifikasi Kosmetik, ingredients, labelling, MS 2200 Part 1', hint_bm: 'Notifikasi Kosmetik NPRA, bahan, pelabelan, MS 2200 Bahagian 1' },
]

// Chart colours: validated with the dataviz palette validator (light surface
// #fcfcfb and dark #1a1a19, all six checks pass, 14 Oct 2026). Fixed order,
// one hue per category, never cycled.
export const CHART = {
  light: { halal: '#1baf7a', food: '#eb6834', cosmetic: '#2a78d6', single: '#2a78d6', grid: '#e2e8f0', ink: '#475569' },
  dark:  { halal: '#199e70', food: '#d95926', cosmetic: '#3987e5', single: '#3987e5', grid: '#2a2a28', ink: '#c3c2b7' },
}

// Malaysian states with centroids for the overview map (WGS84, approximate
// geographic centres; good enough for a marker, not for boundaries).
export const MY_STATES = [
  { id: 'Johor', lat: 1.95, lng: 103.5 }, { id: 'Kedah', lat: 6.0, lng: 100.6 }, { id: 'Kelantan', lat: 5.3, lng: 102.0 },
  { id: 'Melaka', lat: 2.25, lng: 102.3 }, { id: 'Negeri Sembilan', lat: 2.8, lng: 102.2 }, { id: 'Pahang', lat: 3.8, lng: 102.5 },
  { id: 'Perak', lat: 4.7, lng: 101.1 }, { id: 'Perlis', lat: 6.5, lng: 100.2 }, { id: 'Pulau Pinang', lat: 5.4, lng: 100.3 },
  { id: 'Sabah', lat: 5.4, lng: 117.0 }, { id: 'Sarawak', lat: 2.5, lng: 113.0 }, { id: 'Selangor', lat: 3.2, lng: 101.4 },
  { id: 'Terengganu', lat: 4.9, lng: 103.0 }, { id: 'Kuala Lumpur', lat: 3.14, lng: 101.69 }, { id: 'Putrajaya', lat: 2.93, lng: 101.69 }, { id: 'Labuan', lat: 5.3, lng: 115.2 },
]
export const STATE_ALIASES = { 'wp kuala lumpur': 'Kuala Lumpur', 'w.p. kuala lumpur': 'Kuala Lumpur', kl: 'Kuala Lumpur', penang: 'Pulau Pinang', malacca: 'Melaka', 'n. sembilan': 'Negeri Sembilan', 'wp putrajaya': 'Putrajaya', 'wp labuan': 'Labuan' }
export const guessState = (text) => {
  const t = String(text || '').toLowerCase()
  for (const [k, v] of Object.entries(STATE_ALIASES)) if (t.includes(k)) return v
  return (MY_STATES.find((s) => t.includes(s.id.toLowerCase())) || {}).id || ''
}
