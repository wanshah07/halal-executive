// Runtime configuration. The Apps Script web-app URL is the only thing the page
// needs to reach the Sheet; it holds no keys. Set it in .env (VITE_API_URL) or
// leave it empty to run on the bundled sample data.
export const API_URL = import.meta.env.VITE_API_URL || ''
export const SHEET_URL = import.meta.env.VITE_SHEET_URL || ''
export const DRIVE_FOLDER_URL = import.meta.env.VITE_DRIVE_FOLDER_URL || ''
export const SITE_NAME = 'Halal Executive'
export const NEWS_TTL_HOURS = 72
export const CATEGORIES = [
  { id: 'halal',    en: 'Halal',    bm: 'Halal',    hint_en: 'MPPHM (Domestik) 2020, MHMS 2020, MS 1500:2019, Halal Assurance System, logo use', hint_bm: 'MPPHM (Domestik) 2020, MHMS 2020, MS 1500:2019, Sistem Jaminan Halal, penggunaan logo' },
  { id: 'food',     en: 'Food',     bm: 'Makanan',  hint_en: 'Food Act 1983, Food Regulations 1985, labelling, additives, MeSTI, GMP, HACCP', hint_bm: 'Akta Makanan 1983, Peraturan-Peraturan Makanan 1985, pelabelan, bahan tambah, MeSTI, GMP, HACCP' },
  { id: 'cosmetic', en: 'Cosmetic', bm: 'Kosmetik', hint_en: 'NPRA Notifikasi Kosmetik, ingredients, labelling, MS 2634:2019 halal cosmetics', hint_bm: 'Notifikasi Kosmetik NPRA, bahan, pelabelan, MS 2634:2019 kosmetik halal' },
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
// Countries a foreign halal certificate may come from (shown beside the map).
const COUNTRIES = ['United Kingdom', 'India', 'Pakistan', 'Indonesia', 'Thailand', 'Singapore', 'China', 'Vietnam', 'Philippines', 'Australia', 'New Zealand', 'Brazil', 'Argentina', 'United States', 'USA', 'Canada', 'France', 'Germany', 'Netherlands', 'Belgium', 'Italy', 'Spain', 'Ireland', 'Denmark', 'Poland', 'Turkey', 'Saudi Arabia', 'United Arab Emirates', 'UAE', 'Japan', 'Korea', 'Taiwan', 'Bangladesh', 'Sri Lanka', 'Egypt', 'South Africa']
export const guessCountry = (text) => {
  const t = String(text || '').toLowerCase()
  const c = COUNTRIES.find((x) => new RegExp(`\\b${x.toLowerCase()}\\b`).test(t))
  return c === 'USA' ? 'United States' : c === 'UAE' ? 'United Arab Emirates' : c || ''
}
export const guessState = (text) => {
  const t = String(text || '').toLowerCase()
  for (const [k, v] of Object.entries(STATE_ALIASES)) if (t.includes(k)) return v
  return (MY_STATES.find((s) => t.includes(s.id.toLowerCase())) || {}).id || ''
}

// Approximate country centroids for the world maps (FHCB, certificates from
// abroad, directory). Keys are the names JAKIM prints in the FHCB list.
export const COUNTRY_COORDS = {
  Malaysia: [4.2, 108.5], Argentina: [-34.6, -58.4], Australia: [-25.3, 133.8], Austria: [47.5, 14.6], Bangladesh: [23.7, 90.4], 'Bosnia and Herzegovina': [43.9, 17.7],
  Brazil: [-14.2, -51.9], Brunei: [4.5, 114.7], Canada: [56.1, -106.3], Chile: [-33.4, -70.7], China: [35.9, 104.2], Egypt: [26.8, 30.8], Germany: [51.2, 10.4],
  India: [20.6, 79.0], Indonesia: [-2.5, 118.0], Iran: [32.4, 53.7], Ireland: [53.4, -8.2], Italy: [41.9, 12.6], Japan: [36.2, 138.3], Jordan: [30.6, 36.2],
  Kazakhstan: [48.0, 66.9], Kenya: [-0.02, 37.9], 'Kingdom of Saudi Arabia': [23.9, 45.1], 'Saudi Arabia': [23.9, 45.1], Lithuania: [55.2, 23.9], Maldives: [3.2, 73.2],
  Mongolia: [46.9, 103.8], Morocco: [31.8, -7.1], Netherlands: [52.1, 5.3], 'New Zealand': [-40.9, 174.9], Pakistan: [30.4, 69.3], Philippines: [12.9, 121.8],
  Poland: [51.9, 19.1], Portugal: [39.4, -8.2], Russia: [61.5, 105.3], Singapore: [1.35, 103.8], 'South Africa': [-30.6, 22.9], 'South Korea': [35.9, 127.8], Korea: [35.9, 127.8],
  Spain: [40.5, -3.7], 'Sri Lanka': [7.9, 80.8], Switzerland: [46.8, 8.2], Taiwan: [23.7, 121.0], Thailand: [15.9, 100.9], Tunisia: [33.9, 9.5], Turkiye: [38.96, 35.2], Turkey: [38.96, 35.2],
  Uganda: [1.4, 32.3], Ukraine: [48.4, 31.2], 'United Kingdom': [55.4, -3.4], 'United States of America': [37.1, -95.7], 'United States': [37.1, -95.7], Uruguay: [-32.5, -55.8],
  Vietnam: [14.1, 108.3], France: [46.2, 2.2], Belgium: [50.5, 4.5], Denmark: [56.3, 9.5], 'United Arab Emirates': [23.4, 53.8],
}
export const countryCoords = (name) => COUNTRY_COORDS[name] || COUNTRY_COORDS[Object.keys(COUNTRY_COORDS).find((k) => k.toLowerCase() === String(name || '').trim().toLowerCase())] || null
export const stateCoords = (name) => { const s = MY_STATES.find((x) => x.id === name); return s ? [s.lat, s.lng] : null }

// Event kinds (Wan, 15 Oct 2026). "other" catches anything else.
export const EVENT_KINDS = [
  { id: 'competency', en: 'Halal Competency Training', bm: 'Latihan Kompetensi Halal' },
  { id: 'awareness', en: 'Halal Awareness Training', bm: 'Latihan Kesedaran Halal' },
  { id: 'executive', en: 'Halal Executive Training', bm: 'Latihan Eksekutif Halal' },
  { id: 'auditor', en: 'Internal Halal Auditor Training', bm: 'Latihan Juruaudit Halal Dalaman' },
  { id: 'other', en: 'Others', bm: 'Lain-lain' },
]
// Directory groups: training providers and services.
export const DIRECTORY_TYPES = [
  { id: 'jakim_plh', group: 'training', en: 'Halal Training Providers (JAKIM)', bm: 'Penyedia Latihan Halal (JAKIM)' },
  { id: 'jurusertu', group: 'service', en: 'Jurusertu', bm: 'Jurusertu' },
  { id: 'consult', group: 'service', en: 'Training & Consultancy', bm: 'Latihan & Konsultasi' },
  { id: 'lab', group: 'service', en: 'Laboratory', bm: 'Makmal', soon: true },
]
