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
