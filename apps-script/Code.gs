/**
 * Halal Executive — Google Apps Script backend.
 *
 * One Sheet, one web app. The page reads it (GET ?action=data), the pipeline
 * and collectors write to it (POST with INGEST_TOKEN), the Admin panel writes
 * Settings (POST with ADMIN_TOKEN), and the chatbot asks it (POST action=chat)
 * so no LLM key ever reaches the browser.
 *
 * Deploy: Extensions → Apps Script → paste → Deploy → New deployment →
 * Web app, Execute as: Me, Who has access: Anyone. Copy the /exec URL into
 * VITE_API_URL (page) and HE_API_URL (pipeline, collectors).
 *
 * Script Properties (Project Settings → Script properties). You type TWO:
 *   MIRELD_API_KEY     Bearer key for https://api.mireld.my/v1
 *   AFIQ_API_KEY       Bearer key for https://rootsys.cloud/v1
 * setup() creates the rest if they are missing and prints them in the log:
 *   ADMIN_TOKEN        random; paste into the Admin panel once
 *   INGEST_TOKEN       random; GitHub secret HE_INGEST_TOKEN + collectors
 *   DRIVE_ROOT_ID      id of the "Halal Executive" Drive folder it creates
 * Optional:
 *   KIOS_API_KEY       Bearer key for https://kiosapi.com/v1 (Wanshah 3, the image expert:
 *                      makes a test picture; Admin -> Wanshah 3).
 *   (Admin -> AI model now sets the provider and the model; these are the fallback.)
 *   MIRELD_MODEL / AFIQ_MODEL   leave empty or "auto" and the model is picked
 *                      from the gateway's own /models list and re-picked by
 *                      itself if that model is withdrawn; or set an exact id
 *                      (or a comma list, first one available wins).
 *
 *   ADMIN_EMAILS       comma list of emails allowed into the Admin tab;
 *                      setup() starts it with your own Google account.
 *
 * Run setup() once. Run showSecrets() any time to print the tokens again.
 */

var TABS = {
  Raw:        ['id','source','group','msg_id','sender_hash','ts','text','attachments','status','processed_at','model','notes','fp'],
  FAQ:        ['id','category','subcategory','question_en','question_bm','answer_formal_en','answer_layman_en','answer_formal_bm','answer_layman_bm','source_refs','confidence','status','created_at','updated_at','model','verify_notes','verified_at','published_at'],
  Guidelines: ['id','category','title','title_bm','summary_en','summary_bm','link','issuer','effective_date','updated_at','status','source','created_at','published_at'],
  Documents:  ['id','title','kind','category','drive_file_id','drive_url','content_hash','version','supersedes_id','source_msg_id','received_at','updated_at','status','notes','published_at'],
  Certificates: ['id','company','cert_no','scheme','category','state','valid_from','valid_to','products','drive_url','doc_id','status','updated_at','notes','issuer','legal_authority','reg_no','issue_date','office_address','factory_address','scope','created_at','published_at'],
  Events:     ['id','title','title_bm','date_start','date_end','venue','poster_url','link','description','status','source','poster_file','kind','created_at','published_at'],
  News:       ['id','title','url','source','published_at','fetched_at','expires_at','summary_en','summary_bm','category'],
  Settings:   ['key','value'],
  Runs:       ['ts','job','provider','model','processed','ok','error'],
  References: ['id','title','issuer','edition','category','drive_file_id','drive_url','mime','pages','chunks','summary_en','summary_bm','key_points','status','added_by','added_at','indexed_at','error'],
  RefChunks:  ['id','ref_id','page','text','terms'],
  // Foreign halal certification bodies recognised by JAKIM (Admin → FHCB) and
  // the directory of training and service providers (Admin → Directory).
  FHCB:       ['id','no','country','name','kind','address','persons','tel','fax','email','website','logo_url','logo_file','note','source_ref','source_page','effective_date','status','updated_at','created_at','published_at'],
  Directory:  ['id','type','subtype','name','coverage','state','country','address','pic','phone','email','website','website2','accreditation','description','trainers','logo_url','logo_file','source_ref','status','updated_at','created_at','published_at'],
  // Halal job vacancies (Wan, 20 Oct 2026): from the WhatsApp and Telegram
  // groups or typed in Admin. Deleted for good a day after closing_date (or 60
  // days after they were added when the ad gives no closing date).
  Vacancies:  ['id','title','title_bm','employer','location','state','job_type','salary','requirements','description','apply_link','apply_email','apply_phone','closing_date','category','poster_url','poster_file','status','source','created_at','published_at','updated_at'],
};

// Fields of a vacancy Admin may type or correct (vacancySave, reviewSave).
var VACANCY_FIELDS = ['title', 'title_bm', 'employer', 'location', 'state', 'job_type', 'salary', 'requirements', 'description', 'apply_link', 'apply_email', 'apply_phone', 'closing_date', 'category', 'poster_url', 'poster_file'];

// Tabs the pipeline may write with upsert/delete. Settings, Raw and Runs have
// their own narrow actions, so an ingest token can never rewrite the hero,
// the notice or the admin list.
var WRITABLE = ['FAQ', 'Guidelines', 'Documents', 'Certificates', 'Events', 'News', 'References', 'RefChunks', 'FHCB', 'Directory', 'Vacancies'];

var AI_STATUS_KEY = 'ai_status_v3'; // bump when the status shape changes, so a new deploy never serves the old one
var PROVIDERS = {
  MIRELD: { base: 'https://api.mireld.my/v1', keyProp: 'MIRELD_API_KEY', modelProp: 'MIRELD_MODEL' },
  AFIQ:   { base: 'https://rootsys.cloud/v1',  keyProp: 'AFIQ_API_KEY',   modelProp: 'AFIQ_MODEL' },
};

function props() { return PropertiesService.getScriptProperties(); }
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function setup() {
  var s = ss();
  Object.keys(TABS).forEach(function (name) {
    var sh = s.getSheetByName(name) || s.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(TABS[name]); sh.setFrozenRows(1); }
    else ensureHeader(sh, TABS[name]);
  });
  var defaults = { hero_title: 'Halal Executive', hero_subtitle: 'Answers, guidelines and documents for halal executives, in one place.', hero_cta: 'Open the FAQ', hero_cta_url: '#faq', notice_enabled: 'false', notice_level: 'info', posters: '[]', llm_turn: '0' };
  var cur = readSettings();
  Object.keys(defaults).forEach(function (k) { if (cur[k] === undefined) sheet('Settings').appendRow([k, defaults[k]]); });
  var P = props();
  if (!P.getProperty('ADMIN_TOKEN')) P.setProperty('ADMIN_TOKEN', newToken());
  if (!P.getProperty('INGEST_TOKEN')) P.setProperty('INGEST_TOKEN', newToken());
  if (!P.getProperty('DRIVE_ROOT_ID')) {
    var it = DriveApp.getFoldersByName('Halal Executive');
    var f = it.hasNext() ? it.next() : DriveApp.createFolder('Halal Executive');
    P.setProperty('DRIVE_ROOT_ID', f.getId());
  }
  if (!P.getProperty('ADMIN_EMAILS')) P.setProperty('ADMIN_EMAILS', Session.getEffectiveUser().getEmail().toLowerCase());
  // Guidelines are no longer seeded: they mirror the References library
  // (pipeline/index_references.py sync_guidelines). seedReferences() stays for
  // reference but is not run.
  showSecrets();
}

// The core references every halal executive needs, checked 14 Oct 2026.
// Adds only the ones whose id is not in the Guidelines tab yet, so running it
// again never duplicates; edit or hide rows in the Sheet as editions change.
var REFERENCES = [
  ['GL-REF-01', 'halal', 'Manual Prosedur Pensijilan Halal Malaysia (Domestik) 2020', 'Manual Prosedur Pensijilan Halal Malaysia (Domestik) 2020',
   'MPPHM 2020: application, audit, certification, monitoring and enforcement of the Malaysian halal certificate. Listed as the current manual on the Halal Malaysia portal.',
   'MPPHM 2020: permohonan, audit, pensijilan, pemantauan dan penguatkuasaan Sijil Pengesahan Halal Malaysia. Disenaraikan sebagai manual semasa di Portal Halal Malaysia.',
   'https://www.halal.gov.my/', 'JAKIM', '2020'],
  ['GL-REF-02', 'halal', 'Malaysian Halal Management System (MHMS) 2020', 'Sistem Pengurusan Halal Malaysia (MHMS) 2020',
   'Internal halal control: Internal Halal Control System for micro and small firms, Halal Assurance System for large firms. Replaced the Guideline for Halal Assurance Management System.',
   'Kawalan halal dalaman: Sistem Kawalan Halal Dalaman untuk syarikat mikro dan kecil, Sistem Jaminan Halal untuk syarikat besar. Menggantikan Garis Panduan Sistem Pengurusan Jaminan Halal.',
   'https://www.halal.gov.my/', 'JAKIM', '2020'],
  ['GL-REF-03', 'food', 'MS 1500:2019 Halal food – General requirements (Third revision)', 'MS 1500:2019 Makanan halal – Keperluan umum (Semakan ketiga)',
   'Manufacturing and handling of halal food, including nutrient supplements. Reconfirmed by Standards Malaysia in 2024.',
   'Pengeluaran dan pengendalian makanan halal, termasuk suplemen nutrien. Disahkan semula oleh Jabatan Standard Malaysia pada 2024.',
   'https://mysol.jsm.gov.my/', 'Standards Malaysia', '2019'],
  ['GL-REF-04', 'cosmetic', 'MS 2634:2019 Halal cosmetics – General requirements (First revision)', 'MS 2634:2019 Kosmetik halal – Keperluan umum (Semakan pertama)',
   'Manufacturing and handling of halal cosmetics. Replaced MS 2200-1:2008, which is withdrawn.',
   'Pengeluaran dan pengendalian kosmetik halal. Menggantikan MS 2200-1:2008 yang telah ditarik balik.',
   'https://mysol.jsm.gov.my/', 'Standards Malaysia', '2019'],
  ['GL-REF-05', 'cosmetic', 'Guidelines for Control of Cosmetic Products in Malaysia', 'Garis Panduan Kawalan Produk Kosmetik di Malaysia',
   'NPRA requirements for Notifikasi Kosmetik, ingredient annexes, labelling and claims. Check the NPRA site for the current revision.',
   'Keperluan NPRA untuk Notifikasi Kosmetik, lampiran bahan, pelabelan dan dakwaan. Semak laman NPRA untuk semakan terkini.',
   'https://www.npra.gov.my/', 'NPRA', '']
];
function seedReferences() {
  var have = {}; readTab('Guidelines').forEach(function (r) { have[String(r.id)] = 1; });
  var now = new Date().toISOString(), rows = [];
  REFERENCES.forEach(function (x) {
    if (have[x[0]]) return;
    rows.push({ id: x[0], category: x[1], title: x[2], title_bm: x[3], summary_en: x[4], summary_bm: x[5], link: x[6], issuer: x[7], effective_date: x[8], updated_at: now, status: 'published', source: 'reference' });
  });
  if (rows.length) upsert('Guidelines', rows);
  Logger.log('References added: ' + rows.length);
  return rows.length;
}

function newToken() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }

// Prints the generated values to the execution log (View → Logs). Only the
// script owner can run this or read the log.
function showSecrets() {
  var P = props(), f = DriveApp.getFolderById(P.getProperty('DRIVE_ROOT_ID'));
  Logger.log('ADMIN_TOKEN   = ' + P.getProperty('ADMIN_TOKEN'));
  Logger.log('INGEST_TOKEN  = ' + P.getProperty('INGEST_TOKEN'));
  Logger.log('DRIVE_ROOT_ID = ' + f.getId() + '   (' + f.getUrl() + ')');
  Logger.log('ADMIN_EMAILS  = ' + P.getProperty('ADMIN_EMAILS'));
  Logger.log('MIRELD key ' + (P.getProperty('MIRELD_API_KEY') ? 'set' : 'MISSING') + ', model ' + (P.getProperty('MIRELD_MODEL') || 'auto'));
  Logger.log('AFIQ key   ' + (P.getProperty('AFIQ_API_KEY') ? 'set' : 'MISSING') + ', model ' + (P.getProperty('AFIQ_MODEL') || 'auto'));
}

// Rotate a token: run, then update the GitHub secret / Admin panel.
function rotateTokens() { props().setProperty('ADMIN_TOKEN', newToken()); props().setProperty('INGEST_TOKEN', newToken()); showSecrets(); }

function sheet(name) { var sh = ss().getSheetByName(name); if (!sh) { if (!TABS[name]) throw new Error('Missing tab ' + name); sh = ss().insertSheet(name); sh.appendRow(TABS[name]); sh.setFrozenRows(1); } return sh; }

// Columns are only ever appended, so an older tab gets the new names written
// after its last header cell and every existing value stays where it was.
function ensureHeader(sh, cols) {
  var have = sh.getLastColumn();
  if (have >= cols.length) return;
  sh.getRange(1, have + 1, 1, cols.length - have).setValues([cols.slice(have)]);
}

function readTab(name) {
  var sh = ss().getSheetByName(name);
  if (!sh) { if (!TABS[name]) throw new Error('Missing tab ' + name); sh = ss().insertSheet(name); sh.appendRow(TABS[name]); sh.setFrozenRows(1); return []; }
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  var h = v[0];
  return v.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {}; h.forEach(function (k, i) { o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]; }); return o;
  });
}

function readSettings() { var o = {}; readTab('Settings').forEach(function (r) { o[r.key] = String(r.value); }); return o; }

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- GET: public feed ----------
function doGet(e) {
  var a = (e.parameter.action || 'data');
  if (a === 'data') return json(cachedPublicData());
  if (a === 'ping') return json({ ok: true, ts: new Date().toISOString() });
  // Settings only (a few KB): the popup notice reads this first, so a colour
  // or poster changed in Admin shows without waiting for the full feed.
  if (a === 'settings') { var st = stripLlm(readSettings()); delete st.seed_deleted; return json({ ok: true, settings: st }); }
  if (a === 'thumb') { if (!rate('thumb', 60, 60)) return json({ ok: false, error: 'Busy, try again in a minute.' }); return json(thumbFor(String(e.parameter.id || ''))); }
  if (a === 'status') return json(aiStatus());
  return json({ ok: false, error: 'unknown action' });
}

// [SAHKAN: …] is a working note for the pipeline (pipeline/resolve_sahkan.py
// fills it from the references library or takes it out); readers never see the
// marker. Where one is still open in a long text, the reader gets a plain
// request instead (Wan, 19 Oct 2026): find the specific guideline and page that
// state it and check it with the Assistant, which reads that page and says
// whether it does. Elsewhere (titles, names, links) it is simply removed.
var VERIFY_LONG = /(answer|summary|description|details|scope|body|note)/i;
var VERIFY_EMPTY = /^(what to verify|apa yang perlu disahkan|\.\.\.|…|sahkan|verify|tbc)?$/i;
function verifyAsk(body, bm) {
  var what = String(body || '').replace(/^[\s:\-]+/, '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (what.length > 100 || VERIFY_EMPTY.test(what) || what.length < 4) what = '';
  if (bm) return what ? 'Perlu disahkan: ' + what + '. Cari garis panduan dan muka surat khusus yang menyatakannya, kemudian semak dengan Pembantu.' : 'Cari garis panduan dan muka surat khusus yang menyatakannya, kemudian semak dengan Pembantu.';
  return what ? 'To confirm: ' + what + '. Find the specific guideline and page that state it, then check it with the Assistant.' : 'Find the specific guideline and page that state this, then check it with the Assistant.';
}
function markText(text, key) {
  var long = VERIFY_LONG.test(key), bm = /(^|_)bm($|_)/.test(key), asks = [];
  var clean = String(text).replace(/\s*\[SAHKAN\s*:?([^\]]*)\]/gi, function (m, body) {
    if (long) { var line = verifyAsk(body, bm); if (asks.indexOf(line) < 0) asks.push(line); }
    return '';
  }).replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return asks.length ? (clean + ' ' + asks.join(' ')).trim() : clean;
}
function noMarks(rows) {
  return rows.map(function (r) {
    // WhatsApp message ids carry the group id (a phone number): never public.
    delete r.source_refs; delete r.source_msg_id; delete r.sender_hash;
    Object.keys(r).forEach(function (k) {
      if (typeof r[k] !== 'string') return;
      if (r[k].indexOf('[') >= 0) r[k] = markText(r[k], k);
      if (/@(g|c)\.us|@lid\b/.test(r[k])) r[k] = '';
    });
    return r;
  });
}

// The public feed is built from eight tabs, which took 5-7 s per visit.
// It is kept in CacheService for 5 minutes, split into 90 KB pieces (the
// per-value limit is 100 KB), and dropped the moment anything is written
// through this script. Collector heartbeats are read fresh each time, so the
// Live chip never waits for the cache. Edits typed straight into the Sheet
// show within 5 minutes.
var PUB_TTL = 300, PUB_PIECE = 90000;
function pubBust() { props().setProperty('pub_v', String(Date.now())); }
function pubFromCache(cache, base) {
  var head = cache.get(base + 'n');
  if (!head) return null;
  var keys = []; for (var i = 0; i < Number(head); i++) keys.push(base + i);
  var got = cache.getAll(keys), parts = [];
  for (var j = 0; j < keys.length; j++) { if (got[keys[j]] == null) return null; parts.push(got[keys[j]]); }
  try { return JSON.parse(parts.join('')); } catch (e) { return null; }
}
// The feed takes 4-12 s to build. After every write the cache is stale, and each
// visitor who arrived meanwhile used to build it again at the same moment: a
// dozen at once ran Apps Script out of simultaneous runs and the rest got
// Google's HTML 404 ("Sheet feed 404", 18 Oct 2026). Now one builds it and the
// others wait up to 15 s for that copy.
function cachedPublicData() {
  var cache = CacheService.getScriptCache(), v = props().getProperty('pub_v') || '0', base = 'pub_' + v + '_';
  var body = pubFromCache(cache, base);
  if (!body && cache.get(base + 'building')) {
    for (var w = 0; w < 15 && !body; w++) { Utilities.sleep(1000); body = pubFromCache(cache, base); }
  }
  if (!body) {
    try { cache.put(base + 'building', '1', 40); } catch (e) { /* cache full */ }
    try {
      body = publicData();
      try {
        var str = JSON.stringify(body), put = {}, n = Math.ceil(str.length / PUB_PIECE);
        for (var k = 0; k < n; k++) put[base + k] = str.slice(k * PUB_PIECE, (k + 1) * PUB_PIECE);
        put[base + 'n'] = String(n);
        cache.putAll(put, PUB_TTL);
      } catch (e) { /* too large to cache: serve uncached */ }
    } finally {
      // Always clear the flag, even when publicData() throws, or every other
      // visitor would wait the full 15 s and then build their own copy anyway
      // until the 40-second TTL expires on its own.
      try { cache.remove(base + 'building'); } catch (e) { /* expires by itself */ }
    }
  }
  body.collectors = collectorStatus();
  var now = Date.now();
  body.news = (body.news || []).filter(function (r) { return !r.expires_at || Date.parse(r.expires_at) > now; });
  return body;
}

// Counts per status and source without loading the message text.
function rawStats() {
  var stats = { new: 0, processed: 0, skipped: 0, by_source: {} }, sh = sheet('Raw'), n = sh.getLastRow() - 1;
  if (n < 1) return stats;
  var cols = TABS.Raw, src = sh.getRange(2, cols.indexOf('source') + 1, n, 1).getValues(), st = sh.getRange(2, cols.indexOf('status') + 1, n, 1).getValues(),
      at = sh.getRange(2, cols.indexOf('attachments') + 1, n, 1).getValues();
  stats.files_waiting = 0; // posters, certificates and documents not read yet (the fast lane's queue)
  for (var i = 0; i < n; i++) {
    if (!src[i][0] && !st[i][0]) continue;
    stats[st[i][0]] = (stats[st[i][0]] || 0) + 1; stats.by_source[src[i][0]] = (stats.by_source[src[i][0]] || 0) + 1;
    if (st[i][0] === 'new' && String(at[i][0] || '').indexOf('"name"') >= 0) stats.files_waiting++;
  }
  return stats;
}

function publicData() {
  var settings = stripLlm(readSettings());
  var now = Date.now();
  var stats = rawStats();
  var runs = readTab('Runs').sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); }).slice(0, 20);
  return {
    settings: settings,
    // Open points to confirm are for the admin only.
    // source_refs are WhatsApp message ids, which carry the group id (a phone
    // number): admin only, like the open points to confirm.
    faq: noMarks(readTab('FAQ').filter(function (r) { return r.status === 'published'; }).map(function (r) { delete r.verify_notes; delete r.source_refs; return r; })),
    guidelines: noMarks(readTab('Guidelines').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft'; })),
    // Only what an admin published (or uploaded): group files wait as drafts,
    // expired certificates and unread inbox files never show.
    documents: noMarks(readTab('Documents').filter(function (r) { return ['hidden', 'duplicate', 'draft', 'expired', 'inbox'].indexOf(String(r.status)) < 0; })),
    // Every halal certificate is on the site (Wan, 20 Oct 2026: "do not make halal cert hidden"), until
    // it expires; then purgeExpiredCerts deletes it for good.
    certificates: noMarks(readTab('Certificates').filter(function (r) { return r.status !== 'expired' && !(r.valid_to && eventOver({ date_start: r.valid_to }, now)); })),
    events: noMarks(readTab('Events').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft' && !eventOver(r, now); })),
    news: readTab('News').filter(function (r) { return !r.expires_at || Date.parse(r.expires_at) > now; }),
    fhcb: readTab('FHCB').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft'; }),
    vacancies: noMarks(readTab('Vacancies').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft' && !vacancyOver(r, now); })),
    directory: readTab('Directory').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft'; }),
    references: readTab('References').filter(function (r) { return r.status === 'indexed'; }).map(function (r) {
      return { id: r.id, title: r.title, issuer: r.issuer, edition: r.edition, category: r.category, pages: r.pages, summary_en: r.summary_en, summary_bm: r.summary_bm, key_points: r.key_points, indexed_at: r.indexed_at };
    }),
    runs: runs, raw_stats: stats, generated_at: new Date().toISOString(),
  };
}

// ---------- POST: writes ----------
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json({ ok: false, error: 'bad json' }); }
  var a = body.action;
  try {
    // Public actions, each rate-limited so the page cannot be used to run up
    // the model bill or flood an inbox.
    if (a === 'chat') { if (!rate('chat', 30, 60)) return json({ ok: false, error: 'Busy, try again in a minute.' }); return json(chat(body)); }
    if (a === 'ask') { if (!rate('ask', 40, 60)) return json({ ok: false, error: 'Busy, try again in a minute.' }); return json(askReferences(body)); }
    if (a === 'login_request') return json(loginRequest(body.email));
    if (a === 'login_verify') return json(loginVerify(body.email, body.code));
    if (a === 'logout') { if (body.session) props().deleteProperty(sessKey(body.session)); return json({ ok: true }); }
    var P = props();
    var sessEmail = sessionEmail(body.session);
    if (a === 'whoami') return json(sessEmail ? { ok: true, email: sessEmail } : { ok: false, error: 'unauthorised' });
    // Admin = a signed-in registered email, or ADMIN_TOKEN for scripts.
    var isAdmin = !!sessEmail || (!!body.token && body.token === P.getProperty('ADMIN_TOKEN'));
    var isIngest = isAdmin || (!!body.token && body.token === P.getProperty('INGEST_TOKEN'));
    if (!isIngest) return json({ ok: false, error: 'unauthorised' });
    var needAdmin = function () { if (!isAdmin) throw new Error('Sign in with a registered email first.'); };

    // Reads and slow work: no lock, so they never hold up a write.
    if (a === 'admins_get')   { needAdmin(); return json({ ok: true, emails: adminEmails(), owner: Session.getEffectiveUser().getEmail().toLowerCase() }); }
    if (a === 'review_list')  { needAdmin(); return json(reviewList()); }
    if (a === 'ref_list')     { needAdmin(); return json({ ok: true, rows: readTab('References') }); }
    if (a === 'event_list')   { needAdmin(); return json({ ok: true, rows: readTab('Events') }); }
    if (a === 'vacancy_list') { needAdmin(); return json({ ok: true, rows: readTab('Vacancies') }); }
    if (a === 'raw_list')     return json({ ok: true, rows: rawList(body.status, body.source, Math.min(body.limit || 50, 500), body.attachments) });
    if (a === 'read')         { if (WRITABLE.indexOf(body.tab) < 0 && body.tab !== 'Raw') throw new Error('tab not readable'); return json({ ok: true, rows: readTab(body.tab) }); }
    if (a === 'drive_get')    return json(driveGet(body));
    if (a === 'llm_next')     return json({ ok: true, provider: nextProvider() });
    if (a === 'llm_config')   return json(llmConfigGet());                         // the pipeline reads the same choice
    if (a === 'llm_models')   { needAdmin(); return json(llmModels(!!body.fresh)); }
    if (a === 'llm_test')     { needAdmin(); return json(llmTest(body)); }          // one real call, no Sheet write
    if (a === 'llm_config_save') { needAdmin(); return json(llmConfigSave(body)); } // validates first, locks only for the write
    if (a === 'llm')          return json(llmProxy(body));
    if (a === 'vision_read')  return json(visionRead(body));                       // the pipeline reads a picture OCR could not (ingest token)
    if (a === 'img_config')   { needAdmin(); return json(kiosConfig(!!body.fresh)); }
    if (a === 'img_config_save') { needAdmin(); return json(kiosConfigSave(body)); }
    if (a === 'img_test')     { needAdmin(); return json(kiosTest(body)); }
    if (a === 'heartbeat')    return json(heartbeat(body));
    if (a === 'progress')     return json(saveProgress(body));
    if (a === 'poster_from_drive') return json(posterFromDrive(body.id));
    if (a === 'raw_stats')    { var rs0 = rawStats(); rs0.ok = true; return json(rs0); }
    if (a === 'pipeline_status') { needAdmin(); return json(pipelineStatus()); }
    if (a === 'requeue_files') { needAdmin(); return json(requeueFiles()); } // writes only status cells, no lock
    if (a === 'event_from_poster') { needAdmin(); return json(eventFromPoster(body)); } // stores the poster and reads it; no Sheet write
    if (a === 'faq_rephrase')  { needAdmin(); return json(faqRephrase(body)); } // model call, no Sheet write
    if (a === 'logo_upload')   { needAdmin(); return json(logoUpload(body)); } // Drive only
    if (a === 'cert_files')    { needAdmin(); return json(certFilesCheck(!!body.fresh)); }  // reads Drive, writes nothing
    // Admin lists of FHCB and Directory, hidden rows included (the public feed drops them).
    if (a === 'rows_list')     { needAdmin(); if (!ROW_FIELDS[body.tab]) throw new Error('unknown tab'); return json({ ok: true, rows: readTab(body.tab) }); }

    // A chat-export .txt can hold tens of thousands of messages: import it
    // without the write lock, so Run now, events and deletes are not blocked
    // while it runs (it took several minutes on 14 Oct 2026).
    if (a === 'manual_upload' && body.b64 && /\.txt$/i.test(String(body.name || ''))) { needAdmin(); var mc = manualUpload(body, sessEmail || 'token'); mc.run = autoRun('process_whatsapp'); return json(mc); }

    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      if (a === 'admins_set')    { needAdmin(); return json(setAdminEmails(body.emails || [])); }
      if (a === 'manual_upload') { needAdmin(); var mu = manualUpload(body, sessEmail || 'token'); mu.run = autoRun(mu.chat ? 'process_whatsapp' : 'uploads'); return json(mu); }
      if (a === 'review_set')    { needAdmin(); return json(reviewSet(body.tab, body.id, body.status)); }
      if (a === 'review_save')   { needAdmin(); return json(reviewSave(String(body.tab || ''), String(body.id || ''), body.fields || {})); }
      if (a === 'settings')      { needAdmin(); return json(writeSettings(stripLlm(body.settings || {}))); }
      if (a === 'ref_upload')    { needAdmin(); var ru = refUpload(body, sessEmail || 'token'); ru.run = autoRun('references'); return json(ru); }
      if (a === 'ref_set')       { needAdmin(); var rs = refSet(body.id, body.status); if (body.status === 'pending') rs.run = autoRun('references'); return json(rs); }
      if (a === 'event_save')    { needAdmin(); return json(eventSave(body)); }
      if (a === 'vacancy_save')  { needAdmin(); return json(vacancySave(body)); }
      if (a === 'content_add')   { needAdmin(); return json(contentAdd(body.tab, body.fields || {})); }
      if (a === 'run_now')       { needAdmin(); return json(runNow(body)); }
      if (a === 'admin_delete')  { needAdmin(); return json(adminDelete(String(body.tab || ''), String(body.id || ''))); }
      if (a === 'poster_upload') { needAdmin(); return json(posterUpload(body)); }
      if (a === 'row_save')      { needAdmin(); return json(rowSave(String(body.tab || ''), body.row || {})); }
      if (a === 'seed_rows')     { needAdmin(); return json(seedRows(String(body.tab || ''), body.rows || [])); }
      if (a === 'fhcb_doc_upload') { needAdmin(); return json(fhcbDocUpload(body, sessEmail || 'token')); }
      if (a === 'ingest')        return json(ingest(body.rows || []));
      if (a === 'raw_update')    return json(updateByIds('Raw', body.ids || [], body.patch || {}));
      if (a === 'upsert')        { if (WRITABLE.indexOf(body.tab) < 0) throw new Error('tab not writable'); return json(upsert(body.tab, body.rows || [])); }
      if (a === 'delete')        { if (WRITABLE.indexOf(body.tab) < 0) throw new Error('tab not writable'); return json(deleteByIds(body.tab, body.ids || [])); }
      if (a === 'ref_chunks')    return json(refChunks(body));
      if (a === 'run_log')       { sheet('Runs').appendRow([new Date().toISOString(), String(body.job || '').slice(0, 80), body.provider || '', body.model || '', body.processed || 0, !!body.ok, String(body.error || '').slice(0, 500)]); return json({ ok: true }); }
      if (a === 'drive_upload')  return json(driveUpload(body));
      if (a === 'drive_file')    return json(driveFile(body));
      return json({ ok: false, error: 'unknown action ' + a });
    } finally { lock.releaseLock(); }
  } catch (err) { return json({ ok: false, error: String(err && err.message || err) }); }
}

// Fixed-window counter in the script cache: true while under max per window.
function rate(key, max, windowSec) {
  var c = CacheService.getScriptCache(), k = 'rl_' + key + '_' + Math.floor(Date.now() / 1000 / windowSec);
  var n = parseInt(c.get(k) || '0', 10) + 1;
  c.put(k, String(n), windowSec + 5);
  return n <= max;
}

// ---------- Admin sign-in: one-time code to a registered email ----------
function adminEmails() {
  return String(props().getProperty('ADMIN_EMAILS') || '').toLowerCase().split(/[\s,;]+/).filter(String);
}

function setAdminEmails(list) {
  var owner = Session.getEffectiveUser().getEmail().toLowerCase();
  var clean = list.map(function (x) { return String(x).trim().toLowerCase(); }).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  if (clean.indexOf(owner) < 0) clean.unshift(owner); // the owner can never lock themselves out
  props().setProperty('ADMIN_EMAILS', clean.join(','));
  return { ok: true, emails: clean };
}

// The answer is the same whether or not the email is registered, so the
// form cannot be used to discover who the admins are.
function loginRequest(email) {
  email = String(email || '').trim().toLowerCase();
  var generic = { ok: true, message: 'If this email is registered, a 6-digit code has been sent. It works for 10 minutes.' };
  if (adminEmails().indexOf(email) < 0) return generic;
  var c = CacheService.getScriptCache();
  if (c.get('otp_rl_' + email)) return generic; // one code a minute
  if (!rate('otp_' + email, 5, 3600) || !rate('otp_all', 40, 3600)) return generic; // and a few an hour
  // Utilities.getUuid() is backed by a CSPRNG (unlike Math.random, which is
  // not safe for anything security-sensitive); derive the 6-digit code from
  // it instead of rolling it with Math.random.
  var rand = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16);
  var code = String(100000 + (rand % 900000));
  c.put('otp_' + email, code + '|0', 600);
  c.put('otp_rl_' + email, '1', 60);
  MailApp.sendEmail({ to: email, subject: 'Halal Executive admin code: ' + code,
    body: 'Your sign-in code for the Halal Executive admin panel is ' + code + '.\n\nIt works for 10 minutes. If you did not ask for it, ignore this email.\n\nhalalexecutive.kkmhalalconsultant.com' });
  return generic;
}

function loginVerify(email, code) {
  email = String(email || '').trim().toLowerCase();
  var c = CacheService.getScriptCache(), v = c.get('otp_' + email);
  if (!v) return { ok: false, error: 'The code has expired. Ask for a new one.' };
  var parts = v.split('|'), tries = parseInt(parts[1], 10) + 1;
  if (String(code || '').trim() !== parts[0]) {
    if (tries >= 5) { c.remove('otp_' + email); return { ok: false, error: 'Too many wrong codes. Ask for a new one.' }; }
    c.put('otp_' + email, parts[0] + '|' + tries, 600);
    return { ok: false, error: 'That code is not right. Check the latest email.' };
  }
  c.remove('otp_' + email);
  var session = newToken(), P = props(), now = Date.now();
  // Drop expired sessions while we are here.
  var all = P.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('sess_') === 0) { try { if (JSON.parse(all[k]).x < now) P.deleteProperty(k); } catch (e) { P.deleteProperty(k); } } });
  P.setProperty(sessKey(session), JSON.stringify({ e: email, x: now + SESSION_MS }));
  return { ok: true, session: session, email: email, expires_in: SESSION_MS / 1000 };
}

// Admin sessions live in Script Properties, not the cache: the cache may drop
// an entry early, which signed people out of Admin (and out of a second tab)
// at random. A session lasts 7 days from its last use, so a working admin stays
// signed in on that browser until they press Sign out or stop using it for a
// week. Only a hash of the session id is stored.
var SESSION_MS = 7 * 24 * 3600 * 1000;
function sessKey(session) { return 'sess_' + sha256(Utilities.newBlob(String(session)).getBytes()).slice(0, 40); }
function sessionEmail(session) {
  if (!session) return null;
  var P = props(), k = sessKey(session), raw = P.getProperty(k);
  if (!raw) return null;
  var s; try { s = JSON.parse(raw); } catch (e) { return null; }
  var now = Date.now();
  if (!s.e || s.x < now) { P.deleteProperty(k); return null; }
  if (adminEmails().indexOf(s.e) < 0) return null; // removed from the list = signed out
  if (s.x - now < SESSION_MS - 3600 * 1000) P.setProperty(k, JSON.stringify({ e: s.e, x: now + SESSION_MS })); // slide, at most hourly
  return s.e;
}

// "Run the AI now" from Admin: asks GitHub to start the Pipeline at once
// instead of waiting for the next :10 / :40 slot. Needs a fine-grained GitHub
// token with Actions: read and write on this repository, saved as the Script
// Property GITHUB_TOKEN (never in the page).
var GH_REPO = 'wanshah07/halal-executive';
function runNow(b) {
  var job = ['process_whatsapp', 'uploads', 'references', 'news', 'organise', 'sahkan', 'process_facebook', 'event_qr'].indexOf(b.job) >= 0 ? b.job : 'process_whatsapp';
  var token = props().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Run now is not set up yet: add a GitHub token as the Script Property GITHUB_TOKEN (see SETUP.md).');
  if (!rate('run_now', 1, 120)) throw new Error('A run was started less than 2 minutes ago. It is on its way.');
  dispatchRun(job, token);
  return { ok: true, job: job, message: 'Started. Results show here in 2-4 minutes.' };
}

function dispatchRun(job, token) {
  token = token || props().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is not set in Script Properties.');
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/actions/workflows/pipeline.yml/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main', inputs: { job: job } }),
  });
  var code = r.getResponseCode();
  if (code !== 204) throw new Error('GitHub refused the run (' + code + '): ' + r.getContentText().slice(0, 160));
  props().setProperty('last_dispatch', JSON.stringify({ job: job, ts: new Date().toISOString() }));
}

// Start a run straight after an admin action (upload, Re-read) instead of
// waiting for the timer. Never fails the action itself.
function autoRun(job) {
  try {
    if (!props().getProperty('GITHUB_TOKEN')) return 'next scheduled run';
    if (!rate('auto_' + job, 1, 90)) return 'already starting';
    dispatchRun(job); return 'started';
  } catch (e) { return 'next scheduled run (' + String(e.message || e).slice(0, 80) + ')'; }
}

// Finished events are deleted for good (Wan, 14 Oct 2026): the row, and the
// poster file if it was uploaded to Drive "30 Posters". An event is finished
// a day after its end (or start, when it has no end). Runs with the 30-minute
// timer; publicData already hides them in between.
function eventOver(e, now) {
  // A Malaysian date (DD/MM/YYYY) is read day-first before anything else:
  // Date.parse would read 05/11/2026 as 11 May (US order).
  var v = e.date_end || e.date_start, m = String(v || '').match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  var t = v instanceof Date ? v.getTime() : m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : Date.parse(v);
  return !isNaN(t) && t + 24 * 3600 * 1000 < now;
}
function purgePastEvents() {
  var now = Date.now(), evs = readTab('Events'), gone = evs.filter(function (e) { return eventOver(e, now); });
  // AI drafts taken from a message more than 120 days old (the chat-export
  // backlog) are past events too, whatever year the model guessed (Wan, 15 Oct 2026).
  var stale = evs.filter(function (e) { return e.status === 'draft' && e.source && e.source !== 'admin' && gone.indexOf(e) < 0; });
  if (stale.length) {
    var sh = sheet('Raw'), n = sh.getLastRow() - 1, C = TABS.Raw, ts = {};
    if (n > 0) {
      var ids = sh.getRange(2, 1, n, 1).getValues(), when = sh.getRange(2, C.indexOf('ts') + 1, n, 1).getValues();
      for (var i = 0; i < n; i++) ts[String(ids[i][0])] = when[i][0];
    }
    stale.forEach(function (e) { var w = ts[String(e.source)]; var t = w instanceof Date ? w.getTime() : Date.parse(w); if (!isNaN(t) && now - t > 120 * 864e5) gone.push(e); });
  }
  if (!gone.length) return 0;
  var posters = folder('30 Posters');
  gone.forEach(function (e) {
    var m = String(e.poster_file || e.poster_url || '').match(/(?:\/d\/|[?&]id=)([\w-]{20,})/);
    if (!m) return;
    // Deleted for good, not put in the Drive bin (Wan, 20 Oct 2026: "permanently deleted").
    try { var f = DriveApp.getFileById(m[1]); if (f.getParents().hasNext() && f.getParents().next().getId() === posters.getId()) removeDriveFile(m[1]); } catch (er) { /* not ours or already gone */ }
  });
  deleteByIds('Events', gone.map(function (e) { return e.id; }));
  return gone.length;
}

// ---------- Delete for good (Admin) ----------
// Hide keeps a row out of the page; Delete removes it from the Sheet and, where
// the row owns a Drive file (a reference, an uploaded poster, a document),
// deletes that file permanently too (skips the Drive bin when the Drive
// service allows it). A reference also loses its passages, so the Q&A forgets
// it. Asked for by Wan, 14 Oct 2026; the page confirms before calling this.
var DELETABLE = ['FAQ', 'Guidelines', 'Events', 'Certificates', 'Documents', 'References', 'News', 'FHCB', 'Directory', 'Vacancies'];
function removeDriveFile(id) {
  if (!id) return false;
  // Never fall back to the Drive bin and still report success: "delete for
  // good" means a failed remove must be surfaced as a failure, not hidden.
  try { Drive.Files.remove(id); return true; } catch (e) {
    Logger.log('removeDriveFile: could not permanently remove ' + id + ': ' + (e && e.message || e));
    return false;
  }
}
function adminDelete(tab, id) {
  if (DELETABLE.indexOf(tab) < 0) throw new Error('Cannot delete from ' + tab);
  var row = readTab(tab).filter(function (r) { return String(r.id) === id; })[0];
  if (!row) throw new Error('Not found (already deleted?)');
  var file = '';
  if (tab === 'References') {
    var sh = sheet('RefChunks'), v = sh.getDataRange().getValues(), width = TABS.RefChunks.length;
    // Build and validate the exact width to write BEFORE clearing anything:
    // if the sheet ever grows an extra column, slicing/padding here means
    // clearContents() can never run ahead of a write that then throws and
    // loses every row in RefChunks.
    var keep = [v[0]].concat(v.slice(1).filter(function (r) { return String(r[1]) !== id; }));
    var toWrite = keep.map(function (row) {
      row = row.slice(0, width);
      while (row.length < width) row.push('');
      return safeRow(row);
    });
    sh.clearContents(); sh.getRange(1, 1, toWrite.length, width).setValues(toWrite);
    file = row.drive_file_id; bumpAnswerVersion();
    // The guideline made from this reference goes too.
    var gl = readTab('Guidelines').filter(function (g) { return String(g.source) === id && String(g.id) === 'GL-' + id; });
    if (gl.length) deleteByIds('Guidelines', gl.map(function (g) { return g.id; }));
  } else if (tab === 'Documents') {
    var owner = readTab('Certificates').filter(function (c) { return String(c.doc_id) === String(row.id); })[0];
    if (owner) throw new Error('This file belongs to the halal certificate ' + (owner.company || owner.id) + '. Delete the certificate instead: that removes its file too.');
    file = row.drive_file_id;
  } else if (tab === 'Events' || tab === 'Vacancies') {
    var m = String(row.poster_file || row.poster_url || '').match(/(?:\/d\/|[?&]id=)([\w-]{20,})/);
    if (m) { try { var f = DriveApp.getFileById(m[1]), par = f.getParents(); if (par.hasNext() && par.next().getId() === folder('30 Posters').getId()) file = m[1]; } catch (e) { /* not ours */ } }
  } else if (tab === 'FHCB' || tab === 'Directory') {
    var lm = String(row.logo_file || '').match(/(?:\/d\/|[?&]id=)([\w-]{20,})/);
    if (lm) { try { var lf = DriveApp.getFileById(lm[1]), lp = lf.getParents(); if (lp.hasNext() && lp.next().getId() === folder('50 Logos').getId()) file = lm[1]; } catch (e) { /* not ours */ } }
  } else if (tab === 'Certificates') {
    // The certificate's document row and file go with it.
    if (row.doc_id) { var cd = readTab('Documents').filter(function (d) { return String(d.id) === String(row.doc_id); })[0]; if (cd) { file = cd.drive_file_id; deleteByIds('Documents', [cd.id]); } }
  }
  var fileGone = file ? removeDriveFile(file) : false;
  deleteByIds(tab, [id]);
  // A deleted FHCB or Directory row is remembered, so "Load" never brings it back.
  if (tab === 'FHCB' || tab === 'Directory') {
    var gone = seedDeleted(); gone[tab + ':' + id] = 1;
    writeSettings({ seed_deleted: JSON.stringify(Object.keys(gone)).slice(0, 45000) });
  }
  return { ok: true, deleted: id, file_deleted: fileGone };
}

// ---------- Progress: what is running now ----------
// Every Pipeline phase (pipeline/phase.py) and every batch of process_raw.py
// writes one line here. Admin → Progress shows the last 40 lines, the queue,
// the GitHub runs and whether WhatsApp is linked, so nothing runs unseen.
function saveProgress(b) {
  var P = props(), log = [];
  try { log = JSON.parse(P.getProperty('progress_log') || '[]'); } catch (e) { log = []; }
  var line = { ts: new Date().toISOString(), job: String(b.job || '').slice(0, 40), state: String(b.state || 'running').slice(0, 10), text: String(b.text || '').slice(0, 160) };
  if (b.done !== undefined) line.done = Number(b.done) || 0;
  if (b.left !== undefined) line.left = Number(b.left) || 0;
  log.push(line); log = log.slice(-40);
  var out = JSON.stringify(log);
  while (out.length > 8500 && log.length > 5) { log.shift(); out = JSON.stringify(log); }
  P.setProperty('progress_log', out);
  return { ok: true };
}

// The last GitHub runs of the Pipeline, read with the same GITHUB_TOKEN that
// starts them (Actions: read is part of the token's Actions permission).
function githubRuns() {
  var token = props().getProperty('GITHUB_TOKEN');
  if (!token) return { error: 'GITHUB_TOKEN not set' };
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/actions/workflows/pipeline.yml/runs?per_page=8', {
    muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (r.getResponseCode() !== 200) return { error: 'GitHub ' + r.getResponseCode() };
  return { runs: (JSON.parse(r.getContentText()).workflow_runs || []).map(function (w) {
    return { n: w.run_number, job: w.display_title, status: w.status, conclusion: w.conclusion, started: w.run_started_at || w.created_at, updated: w.updated_at, url: w.html_url };
  }) };
}

function pipelineStatus() {
  var P = props(), log = [], gh = {};
  try { log = JSON.parse(P.getProperty('progress_log') || '[]'); } catch (e) { log = []; }
  try { gh = githubRuns(); } catch (e) { gh = { error: String(e.message || e) }; }
  var last = null; try { last = JSON.parse(P.getProperty('last_dispatch') || 'null'); } catch (e) { /* none */ }
  return { ok: true, now: new Date().toISOString(), log: log, github: gh, raw: rawStats(), collectors: collectorStatus(), last_dispatch: last, watch: watchState(), llm_speed: llmSpeed() };
}

// ---------- Watchdog ----------
// Every 10 minutes: is the WhatsApp collector still linked and sending its
// 5-minute heartbeat, and are the Pipeline runs passing? When something has
// been wrong for 15 minutes (or 3 runs failed in a row) every admin email
// gets one message; another when it is fixed. Never more than one a problem.
var WATCH_MIN = 15;
function watchState() { try { return JSON.parse(props().getProperty('watch') || '{}'); } catch (e) { return {}; } }
function tickWatch() {
  // Keep the response-rate history of each AI going without anyone on the page.
  try { CacheService.getScriptCache().remove(AI_STATUS_KEY); aiStatus(); } catch (e) { /* the check itself must never stop the watch */ }
  var P = props(), w = watchState(), now = Date.now(), hb = collectorStatus().whatsapp, problems = {};
  if (!hb) problems.whatsapp = 'The WhatsApp collector has never sent a heartbeat.';
  else {
    var age = Math.round((now - Date.parse(hb.ts)) / 60000);
    if (age > WATCH_MIN) problems.whatsapp = 'No WhatsApp heartbeat for ' + age + ' minutes. The VM, pm2 or the WhatsApp link is down. Check: gcloud compute ssh he-whatsapp, then pm2 logs he-whatsapp.';
    else if (hb.state && hb.state !== 'CONNECTED') problems.whatsapp = 'WhatsApp reports state ' + hb.state + ' (not CONNECTED). The phone may have unlinked this device: Linked devices on the phone, then a new QR on the VM.';
  }
  // Telegram is watched once it has checked in for the first time: until then
  // there is nothing to be late, so no mail about a collector nobody set up.
  var tg = collectorStatus().telegram;
  if (tg) {
    var tage = Math.round((now - Date.parse(tg.ts)) / 60000);
    if (tage > WATCH_MIN) problems.telegram = 'No Telegram heartbeat for ' + tage + ' minutes. The collector is down. Check on the server: pm2 logs he-telegram.';
    else if (tg.state && tg.state !== 'CONNECTED') problems.telegram = 'Telegram reports state ' + tg.state + ' (not CONNECTED). Check the bot token and that the bot is still in the group: pm2 logs he-telegram.';
  }
  var gh = {}; try { gh = githubRuns(); } catch (e) { gh = {}; }
  var done = (gh.runs || []).filter(function (r) { return r.status === 'completed'; }).slice(0, 3);
  if (done.length === 3 && done.every(function (r) { return r.conclusion === 'failure'; })) problems.pipeline = 'The last 3 Pipeline runs failed (#' + done.map(function (r) { return r.n; }).join(', #') + '). ' + done[0].url;
  var mail = [];
  ['whatsapp', 'telegram', 'pipeline'].forEach(function (k) {
    var was = w[k] || null;
    if (problems[k] && !was) { w[k] = { since: new Date(now).toISOString(), msg: problems[k] }; mail.push('PROBLEM: ' + problems[k]); }
    else if (problems[k]) { w[k].msg = problems[k]; }
    else if (was) { mail.push('FIXED: ' + k + ' is working again (problem started ' + was.since + ').'); delete w[k]; }
  });
  w.checked = new Date(now).toISOString();
  P.setProperty('watch', JSON.stringify(w));
  if (mail.length) {
    try { MailApp.sendEmail({ to: (adminEmails().length ? adminEmails() : [Session.getEffectiveUser().getEmail()]).join(','), subject: 'Halal Executive watchdog: ' + (Object.keys(problems).length ? 'needs attention' : 'all working again'), body: mail.join('\n\n') + '\n\nAdmin → Progress shows the live state.' }); }
    catch (e) { console.error('watch mail: ' + e); }
  }
  return w;
}

// ---------- The clock ----------
// GitHub's own cron for this repo fired only twice in its first ten hours, so
// Apps Script's time-driven triggers start the Pipeline instead (through
// dispatchRun and the same GITHUB_TOKEN). Run installTriggers() once from the
// editor; run it again after changing the times here. Pipeline cadence is
// rule 14 in CLAUDE.md.
// An expired halal certificate is deleted for good one day after valid_to,
// with its document row and file, like a finished event (Wan, 15 Oct 2026).
function purgeExpiredCerts() {
  // A certificate is never hidden or left as a draft (Wan, 20 Oct 2026): any such row still valid is put back on the site.
  try {
    var back = readTab('Certificates').filter(function (c) { return (c.status === 'hidden' || c.status === 'draft') && !(c.valid_to && eventOver({ date_start: c.valid_to }, Date.now())); }).map(function (c) { return c.id; });
    if (back.length) updateByIds('Certificates', back, { status: 'current' });
  } catch (e) { console.error('cert unhide: ' + e); }
  var now = Date.now(), gone = readTab('Certificates').filter(function (c) { return c.valid_to && eventOver({ date_start: c.valid_to }, now); });
  gone.forEach(function (c) { try { adminDelete('Certificates', String(c.id)); } catch (e) { console.error('cert purge ' + c.id + ': ' + e); } });
  // Certificate files the organiser marked expired, with no certificate row
  // left. Other expired documents (circulars, forms) are only archived, never
  // deleted (rules 6 and 18).
  var linked = {}; readTab('Certificates').forEach(function (c) { if (c.doc_id) linked[String(c.doc_id)] = 1; });
  var docs = readTab('Documents').filter(function (d) { return String(d.status) === 'expired' && String(d.kind) === 'certificate' && !linked[String(d.id)] && d.updated_at && Date.parse(d.updated_at) + 864e5 < now; });
  docs.forEach(function (d) { try { adminDelete('Documents', String(d.id)); } catch (e) { console.error('doc purge ' + d.id + ': ' + e); } });
  return gone.length + docs.length;
}
// A vacancy is over a day after its closing date, or 60 days after it was
// added when the ad gives none. It is then deleted for good with its poster,
// like a finished event (Wan, 20 Oct 2026).
function vacancyOver(v, now) {
  if (v.closing_date) return eventOver({ date_start: v.closing_date }, now);
  var t = Date.parse(v.created_at || v.updated_at || '');
  return !isNaN(t) && now - t > 60 * 864e5;
}
function purgeClosedVacancies() {
  var now = Date.now(), gone = readTab('Vacancies').filter(function (v) { return vacancyOver(v, now); });
  gone.forEach(function (v) { try { adminDelete('Vacancies', String(v.id)); } catch (e) { console.error('vacancy purge ' + v.id + ': ' + e); } });
  return gone.length;
}
function tickPipeline() {
  // Deleting rows shifts the rows below, so the purges hold the same lock as
  // every other write.
  var lock = LockService.getScriptLock();
  if (lock.tryLock(60000)) {
    try {
      try { purgePastEvents(); } catch (e) { console.error('purge: ' + e); }
      try { purgeExpiredCerts(); } catch (e) { console.error('cert purge: ' + e); }
      try { purgeClosedVacancies(); } catch (e) { console.error('vacancy purge: ' + e); }
    } finally { lock.releaseLock(); }
  }
  try { rawTriage(); } catch (e) { console.error('triage: ' + e); }
  dispatchRun('process_whatsapp');
  // Files lane: certificates and documents from the group and from Admin.
  try { dispatchRun('uploads'); } catch (e) { console.error('uploads: ' + e); }
}
function tickNews() { dispatchRun('news'); }
function tickOrganise() { dispatchRun('organise'); }
function tickFacebook() { dispatchRun('process_facebook'); }
function tickReferences() { dispatchRun('references'); }
function installTriggers() {
  var mine = ['tickPipeline', 'tickNews', 'tickOrganise', 'tickFacebook', 'tickReferences', 'tickWatch'];
  ScriptApp.getProjectTriggers().forEach(function (t) { if (mine.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tickPipeline').timeBased().everyMinutes(30).create();   // messages, uploads, references, facts
  ScriptApp.newTrigger('tickNews').timeBased().everyHours(6).create();          // halal news
  ScriptApp.newTrigger('tickOrganise').timeBased().atHour(3).everyDays(1).create(); // Drive organiser, ~3 am MYT
  ScriptApp.newTrigger('tickFacebook').timeBased().atHour(2).everyDays(1).create(); // Facebook pass, ~2 am MYT
  ScriptApp.newTrigger('tickReferences').timeBased().everyHours(3).create();    // review the references until complete
  ScriptApp.newTrigger('tickWatch').timeBased().everyMinutes(10).create();      // WhatsApp linked? runs passing?
  Logger.log('Triggers installed: every 10 min (watchdog), 30 min, 3 h, 6 h, daily 2 am and 3 am.');
}

// ---------- Certificate thumbnails ----------
// Drive's own preview of the certificate, read with the owner's rights and
// handed back as a data URI, so the file itself never has to be shared.
// Preview of a certificate or of a document (Drive id of a Documents row).
// Both are read with the owner's Drive rights, so no file is ever public.
function thumbFor(id) { return /^DOC-/.test(id) ? docThumb(id) : certThumb(id); }
function docThumb(id) {
  var d = readTab('Documents').filter(function (r) { return String(r.id) === id && ['hidden', 'duplicate', 'draft', 'expired', 'inbox'].indexOf(String(r.status)) < 0; })[0];
  if (!d || !d.drive_file_id) return { ok: false, error: 'not found', missing: true };
  return fileThumb(String(d.drive_file_id));
}
// The certificate's own file first, then the file of the document row it points
// to: the two can differ after the organiser re-files a certificate.
function certFileIds(cert) {
  var ids = [], m = String(cert.drive_url || '').match(/\/d\/([\w-]{10,})/);
  if (m) ids.push(m[1]);
  if (cert.doc_id) {
    var doc = readTab('Documents').filter(function (d) { return String(d.id) === String(cert.doc_id); })[0];
    if (doc && doc.drive_file_id && ids.indexOf(String(doc.drive_file_id)) < 0) ids.push(String(doc.drive_file_id));
  }
  return ids;
}
function certThumb(id) {
  var cert = readTab('Certificates').filter(function (r) { return String(r.id) === id && r.status !== 'hidden'; })[0];
  if (!cert) return { ok: false, error: 'not found', missing: true };
  var ids = certFileIds(cert), last = { ok: false, error: 'no file', missing: true };
  for (var i = 0; i < ids.length; i++) { last = fileThumb(ids[i]); if (last.ok) return last; }
  return last;
}
function fileThumb(fileId) {
  var cache = CacheService.getScriptCache(), hit = cache.get('thumb_' + fileId);
  if (hit) return { ok: true, data: hit };
  // A file Drive says does not exist is remembered for 10 minutes, so a page of
  // certificates does not ask Drive again for each visitor.
  if (cache.get('thumb_miss_' + fileId)) return { ok: false, error: 'file not found in Drive', missing: true };
  // A large preview is cached in 90 KB pieces (one cache value holds 100 KB).
  var np = Number(cache.get('thumb_' + fileId + '_n') || 0);
  if (np) {
    var keys = []; for (var k = 0; k < np; k++) keys.push('thumb_' + fileId + '_' + k);
    var got = cache.getAll(keys), all = keys.map(function (x) { return got[x]; });
    if (all.every(function (x) { return x != null; })) return { ok: true, data: all.join('') };
  }
  var data = null;
  try {
    var meta = Drive.Files.get(fileId, { fields: 'thumbnailLink,mimeType' });
    if (meta.thumbnailLink) {
      var r = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s400'), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      if (r.getResponseCode() === 200) data = 'data:' + (r.getHeaders()['Content-Type'] || 'image/png') + ';base64,' + Utilities.base64Encode(r.getContent());
    }
    if (!data && /^image\//.test(meta.mimeType)) {
      var b = DriveApp.getFileById(fileId).getBlob();
      if (b.getBytes().length < 70000) data = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    }
  } catch (e) {
    var why = String(e.message || e), gone = /not found|404/i.test(why);
    if (gone) { try { cache.put('thumb_miss_' + fileId, '1', 600); } catch (x) { /* cache full */ } }
    return { ok: false, error: why, missing: gone };
  }
  if (!data) return { ok: false, error: 'no preview yet' };
  try { if (data.length < 100000) cache.put('thumb_' + fileId, data, 21600); else { var parts = Math.ceil(data.length / 90000), kv = { }; for (var i = 0; i < parts; i++) kv['thumb_' + fileId + '_' + i] = data.slice(i * 90000, (i + 1) * 90000); kv['thumb_' + fileId + '_n'] = String(parts); cache.putAll(kv, 21600); } } catch (e) { /* cache full */ }
  return { ok: true, data: data };
}

// Every certificate for Admin, with whether its file is still in Drive. A file
// in Drive's trash can still be restored; one that is not found has to be
// uploaded again. `missing` is the visible certificates that lost their file.
function certFilesCheck(fresh) {
  var cache = CacheService.getScriptCache(), ck = 'certfiles_' + (props().getProperty('pub_v') || '0');
  if (!fresh) { var hit = cache.get(ck); if (hit) { try { return JSON.parse(hit); } catch (e) { /* build again */ } } }
  var rows = [];
  readTab('Certificates').forEach(function (c) {
    var ids = certFileIds(c), state = ids.length ? 'missing' : 'nofile', seen = '';
    for (var i = 0; i < ids.length && state === 'missing'; i++) {
      try { var m = Drive.Files.get(ids[i], { fields: 'id,trashed' }); if (m && m.trashed) { seen = 'trash'; } else { state = 'ok'; } }
      catch (e) { /* not found */ }
    }
    if (state !== 'ok' && seen === 'trash') state = 'trash';
    rows.push({ id: c.id, company: c.company, cert_no: c.cert_no, scheme: c.scheme, status: c.status, valid_to: c.valid_to, drive_url: c.drive_url, doc_id: c.doc_id || '',
      created_at: c.created_at || '', published_at: c.published_at || '', updated_at: c.updated_at || '', state: state });
  });
  var out = { ok: true, total: rows.length, rows: rows, missing: rows.filter(function (r) { return r.state !== 'ok' && r.status !== 'hidden'; }) };
  try { cache.put(ck, JSON.stringify(out), 300); } catch (e) { /* too large */ }
  return out;
}

// Drafts written by the pipeline wait here for an admin to publish or hide.
var REVIEW_TABS = ['FAQ', 'Events', 'Documents', 'Certificates', 'Guidelines', 'Vacancies'];
function reviewList() {
  var out = {};
  // A published answer with points the references do not state yet goes back
  // to drafts, so it is edited or confirmed before readers see it (Wan, 15 Oct 2026).
  var unconfirmed = readTab('FAQ').filter(function (r) { return r.status === 'published' && String(r.verify_notes || '').length > 2 && String(r.verify_notes) !== '[]'; }).map(function (r) { return r.id; });
  if (unconfirmed.length) updateByIds('FAQ', unconfirmed, { status: 'draft', updated_at: new Date().toISOString() });
  var now = Date.now();
  REVIEW_TABS.forEach(function (t) { out[t] = readTab(t).filter(function (r) { return r.status === 'draft' && !(t === 'Documents' && String(r.kind).toLowerCase() === 'certificate') && !(t === 'Events' && eventOver(r, now)) && !(t === 'Vacancies' && vacancyOver(r, now)) && !(t === 'Certificates' && r.valid_to && eventOver({ date_start: r.valid_to }, now)); }); });
  // Points the pipeline could not confirm from the references library: they
  // were left out of the published answer and wait here until a reference
  // that states them is uploaded.
  var open = readTab('FAQ').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft' && r.status !== 'duplicate' && String(r.verify_notes || '').length > 2; }).map(function (r) {
    var notes = []; try { notes = JSON.parse(r.verify_notes); } catch (e) { notes = [String(r.verify_notes)]; }
    return { id: r.id, question_en: r.question_en, question_bm: r.question_bm, notes: notes, verified_at: r.verified_at };
  }).filter(function (r) { return r.notes.length; });
  return { ok: true, drafts: out, to_confirm: open };
}
function reviewSet(tab, id, status) {
  if (REVIEW_TABS.indexOf(tab) < 0) throw new Error('unknown tab');
  if (tab === 'Certificates' && status !== 'published' && status !== 'current') throw new Error('A halal certificate is never hidden: it shows until it expires, then it is deleted. Delete it instead.');
  if (['published', 'hidden', 'draft', 'current'].indexOf(status) < 0) throw new Error('unknown status');
  if ((tab === 'Certificates' || tab === 'Documents') && status === 'published') status = 'current';
  var patch = { status: status };
  if (TABS[tab].indexOf('updated_at') >= 0) patch.updated_at = new Date().toISOString();
  // An admin publishing an answer confirms it: its open points are cleared,
  // or the next Drafts load would move it straight back.
  if (tab === 'FAQ' && status === 'published') { patch.verify_notes = ''; patch.verified_at = new Date().toISOString(); }
  var r = updateByIds(tab, [id], patch);
  // A certificate and its document are one item: publishing or hiding one does the other.
  try {
    if (tab === 'Certificates') { var c = readTab('Certificates').filter(function (x) { return String(x.id) === id; })[0]; if (c && c.doc_id) updateByIds('Documents', [String(c.doc_id)], patch); }
    if (tab === 'Documents') { var cs = readTab('Certificates').filter(function (x) { return String(x.doc_id) === id; }).map(function (x) { return x.id; }); if (cs.length) updateByIds('Certificates', cs, patch); }
  } catch (e) { /* the main row is set */ }
  return r;
}

// Edit a draft before publishing it. Only the fields a reader sees can be
// changed; links must be http(s).
var EDITABLE = {
  FAQ: ['category', 'subcategory', 'question_en', 'question_bm', 'answer_formal_en', 'answer_layman_en', 'answer_formal_bm', 'answer_layman_bm'],
  Events: ['title', 'title_bm', 'date_start', 'date_end', 'venue', 'link', 'description', 'poster_url', 'poster_file', 'kind'],
  Documents: ['title', 'kind', 'category'],
  Certificates: ['company', 'cert_no', 'scheme', 'state', 'category', 'valid_from', 'valid_to', 'products', 'issuer', 'legal_authority', 'reg_no', 'issue_date', 'office_address', 'factory_address', 'scope'],
  Guidelines: ['category', 'title', 'title_bm', 'issuer', 'summary_en', 'summary_bm', 'link', 'effective_date'],
  News: ['category', 'title', 'url', 'source', 'summary_en', 'summary_bm'],
  Vacancies: VACANCY_FIELDS,
};
// Admin adds a row by hand (Wan, 20 Oct 2026: "allow admin to delete/edit/add
// manually"): the same fields Edit allows, published at once.
var ADD_PREFIX = { FAQ: 'FAQ-M', Guidelines: 'GL-M', Certificates: 'CERT-M', News: 'NEWS-M' };
function contentAdd(tab, fields) {
  if (!ADD_PREFIX[tab]) throw new Error('Cannot add to ' + tab);
  var id = ADD_PREFIX[tab] + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyMMddHHmmss'), now = new Date();
  var first = tab === 'FAQ' ? 'question_en' : tab === 'Certificates' ? 'company' : 'title';
  if (!String(fields[first] || '').trim()) throw new Error('Fill in ' + first.replace('_', ' ') + ' first.');
  var row = { id: id, status: tab === 'Certificates' ? 'current' : 'published' };
  if (TABS[tab].indexOf('created_at') >= 0) row.created_at = now.toISOString();
  if (TABS[tab].indexOf('updated_at') >= 0) row.updated_at = now.toISOString();
  if (tab === 'Guidelines') row.source = 'admin';
  if (tab === 'News') { row.fetched_at = now.toISOString(); row.published_at = now.toISOString(); row.expires_at = new Date(now.getTime() + 72 * 3600e3).toISOString(); delete row.status; }
  if (tab === 'FAQ') { row.confidence = 'high'; row.model = 'admin'; }
  upsert(tab, [row]);
  reviewSave(tab, id, fields);
  return { ok: true, id: id };
}
function reviewSave(tab, id, fields) {
  var allowed = EDITABLE[tab]; if (!allowed) throw new Error('unknown tab');
  var patch = {};
  allowed.forEach(function (k) {
    if (fields[k] === undefined) return;
    var v = String(fields[k] == null ? '' : fields[k]).slice(0, k.indexOf('answer') === 0 || k === 'description' || k.indexOf('summary') === 0 || k === 'products' || k === 'scope' ? 6000 : 500);
    if ((k === 'link' || k === 'url' || k === 'poster_url' || k === 'poster_file' || k === 'apply_link') && v && !/^https?:\/\//i.test(v)) throw new Error(k + ' must start with https://');
    patch[k] = v;
  });
  if (tab === 'Events' && patch.poster_url) { var pl = posterFromLink(patch.poster_url); if (pl) { patch.poster_url = pl.url; patch.poster_file = pl.file; } }
  if (TABS[tab].indexOf('updated_at') >= 0) patch.updated_at = new Date().toISOString();
  return updateByIds(tab, [id], patch);
}

function writeSettings(obj) {
  pubBust();
  var sh = sheet('Settings'), v = sh.getDataRange().getValues(), idx = {};
  v.forEach(function (r, i) { if (i) idx[r[0]] = i + 1; });
  Object.keys(obj).forEach(function (k) {
    if (k === 'llm_turn') return;
    if (idx[k]) sh.getRange(idx[k], 2).setValue(cellSafe(String(obj[k]))); else sh.appendRow([k, cellSafe(String(obj[k]))]);
  });
  return { ok: true, count: Object.keys(obj).length };
}

// Collectors post rows {source, group, msg_id, sender_hash, ts, text, attachments:[{name, mime, b64, sha256}]}.
// Duplicate (source, msg_id) is skipped so a re-run never doubles the queue.
// The same message can arrive twice under different ids: once from a chat
// export (import.js) and once from the live collector, or after a re-link.
// Besides the id, each text message gets a fingerprint (source + minute +
// normalised text); a second copy within a minute either side is skipped.
// Texts under 12 characters ("ok", "terima kasih") are not fingerprinted,
// since different people send those in the same minute.
function rawFp(r) {
  var t = String(r.text || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  var ms = Date.parse(r.ts);
  if (t.length < 12 || isNaN(ms)) return [];
  var h = sha256(Utilities.newBlob(r.source + '|' + t).getBytes()).slice(0, 20), m = Math.floor(ms / 60000);
  return [h + '@' + m, h + '@' + (m - 1), h + '@' + (m + 1)];
}

// Group chatter ("ok", "terima kasih", stickers, greetings) never reaches the
// AI: a message goes to the model only when it has an attachment, or is a
// question, or names something a halal executive works with. The rest is
// stored as skipped with notes "prefilter", so it still blocks duplicates.
var RELEVANT = /halal|haram|sijil|certif|\bcert\b|jakim|jain|\bmain\b|mpphm|mhms|ms ?1500|ms ?2634|ms ?2200|sertu|samak|najis|najs|audit|premis|premise|permohonan|pembaharuan|renew|myehalal|sphm|logo|bahan|ramuan|ingredient|supplier|pembekal|label|kkm|npra|notifikasi|kosmetik|cosmetic|makanan|food|haccp|\bgmp\b|mesti|eksekutif|executive|jawatankuasa|committee|\bsop\b|kursus|latihan|training|seminar|webinar|borang|\bform\b|yuran|\bfee\b|sembelih|slaughter|alkohol|alcohol|gelatin|enzim|enzyme|e-?code|eksport|export|import|pengilang|manufactur|kilang|factory|dapur|kitchen|restoran|restaurant|jenama|brand|produk|product|pindaan|amendment|pekeliling|circular|garis panduan|guideline|standard|akta|act\b|peraturan|regulation/i;
function rawRelevant(text, att) {
  if (att && att.some(function (a) { return a && (a.drive_file_id || a.name); })) return true;
  var t = String(text || '').trim();
  if (t.length < 15) return false;
  return t.indexOf('?') >= 0 || RELEVANT.test(t);
}

// Prefilter rows already in Raw (the chat export imported before the filter
// existed). Runs on the 30-minute timer; touches only rows still "new".
// Admin → Re-read group files: every WhatsApp row that carries a file goes
// back to the fast lane, so posters, certificates and documents read before
// the draft route existed are tracked again. The pipeline matches files by
// Drive id and content hash, so nothing already filed is filed twice.
function requeueFiles() {
  var sh = sheet('Raw'), n = sh.getLastRow() - 1, C = TABS.Raw;
  if (n < 1) return { ok: true, requeued: 0 };
  var st = sh.getRange(2, C.indexOf('status') + 1, n, 1).getValues(), at = sh.getRange(2, C.indexOf('attachments') + 1, n, 1).getValues(),
      src = sh.getRange(2, C.indexOf('source') + 1, n, 1).getValues(), cells = [];
  var col = colLetter(C.indexOf('status') + 1);
  for (var i = 0; i < n; i++) {
    if (src[i][0] === 'manual' || st[i][0] === 'new') continue;
    if (String(at[i][0] || '').indexOf('"drive_file_id"') < 0) continue;
    cells.push(col + (i + 2));
  }
  // Only the file rows' status cells are written, in one call, so rows the
  // pipeline marks meanwhile are never overwritten (and no lock is needed).
  for (var k = 0; k < cells.length; k += 500) sh.getRangeList(cells.slice(k, k + 500)).setValue('new');
  if (cells.length) pubBust();
  return { ok: true, requeued: cells.length, run: cells.length ? autoRun('uploads') : '' };
}
function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function rawTriage() {
  var sh = sheet('Raw'), n = sh.getLastRow() - 1, C = TABS.Raw;
  if (n < 1) return 0;
  var st = sh.getRange(2, C.indexOf('status') + 1, n, 1).getValues(), tx = sh.getRange(2, C.indexOf('text') + 1, n, 1).getValues(),
      at = sh.getRange(2, C.indexOf('attachments') + 1, n, 1).getValues(), no = sh.getRange(2, C.indexOf('notes') + 1, n, 1).getValues(), changed = 0;
  for (var i = 0; i < n; i++) {
    if (st[i][0] !== 'new') continue;
    var att = []; try { att = JSON.parse(at[i][0] || '[]'); } catch (e) { att = []; }
    if (!rawRelevant(tx[i][0], att)) { st[i][0] = 'skipped'; no[i][0] = 'prefilter'; changed++; }
  }
  if (changed) { sh.getRange(2, C.indexOf('status') + 1, n, 1).setValues(st); sh.getRange(2, C.indexOf('notes') + 1, n, 1).setValues(no); pubBust(); }
  return changed;
}

// Rows by status/source without reading the whole tab: two columns to find
// them, then just those rows.
function rawList(status, source, limit, attachments) {
  var sh = sheet('Raw'), n = sh.getLastRow() - 1, C = TABS.Raw, out = [];
  if (n < 1) return out;
  var st = sh.getRange(2, C.indexOf('status') + 1, n, 1).getValues(), src = sh.getRange(2, C.indexOf('source') + 1, n, 1).getValues();
  // attachments true/false: only rows with / without a file (the files lane
  // takes group attachments so certificates appear in minutes).
  var at = attachments === true || attachments === false ? sh.getRange(2, C.indexOf('attachments') + 1, n, 1).getValues() : null;
  for (var i = 0; i < n && out.length < limit; i++) {
    if ((status && st[i][0] !== status) || (source && src[i][0] !== source)) continue;
    if (at) { var has = String(at[i][0] || '').indexOf('"name"') >= 0; if (has !== attachments) continue; }
    var v = sh.getRange(i + 2, 1, 1, C.length).getValues()[0], o = {};
    C.forEach(function (k, j) { o[k] = v[j] instanceof Date ? v[j].toISOString() : v[j]; });
    out.push(o);
  }
  return out;
}

function ingest(rows) {
  var sh = sheet('Raw'), have = {}, fps = {};
  ensureHeader(sh, TABS.Raw);
  // Only the three key columns are read: Raw holds tens of thousands of rows
  // once a chat export is in, and this runs under the lock for every message.
  // Each key remembers its sheet row, so a file can be added to a row later.
  var n = sh.getLastRow() - 1, C = TABS.Raw;
  if (n > 0) {
    var src = sh.getRange(2, C.indexOf('source') + 1, n, 1).getValues(), mid = sh.getRange(2, C.indexOf('msg_id') + 1, n, 1).getValues(), fpc = sh.getRange(2, C.indexOf('fp') + 1, n, 1).getValues();
    for (var i = 0; i < n; i++) { have[src[i][0] + ':' + mid[i][0]] = i + 2; if (fpc[i][0]) fps[fpc[i][0]] = i + 2; }
  }
  var added = 0, skipped = 0, filled = 0, lines = [];
  var aCol = C.indexOf('attachments') + 1, sCol = C.indexOf('status') + 1, nCol = C.indexOf('notes') + 1;
  var save = function (r) {
    return (r.attachments || []).map(function (a) {
      if (a.b64) { var f = saveToInbox(a, r); return { name: f.name, drive_file_id: f.id, drive_url: f.url, mime: a.mime, sha256: a.sha256 || sha256(Utilities.base64Decode(a.b64)) }; }
      return a;
    });
  };
  rows.forEach(function (r) {
    var key = r.source + ':' + r.msg_id, fp = rawFp(r);
    var at = have[key] || (fp.length && (fps[fp[0]] || fps[fp[1]] || fps[fp[2]]));
    if (at === -1) { skipped++; return; } // twice in this same batch
    if (at) {
      // Same message already on file. A chat-export .txt carries no pictures
      // or PDFs, so when the WhatsApp collector sends the same message WITH
      // its file, the file is added to the existing row and the row is read
      // again (14 Oct 2026: posters and certificates were dropped as
      // "already there"). A row that already has its files is left alone.
      var hasFile = (r.attachments || []).some(function (a) { return a.b64; });
      if (hasFile) {
        var cur = []; try { cur = JSON.parse(sh.getRange(at, aCol).getValue() || '[]'); } catch (e) { cur = []; }
        var curHas = cur.some(function (a) { return a && a.drive_file_id; });
        if (!curHas) {
          sh.getRange(at, aCol).setValue(cellSafe(JSON.stringify(save(r))));
          sh.getRange(at, sCol).setValue('new');
          sh.getRange(at, nCol).setValue('file added by the WhatsApp collector');
          filled++; return;
        }
      }
      skipped++; return;
    }
    var att = save(r);
    var keep = rawRelevant(r.text, att);
    lines.push(safeRow([r.source + '-' + r.msg_id, r.source, r.group || '', String(r.msg_id), r.sender_hash || '', r.ts || new Date().toISOString(), r.text || '', JSON.stringify(att), keep ? 'new' : 'skipped', '', '', keep ? '' : 'prefilter', fp[0] || '']));
    have[key] = -1; if (fp.length) fps[fp[0]] = -1; added++;
  });
  // One write for the whole batch (a chat export can hold thousands of rows).
  if (lines.length) sh.getRange(sh.getLastRow() + 1, 1, lines.length, TABS.Raw.length).setValues(lines);
  if (filled) pubBust();
  return { ok: true, added: added, skipped: skipped, filled: filled };
}

function folder(path) {
  var f = DriveApp.getFolderById(props().getProperty('DRIVE_ROOT_ID'));
  path.split('/').filter(String).forEach(function (seg) { var it = f.getFoldersByName(seg); f = it.hasNext() ? it.next() : f.createFolder(seg); });
  return f;
}

function saveToInbox(a, r) {
  var blob = Utilities.newBlob(Utilities.base64Decode(a.b64), a.mime || 'application/octet-stream', a.name || ('file-' + r.msg_id));
  var f = folder('00 Inbox/' + r.source).createFile(blob);
  return { id: f.getId(), url: f.getUrl(), name: f.getName() };
}

// True when the file/folder sits somewhere under DRIVE_ROOT_ID (the "Halal
// Executive" folder this script owns). Walks the parent chain since a file
// can be nested several folders deep ("10 Documents/<category>/…").
function isUnderDriveRoot(node) {
  var rootId = props().getProperty('DRIVE_ROOT_ID');
  if (!rootId) return false;
  var guard = 0;
  while (node && guard++ < 50) {
    var parents = node.getParents();
    if (!parents.hasNext()) return false;
    var parent = parents.next();
    if (parent.getId() === rootId) return true;
    node = parent;
  }
  return false;
}
function assertUnderDriveRoot(node) {
  if (!isUnderDriveRoot(node)) throw new Error('That file is outside the Halal Executive Drive folder.');
}

function driveUpload(b) {
  var f = folder(b.path || '00 Inbox').createFile(Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'application/octet-stream', b.name));
  // folder() always resolves under DRIVE_ROOT_ID, but a belt-and-braces check
  // here means a future change to folder() can never silently widen this.
  assertUnderDriveRoot(f);
  return { ok: true, id: f.getId(), url: f.getUrl(), name: f.getName(), modified: f.getLastUpdated().toISOString() };
}

// Rename, move or archive one Drive file. The organiser uses this to file a
// new version under "10 Documents/<category>" as "YYYY-MM-DD v2 Title.pdf"
// and to move the superseded one to "90 Archive/<category>".
function driveFile(b) {
  var f = DriveApp.getFileById(b.id);
  // The INGEST_TOKEN is shared with the pipeline/collectors; without this
  // check it could rename or move ANY file in the owner's whole Drive, not
  // just the ones this app manages.
  assertUnderDriveRoot(f);
  if (b.name) f.setName(b.name);
  if (b.path) { var dest = folder(b.path); f.moveTo(dest); }
  if (b.description !== undefined) f.setDescription(b.description);
  return { ok: true, id: f.getId(), url: f.getUrl(), name: f.getName(), modified: f.getLastUpdated().toISOString() };
}

// Bytes of one Drive file (base64) plus text where Drive can extract it, so
// the organiser can hash and read a certificate without a service account.
// Bytes of one Drive file (base64) plus its text, so the pipeline can hash
// and read a certificate, a screenshot or an office file without a service
// account. Each format is converted by Drive into a temporary Google file,
// read, then deleted.
function driveGet(b) {
  var f = DriveApp.getFileById(b.id);
  // Same reasoning as driveFile: the token must not be able to read any file
  // in the owner's Drive, only the ones under the app's own root folder.
  assertUnderDriveRoot(f);
  var blob = f.getBlob(), text = '';
  if (b.text) { try { text = extractText(f, blob); } catch (e) { text = '[could not read: ' + (e.message || e) + ']'; } }
  return { ok: true, id: f.getId(), name: f.getName(), mime: blob.getContentType(), size: blob.getBytes().length, modified: f.getLastUpdated().toISOString(), sha256: sha256(blob.getBytes()), text: String(text || '').slice(0, 20000), b64: b.bytes ? Utilities.base64Encode(blob.getBytes()) : '' };
}

var DOC_LIKE = /(pdf|msword|wordprocessingml|opendocument\.text|rtf)/i;
var SHEET_LIKE = /(spreadsheetml|ms-excel|opendocument\.spreadsheet|csv)/i;
var SLIDE_LIKE = /(presentationml|ms-powerpoint|opendocument\.presentation)/i;

function extractText(f, blob) {
  var mime = blob.getContentType() || '', name = f.getName() || '';
  if (/^text\/(plain|markdown|html)/.test(mime) || /\.(txt|md)$/i.test(name)) return blob.getDataAsString();
  var target = null, ocr = false;
  if (/^image\//.test(mime)) { target = 'application/vnd.google-apps.document'; ocr = true; }
  else if (DOC_LIKE.test(mime) || /\.(pdf|docx?|odt|rtf)$/i.test(name)) { target = 'application/vnd.google-apps.document'; ocr = /pdf/i.test(mime) || /\.pdf$/i.test(name); }
  else if (SHEET_LIKE.test(mime) || /\.(xlsx?|ods|csv)$/i.test(name)) target = 'application/vnd.google-apps.spreadsheet';
  else if (SLIDE_LIKE.test(mime) || /\.(pptx?|odp)$/i.test(name)) target = 'application/vnd.google-apps.presentation';
  if (!target) return '';
  var opts = ocr ? { ocrLanguage: 'ms' } : {};
  var tmp = Drive.Files.create({ name: 'read-' + name, mimeType: target }, blob, opts), out = '';
  try {
    if (target.indexOf('document') > 0) out = DocumentApp.openById(tmp.id).getBody().getText();
    else if (target.indexOf('spreadsheet') > 0) {
      SpreadsheetApp.openById(tmp.id).getSheets().forEach(function (sh) {
        out += '## ' + sh.getName() + '\n' + sh.getDataRange().getDisplayValues().map(function (r) { return r.join(' | '); }).join('\n') + '\n';
      });
    } else {
      SlidesApp.openById(tmp.id).getSlides().forEach(function (sl, i) {
        out += '## Slide ' + (i + 1) + '\n';
        sl.getShapes().forEach(function (sh) { try { out += sh.getText().asString() + '\n'; } catch (e) { /* not a text shape */ } });
      });
    }
  } finally { Drive.Files.remove(tmp.id); }
  return out;
}

// Admin upload: one file (or a note alone) becomes a Raw row with source
// "manual", so the same pipeline reads it, writes FAQ entries and files any
// certificate. The hint tells the model what Wan says the file is.
// ---------- WhatsApp chat export uploaded in Admin ----------
// Same parser and the same message ids as collectors/whatsapp/import.js, so a
// message is stored once whether it came from the export, the live collector
// or both (the id or the text fingerprint matches). Senders are hashed.
var CHAT_LINE = /^\u200e?\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP]\.?\s?[mM]\.?)?\]?\s*(?:-\s)?(.*)$/;
function chatDate(d, mo, y, h, mi, se, ap) {
  var Y = Number(y); if (Y < 100) Y += 2000;
  var H = Number(h), pm = ap && /p/i.test(ap), am = ap && /a/i.test(ap);
  if (pm && H < 12) H += 12; if (am && H === 12) H = 0;
  var D = Number(d), M = Number(mo);
  if (M > 12 && D <= 12) { var t = D; D = M; M = t; }
  return new Date(Date.UTC(Y, M - 1, D, H - 8, Number(mi), Number(se || 0))); // MYT -> UTC
}
function parseChatExport(text) {
  var out = [];
  String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(function (raw) {
    var m = raw.match(CHAT_LINE);
    if (m) {
      var rest = m[8], c = rest.indexOf(': ');
      out.push({ ts: chatDate(m[1], m[2], m[3], m[4], m[5], m[6], m[7]), sender: c < 0 ? '' : rest.slice(0, c), text: c < 0 ? rest : rest.slice(c + 2), system: c < 0 });
    } else if (out.length) out[out.length - 1].text += '\n' + raw;
  });
  return out.filter(function (x) { return !x.system && !isNaN(x.ts.getTime()); });
}
function exportHash(s) { return sha256(Utilities.newBlob('halal-executive' + String(s)).getBytes()).slice(0, 16); }
function looksLikeChat(text) {
  var n = 0; String(text).split(/\r?\n/).slice(0, 40).forEach(function (l) { if (CHAT_LINE.test(l) && l.indexOf(': ') > 0) n++; });
  return n >= 3;
}
function importChat(text, fileName) {
  var msgs = parseChatExport(text), rows = [];
  msgs.forEach(function (m) {
    var t = m.text.replace(/<attached:[^>]+>/gi, '').replace(/^\u200e?.+?\.[A-Za-z0-9]{2,5}\s*\((?:file attached|fail dilampirkan)\)\s*$/gim, '').replace(/[\u200e\u200f]/g, '').trim();
    if (!t || /^<Media omitted>$|^<Media tidak disertakan>$/i.test(t)) return;
    rows.push({ source: 'whatsapp', group: 'Chat export', msg_id: 'exp-' + exportHash(m.ts.toISOString() + '|' + m.sender + '|' + m.text), sender_hash: exportHash(m.sender), ts: m.ts.toISOString(), text: t, attachments: [] });
  });
  var r = rows.length ? ingest(rows) : { added: 0, skipped: 0 };
  return { ok: true, chat: true, file: fileName, messages: rows.length, added: r.added, skipped: r.skipped,
    from: msgs.length ? msgs[0].ts.toISOString() : '', to: msgs.length ? msgs[msgs.length - 1].ts.toISOString() : '' };
}

function manualUpload(b, email) {
  // A WhatsApp "Export chat" .txt becomes one row per message instead of one
  // attachment the model would only see the first 6000 characters of. The
  // file itself is kept in Drive (00 Inbox/manual).
  if (b.b64 && (/\.txt$/i.test(b.name || '') || /^text\/plain/.test(b.mime || ''))) {
    var txt = Utilities.newBlob(Utilities.base64Decode(b.b64)).getDataAsString('UTF-8');
    if (looksLikeChat(txt)) {
      folder('00 Inbox/manual').createFile(Utilities.newBlob(Utilities.base64Decode(b.b64), 'text/plain', b.name || 'chat.txt'));
      return importChat(txt, b.name || 'chat.txt');
    }
  }
  var hint = { faq: 'Admin upload: material for the FAQ.', certificate: 'Admin upload: this is a halal certificate. File it as a document of kind certificate.', guideline: 'Admin upload: this is a guideline, circular or standard. Add it to guidelines.', event: 'Admin upload: this is an event or course announcement.', vacancy: 'Admin upload: this is a job vacancy.' }[b.kind] || 'Admin upload.';
  var text = hint + (b.note ? '\n' + String(b.note).slice(0, 4000) : '');
  var row = { source: 'manual', group: 'Admin upload', msg_id: 'up-' + Date.now() + '-' + Math.floor(Math.random() * 1e6), sender_hash: sha256(Utilities.newBlob(email).getBytes()).slice(0, 16), ts: new Date().toISOString(), text: text, attachments: [] };
  if (b.b64) {
    if (b.b64.length > 14 * 1024 * 1024) throw new Error('File too large (max 10 MB).');
    row.attachments.push({ name: b.name || 'upload', mime: b.mime || 'application/octet-stream', b64: b.b64, sha256: '' });
  }
  var r = ingest([row]);
  return { ok: true, added: r.added, msg_id: row.msg_id };
}

function sha256(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}

// Sheets reads a typed value as a formula when it starts with + = - @ (a
// phone number "+61 8 ..." became #ERROR!) and drops the leading zero of
// "068501999". A leading apostrophe stores the text exactly; Sheets never
// shows it and getValues() returns the text without it (15 Oct 2026).
function cellSafe(x) {
  if (typeof x !== 'string') return x;
  return /^[=+@]|^-(?!\d+(\.\d+)?$)|^0\d/.test(x) ? "'" + x : x;
}
function safeRow(r) { return r.map(cellSafe); }
// Uploaded and published stamps (Wan, 18 Oct 2026). created_at is written once,
// when a row first appears; published_at once, the first time its status is a
// visible one (published, current, indexed). A whole-row upsert keeps both, and
// a status change through updateByIds stamps published_at too.
var LIVE_STATUS = { published: 1, current: 1, indexed: 1 };
function keepStamp(x) { return x instanceof Date ? x.toISOString() : (x == null ? '' : String(x)); }
function stampLine(cols, line, old) {
  var ci = cols.indexOf('created_at'), pi = cols.indexOf('published_at'), si = cols.indexOf('status'), now = new Date().toISOString();
  if (ci >= 0 && !line[ci]) line[ci] = (old && keepStamp(old[ci])) || now;
  if (pi >= 0 && !line[pi]) line[pi] = (old && keepStamp(old[pi])) || (si >= 0 && LIVE_STATUS[String(line[si])] ? now : '');
  return line;
}

function upsert(tab, rows) {
  var cols = TABS[tab]; if (!cols) throw new Error('unknown tab ' + tab);
  var sh = sheet(tab); ensureHeader(sh, cols); pubBust();
  var v = sh.getDataRange().getValues(), idx = {};
  v.forEach(function (r, i) { if (i) idx[String(r[0])] = i + 1; });
  var ins = 0, upd = 0;
  rows.forEach(function (r) {
    var line = cols.map(function (c) { var x = r[c]; return x === undefined || x === null ? '' : cellSafe(typeof x === 'object' ? JSON.stringify(x) : x); });
    stampLine(cols, line, r.id && idx[String(r.id)] ? v[idx[String(r.id)] - 1] : null);
    if (r.id && idx[String(r.id)]) { sh.getRange(idx[String(r.id)], 1, 1, cols.length).setValues([line]); upd++; }
    else { sh.appendRow(line); idx[String(r.id)] = sh.getLastRow(); ins++; }
  });
  return { ok: true, inserted: ins, updated: upd };
}

function updateByIds(tab, ids, patch) {
  var cols = TABS[tab], sh = sheet(tab), last = sh.getLastRow(), n = 0; pubBust(); ensureHeader(sh, cols);
  var v = last > 1 ? [[cols[0]]].concat(sh.getRange(2, 1, last - 1, 1).getValues()) : [[cols[0]]]; // id column only
  var want = {}; ids.forEach(function (i) { want[String(i)] = 1; });
  v.forEach(function (r, i) {
    if (!i || !want[String(r[0])]) return;
    Object.keys(patch).forEach(function (k) { var c = cols.indexOf(k); if (c >= 0) sh.getRange(i + 1, c + 1).setValue(cellSafe(patch[k])); });
    var pc = cols.indexOf('published_at');
    if (pc >= 0 && LIVE_STATUS[String(patch.status)]) { var pcell = sh.getRange(i + 1, pc + 1); if (!pcell.getValue()) pcell.setValue(new Date().toISOString()); }
    n++;
  });
  return { ok: true, updated: n };
}

function deleteByIds(tab, ids) {
  var sh = sheet(tab), v = sh.getDataRange().getValues(), want = {}, n = 0; pubBust();
  ids.forEach(function (i) { want[String(i)] = 1; });
  for (var i = v.length - 1; i >= 1; i--) if (want[String(v[i][0])]) { sh.deleteRow(i + 1); n++; }
  return { ok: true, deleted: n };
}

// ---------- LLM: the faster provider leads, each covers the other ----------
// Every call's time is recorded per provider (moving average; a failure
// counts as a slow call). Once both have 3 timed calls, the faster one takes
// 4 calls in 5 and the other 1 in 5, so its time stays measured and the lead
// changes by itself when the other gateway gets quicker (Wan, 14 Oct 2026).
// Before that they alternate. The other provider always covers a failure.
var SPEED_SHARE = 0.8;
function llmSpeed() { try { return JSON.parse(props().getProperty('llm_speed') || '{}'); } catch (e) { return {}; } }
function recordSpeed(name, ms, ok) {
  try {
    var all = llmSpeed(), s = all[name] || { ms: 0, n: 0, fails: 0 };
    var t = ok ? ms : Math.max(ms, (s.ms || 30000) * 1.5, 60000);
    s.ms = s.n ? Math.round(s.ms * 0.7 + t * 0.3) : Math.round(t);
    s.n = Math.min((s.n || 0) + 1, 1000); s.fails = ok ? 0 : (s.fails || 0) + 1; s.at = new Date().toISOString();
    all[name] = s; props().setProperty('llm_speed', JSON.stringify(all));
  } catch (e) { /* timing is a nicety */ }
}
// ---------- Which AI answers: chosen in Admin -> AI model (Wan, 18 Oct 2026) ----------
// Settings keys, written only by llmConfigSave and never in the public feed:
//   llm_mode          auto (speed-led, the default) | AFIQ | MIRELD
//   llm_strict        'true' = no handover to the other provider if the chosen one fails
//   llm_model_<NAME>  main model: an exact id, a comma list, or empty / auto
//   llm_fast_<NAME>   quick model for live questions: same
// The Script Properties <NAME>_MODEL and <NAME>_FAST_MODEL still work when the
// Admin choice is empty. Read from the Sheet at most once in 10 minutes
// (cache), and the cache is dropped the moment a choice is saved.
function cleanModel(v) { v = String(v || '').trim(); return v.toLowerCase() === 'auto' ? '' : v.slice(0, 200); }
function llmCfg() {
  var cache = CacheService.getScriptCache(), hit = cache.get('llm_cfg');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* read again */ } }
  var st = {}; try { st = readSettings(); } catch (e) { /* Sheet busy: automatic */ }
  var cfg = { mode: 'auto', strict: false, model: {}, fast: {} };
  var m = String(st.llm_mode || 'auto').trim().toUpperCase();
  if (PROVIDERS[m]) cfg.mode = m;
  cfg.strict = cfg.mode !== 'auto' && String(st.llm_strict) === 'true';
  Object.keys(PROVIDERS).forEach(function (n) { cfg.model[n] = cleanModel(st['llm_model_' + n]); cfg.fast[n] = cleanModel(st['llm_fast_' + n]); });
  try { cache.put('llm_cfg', JSON.stringify(cfg), 600); } catch (e) { /* cache full */ }
  return cfg;
}
function llmBust() { try { CacheService.getScriptCache().removeAll(['llm_cfg', AI_STATUS_KEY, 'llm_models']); } catch (e) { /* nothing cached */ } }
function stripLlm(st) { Object.keys(st).forEach(function (k) { if (k.indexOf('llm_') === 0) delete st[k]; }); return st; }

function nextProvider() {
  var cfg = llmCfg();
  if (cfg.mode !== 'auto' && props().getProperty(PROVIDERS[cfg.mode].keyProp)) return cfg.mode; // chosen in Admin
  var P = props(), sp = llmSpeed(), a = sp.MIRELD, b = sp.AFIQ;
  if (a && b && a.n >= 3 && b.n >= 3) {
    var fast = a.ms <= b.ms ? 'MIRELD' : 'AFIQ';
    return Math.random() < SPEED_SHARE ? fast : (fast === 'MIRELD' ? 'AFIQ' : 'MIRELD');
  }
  var turn = parseInt(P.getProperty('llm_turn') || '0', 10);
  P.setProperty('llm_turn', String(turn + 1));
  return turn % 2 === 0 ? 'MIRELD' : 'AFIQ';
}

// Chat models in preference order when the model is "auto". Anything not
// listed is still usable: the first chat-looking id from /models wins.
var PREFER = ['glm-5.3', 'kimi-k3', 'deepseek-v4-pro', 'glm-5.2', 'gpt-6-astra', 'claude', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'deepseek', 'qwen', 'llama'];
// Quick models for live questions, tried in this order when fast is asked for.
var FAST = ['glm-5.3-flash', 'deepseek-v4.1-flash', 'deepseek-v4-flash', 'glm-5.3-flashx', 'gpt-4.1-mini', 'gpt-4o-mini', 'claude-haiku'];
var NOT_CHAT = /(embed|image|dall|tts|whisper|audio|moderation|rerank|vision-only)/i;

function listIds(name) {
  var p = PROVIDERS[name], key = props().getProperty(p.keyProp);
  var r = UrlFetchApp.fetch(p.base + '/models', { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error(name + ' /models HTTP ' + r.getResponseCode());
  return (JSON.parse(r.getContentText()).data || []).map(function (m) { return m.id; });
}

// Model for one provider: an exact id, a comma list, or auto. The answer is
// cached for 6 h and dropped the moment the gateway says the model is gone.
// What the model should be, before any checking: Admin's choice, else the
// Script Property, else empty (= pick automatically).
function wantedModel(name, fast) {
  var cfg = llmCfg();
  return String((fast ? cfg.fast[name] || props().getProperty(name + '_FAST_MODEL') : cfg.model[name] || props().getProperty(PROVIDERS[name].modelProp)) || '').trim();
}
// The automatic picks, from a list of ids.
function pickMain(ids, wants) {
  var chat = ids.filter(function (i) { return !NOT_CHAT.test(i); }), pick = null;
  (wants || []).some(function (w) { if (ids.indexOf(w) >= 0) { pick = w; return true; } });
  if (!pick) PREFER.some(function (pre) { pick = chat.filter(function (i) { return i.toLowerCase().indexOf(pre) === 0; })[0] || null; return !!pick; });
  return pick || chat[0] || ids[0] || null;
}
function pickFast(ids) {
  var pick = null;
  FAST.some(function (f) { pick = ids.filter(function (i) { return i.toLowerCase().indexOf(f) === 0; })[0] || null; return !!pick; });
  return pick || ids.filter(function (i) { return /(flash|mini|lite|haiku|turbo)/i.test(i) && !NOT_CHAT.test(i); })[0] || null;
}

// Model for one provider: an exact id, a comma list, or auto. The answer is
// cached for 6 h under a key that includes the wanted value, so a changed
// choice is never served from an old pick; it is dropped the moment the
// gateway says the model is gone, and a withdrawn choice falls back to auto.
function resolveModel(name, fresh, fast) {
  if (fast) return resolveFast(name, fresh);
  var want = wantedModel(name, false) || 'auto', cache = CacheService.getScriptCache(), ck = 'model_' + name + '|' + want.slice(0, 120);
  if (!fresh) { var hit = cache.get(ck); if (hit) return hit; }
  var wants = want.toLowerCase() === 'auto' ? [] : want.split(',').map(function (x) { return x.trim(); }).filter(String);
  if (wants.length === 1 && !fresh) { cache.put(ck, wants[0], 21600); return wants[0]; }
  var pick = pickMain(listIds(name), wants);
  if (!pick) throw new Error(name + ': no models listed');
  cache.put(ck, pick, 21600);
  return pick;
}

// Fast model: Admin's choice or the <NAME>_FAST_MODEL property if set, else the
// first quick model the gateway lists, else the normal pick.
function resolveFast(name, fresh) {
  var forced = wantedModel(name, true).split(',')[0].trim();
  if (forced && !fresh) return forced;
  var ids = [];
  try { ids = listIds(name); } catch (e) { return forced || resolveModel(name, fresh, false); }
  if (forced && ids.indexOf(forced) >= 0) return forced; // still offered; otherwise fall back to the automatic quick pick
  var cache = CacheService.getScriptCache(), ck = 'fast_' + name;
  if (!fresh) { var hit = cache.get(ck); if (hit) return hit; }
  var pick = pickFast(ids) || resolveModel(name, fresh, false);
  cache.put(ck, pick, 21600);
  return pick;
}

function postChat(p, key, model, messages, opts) {
  var payload = { model: model, messages: messages, temperature: (opts && opts.temperature) || 0.2, max_tokens: (opts && opts.max_tokens) || 1200 };
  if (opts && opts.json) payload.response_format = { type: 'json_object' };
  return UrlFetchApp.fetch(p.base + '/chat/completions', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + key }, payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: true });
}

function callProvider(name, messages, opts) {
  var p = PROVIDERS[name], key = props().getProperty(p.keyProp);
  if (!key) throw new Error(name + ' key not set');
  var fast = !!(opts && opts.fast);
  var model = (opts && opts.model) || resolveModel(name, false, fast);
  var r = postChat(p, key, model, messages, opts);
  // Model withdrawn or renamed: re-read /models once and retry with the new pick.
  if ((r.getResponseCode() === 400 || r.getResponseCode() === 404) && /model/i.test(r.getContentText()) && !(opts && opts.model)) {
    var again = resolveModel(name, true, fast);
    if (again !== model) { model = again; r = postChat(p, key, model, messages, opts); }
  }
  if (r.getResponseCode() >= 300) throw new Error(name + ' HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  markProvider(name, model);
  var j = JSON.parse(r.getContentText());
  var text = j.choices && j.choices[0] && j.choices[0].message && (j.choices[0].message.content || '');
  if (!text) throw new Error(name + ' empty completion');
  return { text: text, provider: name, model: model, finish: (j.choices[0].finish_reason || '') };
}

// Automatic: the faster provider leads; Admin can pin one. If the provider that
// leads fails for any reason the other one answers the same request (unless
// Admin turned that off), and the Runs tab records which did.
function complete(messages, opts) {
  var first = nextProvider(), cfg = llmCfg(), order = [first, first === 'MIRELD' ? 'AFIQ' : 'MIRELD'], errs = [];
  if (cfg.strict && cfg.mode === first) order = [first]; // Admin: no handover to the other provider
  for (var i = 0; i < order.length; i++) {
    var t0 = Date.now();
    try {
      var r = callProvider(order[i], messages, opts);
      // A reply cut off by the token limit (thinking models spend part of it
      // before answering): ask the same provider again with twice the room,
      // and hand over to the other one if it is still cut off.
      if (opts && opts.whole && r.finish === 'length') {
        var more = {}; Object.keys(opts).forEach(function (k) { more[k] = opts[k]; });
        more.max_tokens = Math.min(8000, (opts.max_tokens || 1000) * 2);
        r = callProvider(order[i], messages, more);
        if (r.finish === 'length') throw new Error('reply cut off');
      }
      if (opts && opts.json) r.json = parseJson(r.text); // unreadable JSON hands over to the other provider
      recordSpeed(order[i], Date.now() - t0, true);
      if (i) { r.fallback_from = first; r.first_error = errs[0]; }
      return r;
    } catch (e) { recordSpeed(order[i], Date.now() - t0, false); errs.push(order[i] + ': ' + String(e.message || e).slice(0, 200)); }
  }
  throw new Error('both providers failed: ' + errs.join(' | '));
}

function parseJson(text) {
  var t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  var m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) t = m[1].trim();
  try { return JSON.parse(t); } catch (e) {
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('non-JSON completion');
    return JSON.parse(t.slice(a, b + 1));
  }
}

// Last good call per provider, for the robot status cards.
function markProvider(name, model) {
  try { CacheService.getScriptCache().put('ok_' + name, JSON.stringify({ ts: new Date().toISOString(), model: model }), 21600); } catch (e) { /* cache full */ }
}

// ---- Admin -> AI model ----
// Why a call failed: a short code (HTTP status or a word) and a reason class
// the page turns into a sentence (ai_why_* in i18n).
function llmFail(e) {
  var m = String((e && e.message) || e || ''), h = m.match(/HTTP (\d{3})/), c = h ? h[1] : '';
  if (/key not set|no api key/i.test(m)) return { code: 'NO KEY', why: 'key' };
  if (/offers no .* model/i.test(m)) return { code: 'NO MODEL', why: 'nomodel' };
  if (/did not read the picture/i.test(m)) return { code: 'CANNOT READ', why: 'novision' };
  if (c === '401' || c === '403') return { code: 'HTTP ' + c, why: 'auth' };
  if (c === '429') return { code: 'HTTP 429', why: 'limit' };
  if (c === '404' || c === '400') return { code: 'HTTP ' + c, why: /model/i.test(m) ? 'model' : (c === '404' ? 'notfound' : 'other') };
  if (c && c.charAt(0) === '5') return { code: 'HTTP ' + c, why: 'server' };
  if (/empty completion|reply cut off/i.test(m)) return { code: 'EMPTY', why: 'empty' };
  if (/timeout|timed out/i.test(m)) return { code: 'TIMEOUT', why: 'timeout' };
  if (/dns|address unavailable|unable to resolve|could not resolve|connection|unreachable/i.test(m)) return { code: 'NO CONNECTION', why: 'network' };
  return { code: c ? 'HTTP ' + c : 'ERROR', why: 'other' };
}
function llmConfigGet() {
  var cfg = llmCfg(), keys = {};
  Object.keys(PROVIDERS).forEach(function (n) { keys[n] = !!props().getProperty(PROVIDERS[n].keyProp); });
  return { ok: true, mode: cfg.mode, strict: cfg.strict, model: cfg.model, fast: cfg.fast, keys: keys };
}

// What each gateway offers right now, for the pickers, and what automatic
// would choose (so "Auto" can say which model it means today).
function llmModels(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) { var hit = cache.get('llm_models'); if (hit) { try { return JSON.parse(hit); } catch (e) { /* ask again */ } } }
  var out = { ok: true, providers: {} };
  Object.keys(PROVIDERS).forEach(function (n) {
    var s = { key: !!props().getProperty(PROVIDERS[n].keyProp), reachable: false, code: '', why: '', models: [], auto_main: '', auto_fast: '', error: '' };
    if (s.key) {
      try {
        var ids = listIds(n); s.reachable = true;
        s.code = '200'; s.models = ids.filter(function (i) { return !NOT_CHAT.test(i); }).sort();
        s.auto_main = pickMain(ids, []) || ''; s.auto_fast = pickFast(ids) || s.auto_main;
      } catch (e) { var f = llmFail(e); s.error = String(e.message || e).slice(0, 160); s.code = f.code; s.why = f.why; }
    } else { s.code = 'NO KEY'; s.why = 'key'; }
    out.providers[n] = s;
  });
  try { cache.put('llm_models', JSON.stringify(out), 300); } catch (e) { /* too large */ }
  return out;
}

function llmConfigSave(b) {
  var mode = String(b.mode || 'auto').trim(); if (mode.toLowerCase() === 'auto') mode = 'auto';
  if (mode !== 'auto' && !PROVIDERS[mode]) throw new Error('Choose Automatic, Wanshah 1 or Wanshah 2.');
  if (mode !== 'auto' && !props().getProperty(PROVIDERS[mode].keyProp)) throw new Error(mode + ' has no API key in Script Properties, so it cannot be chosen yet.');
  var vals = { llm_mode: mode, llm_strict: mode !== 'auto' && b.strict ? 'true' : 'false' };
  Object.keys(PROVIDERS).forEach(function (n) {
    var m = cleanModel(b.model && b.model[n]), f = cleanModel(b.fast && b.fast[n]), ids = null;
    if (m || f) { try { ids = listIds(n); } catch (e) { ids = null; } } // gateway unreachable: save as typed
    [['model', m], ['fast', f]].forEach(function (x) {
      if (x[1] && ids && x[1].split(',').some(function (w) { return ids.indexOf(w.trim()) < 0; })) throw new Error(x[1] + ' is not offered by ' + n + ' right now.');
    });
    vals['llm_model_' + n] = m; vals['llm_fast_' + n] = f;
  });
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { writeSettings(vals); } finally { lock.releaseLock(); }
  llmBust();
  return llmConfigGet();
}

// One real question to one provider and one exact model, timed. It never
// falls back to the other provider and never touches the speed tally, so the
// answer says whether THIS choice works. A failed test is still a reply (ok:
// true, works:false): the page must see its code and reason, and an ok:false
// reply would reach it as a bare error.
function llmTest(b) {
  var name = String(b.provider || ''); if (!PROVIDERS[name]) throw new Error('unknown provider');
  if (!props().getProperty(PROVIDERS[name].keyProp)) return { ok: true, works: false, provider: name, code: 'NO KEY', why: 'key', ms: 0, error: 'No API key set for ' + name + '.' };
  var model = cleanModel(b.model).split(',')[0].trim(), t0 = Date.now();
  try {
    if (!model) { var ids = listIds(name); model = (b.fast ? pickFast(ids) : null) || pickMain(ids, []); }
    if (b.vision) {
      var vr = callProvider(name, [{ role: 'user', content: [{ type: 'text', text: TEXT_PNG_ASK }, { type: 'image_url', image_url: { url: TEXT_PNG } }] }], { model: model, max_tokens: 700, temperature: 0 });
      var said = String(vr.text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (said.replace(/\s/g, '').indexOf('7391') < 0) throw new Error(name + ' did not read the picture (it said: ' + said.slice(0, 80) + ')');
      rememberSight(name, true);
      return { ok: true, works: true, provider: name, model: vr.model, code: 'HTTP 200', ms: Date.now() - t0, text: said.slice(0, 80), vision: true };
    }
    var r = callProvider(name, [{ role: 'user', content: 'Balas dengan satu perkataan sahaja: sedia.' }], { model: model, max_tokens: 600, temperature: 0 });
    return { ok: true, works: true, provider: name, model: r.model, code: 'HTTP 200', ms: Date.now() - t0, text: String(r.text).replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 120) };
  } catch (e) { var f = llmFail(e); if (b.vision && f.why === 'novision') rememberSight(name, false); return { ok: true, works: false, provider: name, model: model, ms: Date.now() - t0, code: f.code, why: f.why, error: String(e.message || e).slice(0, 240) }; }
}

function llmProxy(b) { var r = complete(b.messages || [], b.opts || {}); return { ok: true, text: r.text, provider: r.provider, model: r.model, fallback_from: r.fallback_from || '' }; }

function chat(b) {
  b.question = String(b.question || '').slice(0, 600);
  b.context = (b.context || []).slice(0, 8).map(function (c) { return { type: String(c.type || '').slice(0, 20), id: String(c.id || '').slice(0, 40), title: String(c.title || '').slice(0, 300), body: String(c.body || '').slice(0, 1500) }; });
  var lang = (qLang(b.question) || (b.lang === 'bm' ? 'bm' : 'en')) === 'bm' ? 'Bahasa Malaysia (Malaysian register: boleh, ubat, syarikat, kualiti; never Indonesian)' : 'English';
  // The page sends its own best matches (FAQ, guidelines, documents, events,
  // certificates, news); the reference passages are added here, so the
  // Assistant covers everything on the site and in the references library.
  var refPass = [];
  try { refPass = retrievePassages(b.question, 5).passages; } catch (e) { refPass = []; }
  var vp = { page: '', passages: [] }; try { vp = pagePassages(b.question); } catch (e) { vp = { page: '', passages: [] }; }
  var all = vp.passages.map(function (p) { return { type: 'reference', id: p.title + ', page ' + p.page, title: p.title + ', page ' + p.page, body: p.text }; }).concat(b.context || []).concat(refPass.map(function (p) { return { type: 'reference', id: p.title + ', page ' + p.page, title: p.title + ', page ' + p.page, body: p.text.slice(0, 1400) }; }));
  var ctx = all.map(function (c, i) { return '[' + (i + 1) + '] (' + c.type + ' ' + c.id + ') ' + c.title + '\n' + c.body; }).join('\n\n');
  var sys = 'You are the Halal Executive assistant for halal executives in Malaysia. Answer ONLY from the numbered context entries (FAQ, guidelines, documents, events, certificates, news and passages from the official references). Cite entries like [1]; for a reference passage also name the document and page. A one-word question (e.g. "warna") means: what do the sources say about it? If the context does not answer, say so in one sentence and suggest the References tab.' + VERIFY_RULE + (vp.page ? PAGE_RULE : '') + ' Keep regulatory terms original (Notifikasi Kosmetik, Garis Panduan, Borang). Never invent a limit, entry number or date; if a number is not in the context, say it is not in the site sources yet and ask the user to find the guideline and page that state it. Reply in ' + lang + ', the language of the question. Be brief but always finish the answer.';
  try {
    var r = complete([{ role: 'system', content: sys }, { role: 'user', content: 'Context:\n' + (ctx || '(none)') + '\n\nQuestion: ' + b.question }], { max_tokens: 1500, fast: true, whole: true });
    return { ok: true, answer: String(r.text).replace(/<think>[\s\S]*?<\/think>/g, '').trim(), provider: r.provider, model: r.model };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// Utility: list models each gateway enables, and which one auto picks.
function listModels() {
  Object.keys(PROVIDERS).forEach(function (n) { try { Logger.log(n + ' auto-picks: ' + resolveModel(n, true)); } catch (e) { Logger.log(n + ' auto-pick failed: ' + e.message); } });
  Object.keys(PROVIDERS).forEach(function (n) {
    var p = PROVIDERS[n], key = props().getProperty(p.keyProp);
    var r = UrlFetchApp.fetch(p.base + '/models', { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
    Logger.log(n + ' ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 800));
  });
}

// Housekeeping trigger (Triggers → time-driven → hourly): drop expired news.
function purgeExpiredNews() {
  var sh = sheet('News'), v = sh.getDataRange().getValues(), col = TABS.News.indexOf('expires_at'), now = Date.now(), n = 0;
  for (var i = v.length - 1; i >= 1; i--) { var x = v[i][col]; var t = x instanceof Date ? x.getTime() : Date.parse(x); if (x && t < now) { sh.deleteRow(i + 1); n++; } }
  Logger.log('purged ' + n);
}

// =====================================================================
// References library: Admin uploads a manual, standard or circular; the
// pipeline (pipeline/index_references.py) splits it into page-numbered
// passages in RefChunks and writes a short summary ("memory") on the
// References row. askReferences() answers questions from those passages
// only, with page citations checked against what was actually retrieved.
// =====================================================================

function refUpload(b, email) {
  if (!b.b64) throw new Error('Choose a file.');
  if (b.b64.length > 34 * 1024 * 1024) throw new Error('File too large (max 25 MB).');
  if (!b.title) throw new Error('Give the reference a title.');
  var f = folder('20 References').createFile(Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'application/pdf', b.name || (b.title + '.pdf')));
  var id = 'REF-' + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyMMddHHmmss');
  upsert('References', [{ id: id, title: String(b.title).slice(0, 200), issuer: String(b.issuer || '').slice(0, 80), edition: String(b.edition || '').slice(0, 40), category: b.category || 'halal',
    drive_file_id: f.getId(), drive_url: f.getUrl(), mime: f.getMimeType(), pages: '', chunks: '', summary_en: '', summary_bm: '', key_points: '', status: 'pending',
    added_by: email, added_at: new Date().toISOString(), indexed_at: '', error: '' }]);
  return { ok: true, id: id };
}

function refSet(id, status) {
  if (['pending', 'hidden', 'indexed'].indexOf(status) < 0) throw new Error('unknown status');
  var r = updateByIds('References', [id], { status: status });
  bumpAnswerVersion();
  return r;
}

// Replace (first call) or extend the passages of one reference in one write.
function refChunks(b) {
  var sh = sheet('RefChunks'), cols = TABS.RefChunks;
  if (b.replace) {
    var v = sh.getDataRange().getValues(), keep = [v[0]];
    for (var i = 1; i < v.length; i++) if (String(v[i][1]) !== String(b.ref_id)) keep.push(v[i]);
    sh.clearContents();
    sh.getRange(1, 1, keep.length, cols.length).setValues(keep.map(safeRow));
  }
  var rows = (b.chunks || []).map(function (c, i) { return safeRow([b.ref_id + '-' + (c.n != null ? c.n : i), b.ref_id, String(c.page), String(c.text).slice(0, 4000), String(c.terms || '').slice(0, 500)]); });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, cols.length).setValues(rows);
  bumpAnswerVersion();
  return { ok: true, written: rows.length };
}

function bumpAnswerVersion() { props().setProperty('ans_v', String(Date.now())); pubBust(); }

// Malay <-> English terms so a question in either language finds passages
// written in the other. Lower-case, single words.
var SYN = {
  sijil: ['certificate', 'certification', 'sphm'], certificate: ['sijil', 'pensijilan'], pensijilan: ['certification', 'sijil'],
  premis: ['premise', 'premises'], premise: ['premis'], premises: ['premis'], produk: ['product'], product: ['produk'],
  pembaharuan: ['renewal', 'renew'], renew: ['pembaharuan', 'pembaharui'], renewal: ['pembaharuan'], tamat: ['expiry', 'expire'], expiry: ['tamat', 'luput'],
  bahan: ['ingredient', 'material', 'raw'], ingredient: ['bahan', 'ramuan'], ramuan: ['ingredient'], mentah: ['raw'],
  pembekal: ['supplier'], supplier: ['pembekal'], pengilang: ['manufacturer'], manufacturer: ['pengilang', 'pengeluar'],
  logo: ['logo'], label: ['label', 'pelabelan'], pelabelan: ['labelling', 'label'], labelling: ['pelabelan'],
  audit: ['audit', 'pemeriksaan'], pemeriksaan: ['inspection', 'audit'], inspection: ['pemeriksaan'],
  sertu: ['sertu', 'cleansing', 'samak'], samak: ['sertu', 'cleansing'], najis: ['najs', 'filth'], najs: ['najis'],
  eksekutif: ['executive'], executive: ['eksekutif'], jawatankuasa: ['committee'], committee: ['jawatankuasa'],
  dalaman: ['internal'], internal: ['dalaman'], jaminan: ['assurance'], assurance: ['jaminan'], sistem: ['system'], system: ['sistem'],
  permohonan: ['application', 'apply'], application: ['permohonan'], apply: ['mohon', 'permohonan'], mohon: ['apply'],
  yuran: ['fee', 'fees', 'caj'], fee: ['yuran', 'caj'], caj: ['fee', 'charge'], tempoh: ['period', 'validity'], validity: ['tempoh', 'sah'],
  kosmetik: ['cosmetic', 'cosmetics'], cosmetic: ['kosmetik'], makanan: ['food'], food: ['makanan'], minuman: ['beverage', 'drink'],
  penyembelihan: ['slaughter', 'slaughtering'], slaughter: ['penyembelihan', 'sembelih'], haiwan: ['animal'], animal: ['haiwan'],
  syarikat: ['company'], company: ['syarikat'], kilang: ['factory', 'plant'], factory: ['kilang'], pekerja: ['worker', 'staff'], staff: ['pekerja', 'kakitangan'],
  muslim: ['muslim', 'islam'], penggantungan: ['suspension'], suspension: ['penggantungan'], penarikan: ['withdrawal', 'revocation'], withdrawal: ['penarikan']
};
var STOP = { the: 1, a: 1, an: 1, of: 1, to: 1, in: 1, is: 1, are: 1, for: 1, and: 1, or: 1, on: 1, with: 1, what: 1, how: 1, do: 1, does: 1, can: 1, i: 1, my: 1, we: 1, our: 1, be: 1, it: 1, this: 1, that: 1,
  yang: 1, dan: 1, di: 1, ke: 1, dari: 1, untuk: 1, adalah: 1, ini: 1, itu: 1, apa: 1, bagaimana: 1, boleh: 1, saya: 1, kami: 1, kita: 1, perlu: 1, ada: 1, tak: 1, tidak: 1, ka: 1, ker: 1, nak: 1, macam: 1, mana: 1 };
function toks(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1 && !STOP[w]; }); }

// Search words for a question in both Malay and English (the references are
// mostly Malay; people ask in either). Cached a day per question.
// The question's own language. The model, left to "answer in the language of
// the question", followed the BM passages instead (14 Oct 2026: four English
// questions answered in BM), so the server decides and says so plainly.
var BM_WORDS = /\b(yang|dan|apa|apakah|adakah|boleh|bolehkah|bagaimana|berapa|siapa|untuk|dengan|perlu|ialah|adalah|tidak|ke|di|dari|daripada|kah|saya|kami|syarikat|sijil|tempoh|bila|mana|mengapa|kenapa|warna|jawatankuasa|dalaman|syarat|premis|produk|pembaharuan|yuran|permohonan|bahan)\b/gi;
var EN_WORDS = /\b(the|what|who|how|is|are|can|does|do|must|should|which|when|where|why|of|for|to|a|an|my|our|company|certificate|valid|apply|colour|color|committee|internal|retailer|requirement|requirements|products?|premises?|renewal|fees?|ingredients?|labell?ing)\b/gi;
function qLang(q) {
  var bm = (q.match(BM_WORDS) || []).length, en = (q.match(EN_WORDS) || []).length;
  return en > bm ? 'en' : bm > en ? 'bm' : '';  // '' = cannot tell (e.g. one word)
}

function expandQuery(q) {
  var cache = CacheService.getScriptCache(), key = 'qx_' + sha256(Utilities.newBlob(toks(q).join(' ')).getBytes()).slice(0, 24), hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var out = [];
  try {
    var r = complete([{ role: 'system', content: 'List the search keywords for this question about Malaysian halal certification, food or cosmetics regulation, in BOTH Bahasa Malaysia (Malaysian, not Indonesian) and English, as they would appear in an official manual (e.g. pindaan, pembaharuan, permohonan, sijil, premis, jenama, amendment, renewal). Return JSON {"terms":["..."]} with 6-16 single words.' },
      { role: 'user', content: q }], { max_tokens: 400, json: true, fast: true, temperature: 0 });
    out = toks(((r.json && r.json.terms) || []).join(' ')).slice(0, 24);
  } catch (e) { out = []; }
  try { cache.put(key, JSON.stringify(out), 86400); } catch (e) { /* ignore */ }
  return out;
}

// Reference passages for a question, best first (used by the References tab
// and by the Assistant). BM25-style score over every passage; the question's
// words are widened with their Malay/English pair and with the fast model's
// search words in both languages. The best k, plus the passage right after
// each of the best three, so a requirement that runs over a passage break
// reaches the model whole.
function retrievePassages(q, k) {
  var refs = {}; readTab('References').forEach(function (r) { if (r.status === 'indexed') refs[r.id] = r; });
  var rows = sheet('RefChunks').getDataRange().getValues().slice(1).filter(function (r) { return refs[r[1]]; });
  if (!rows.length) return { indexed: false, passages: [] };
  // Each passage is split into words once per question, then scored for the
  // question's words. The model is asked for Malay/English search words only
  // when that first pass finds fewer than 4 good passages (it costs a call).
  var toked = rows.map(function (r) { return toks(r[3]); });
  var score = function (terms) {
    var N = rows.length, df = {}, docs = rows.map(function (r, i) { var tf = {}; toked[i].forEach(function (w) { if (terms[w]) tf[w] = (tf[w] || 0) + 1; }); Object.keys(tf).forEach(function (w) { df[w] = (df[w] || 0) + 1; }); return { r: r, tf: tf, len: toked[i].length }; });
    var avg = docs.reduce(function (s, d) { return s + d.len; }, 0) / N;
    docs.forEach(function (d) {
      var sc = 0;
      Object.keys(d.tf).forEach(function (w) { var idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5)); var f = d.tf[w]; sc += terms[w] * idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg)); });
      d.score = sc;
    });
    return { docs: docs, ranked: docs.filter(function (d) { return d.score > 0; }).sort(function (x, y) { return y.score - x.score; }) };
  };
  var terms = {};
  toks(q).forEach(function (w) { terms[w] = 1; (SYN[w] || []).forEach(function (x) { if (!terms[x]) terms[x] = 0.7; }); });
  var res = score(terms);
  var good = res.ranked.length ? res.ranked.filter(function (d) { return d.score >= res.ranked[0].score * 0.35; }).length : 0;
  if (good < 4) {
    var more = expandQuery(q), added = 0;
    more.forEach(function (w) { if (!terms[w]) { terms[w] = 0.8; added++; } });
    if (added) res = score(terms);
  }
  var docs = res.docs, ranked = res.ranked;
  var top = ranked.slice(0, k), have = {};
  top.forEach(function (d) { have[d.r[0]] = 1; });
  ranked.slice(0, 3).forEach(function (d) {
    var m = String(d.r[0]).match(/^(.*-)(\d+)$/); if (!m) return;
    var next = m[1] + (Number(m[2]) + 1);
    if (have[next]) return;
    var nd = docs.filter(function (x) { return String(x.r[0]) === next; })[0];
    if (nd) { top.push(nd); have[next] = 1; }
  });
  return { indexed: true, passages: top.map(function (d, i) { var ref = refs[d.r[1]]; return { n: i + 1, ref_id: d.r[1], page: String(d.r[2]), title: ref.title + (ref.edition ? ' (' + ref.edition + ')' : ''), text: String(d.r[3]).slice(0, 1200) }; }) };
}

// The user names a guideline and a page ("MPPHM 2020 page 14", "MS 1500 muka
// surat 9"): the AI checks their statement against that page only (Wan,
// 19 Oct 2026). Returns the page's passages from the references whose title
// shares a distinctive word with the question, or says the guideline is not in
// the library so the user can upload it.
function pageNamed(q) {
  var m = String(q || '').match(/\b(?:page|pg|p|muka\s*surat|halaman|hlm)\.?\s*(\d{1,4})\b/i);
  return m ? m[1] : '';
}
function pagePassages(q) {
  var pg = pageNamed(q); if (!pg) return { page: '', passages: [], found: false };
  var qt = {}; toks(q).forEach(function (w) { if (w.length >= 3 && !/^\d+$/.test(w) || /^(1500|2634|2200|2020|2019)$/.test(w)) qt[w] = 1; });
  var refs = readTab('References').filter(function (r) { return r.status === 'indexed'; }).map(function (r) {
    var hit = toks(r.title + ' ' + (r.edition || '')).filter(function (w) { return qt[w] && w !== 'page' && w !== 'halaman'; });
    return { ref: r, score: hit.length };
  }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; });
  if (!refs.length) return { page: pg, passages: [], found: false };
  var best = refs[0].score, ids = {}; refs.filter(function (x) { return x.score === best; }).slice(0, 2).forEach(function (x) { ids[x.ref.id] = x.ref; });
  var rows = sheet('RefChunks').getDataRange().getValues().slice(1).filter(function (r) { return ids[r[1]] && String(r[2]) === String(pg); }).slice(0, 4);
  return { page: pg, found: rows.length > 0, passages: rows.map(function (r, i) { var ref = ids[r[1]]; return { n: i + 1, ref_id: r[1], page: String(r[2]), title: ref.title + (ref.edition ? ' (' + ref.edition + ')' : ''), text: String(r[3]).slice(0, 1400) }; }) };
}
var VERIFY_RULE = ' If the passages do not state what is asked, or state only part of it, say exactly what is missing and ask the user to find the specific guideline and page that state it (the document name, clause and page, for example "MPPHM 2020, page 14") and send it back in their next question so you can check it against that page.';
var PAGE_RULE = ' The user named a guideline and a page. Check their statement against THAT page only: say whether the page states it, contradicts it or does not mention it, and quote at most 25 words from it. If no passage for that page is supplied, say the page is not in the library and ask them to upload that guideline in References.';

function askReferences(b) {
  var t0 = Date.now();
  var q = String(b.question || '').trim().slice(0, 600);
  if (q.length < 3) return { ok: false, error: 'Type a question.' };
  // Always the question's language, whatever language the page is set to (Wan: "tak kisah in english or malay").
  var lang = qLang(String(b.question || '')) || (b.lang === 'en' ? 'en' : 'bm');
  var cache = CacheService.getScriptCache();
  var key = 'ans2_' + (props().getProperty('ans_v') || '0') + '_' + lang + '_' + sha256(Utilities.newBlob(toks(q).join(' ')).getBytes()).slice(0, 24);
  var hit = cache.get(key);
  if (hit) { var h = JSON.parse(hit); h.cached = true; h.ms = Date.now() - t0; return h; }

  var found = retrievePassages(q, 7);
  var vp = { page: '', passages: [] }; try { vp = pagePassages(q); } catch (e) { vp = { page: '', passages: [] }; }
  if (vp.page && vp.found) { found.passages = vp.passages.concat(found.passages).slice(0, 8).map(function (p, i) { p.n = i + 1; return p; }); found.indexed = true; }
  if (!found.indexed) return { ok: true, layman: '', details: '', citations: [], none: true, message: 'No references have been indexed yet.', ms: Date.now() - t0 };
  if (!found.passages.length) {
    var none = { ok: true, none: true, layman: '', details: '', citations: [], message: lang === 'bm' ? 'Tiada petikan dalam rujukan yang sepadan dengan soalan ini. Cari garis panduan dan muka surat khusus yang menyatakannya, kemudian tanya semula dengan nama dan muka surat itu.' : 'Nothing in the references matches this question. Find the specific guideline and page that state it, then ask again with its name and page.', ms: Date.now() - t0 };
    return none;
  }
  var passages = found.passages;
  var langRule = lang === 'bm' ? 'Bahasa Malaysia (Malaysian register: boleh, ubat, syarikat, kualiti; never Indonesian)' : lang === 'en' ? 'English' : 'the same language as the question (Bahasa Malaysia or English; Malaysian register, never Indonesian)';
  var sys = 'You answer questions from halal executives in Malaysia using ONLY the numbered passages from official references. ' +
    'Return JSON: {"layman":"2-4 short sentences anyone can follow","details":"precise answer naming the requirement, conditions and exceptions, 3-8 sentences","citations":[{"n":<passage number>,"quote":"exact words from that passage, max 25 words"}],"confidence":"high|medium|low"}. ' +
    'Write both answers in ' + langRule + '. Keep regulatory terms original (Sijil Pengesahan Halal Malaysia, MPPHM, MHMS). Cite every fact with the passage number it came from. ' +
    'If the passages do not answer the question, say so plainly in "layman", leave "details" empty and cite nothing. If they answer only part of it, answer that part and say which part the references do not cover.' + VERIFY_RULE + (vp.page ? PAGE_RULE : '') + ' Never use outside knowledge, never invent a number, clause or page. Always finish every sentence.';
  var user = 'Passages:\n' + passages.map(function (p) { return '[' + p.n + '] ' + p.title + ', page ' + p.page + '\n' + p.text; }).join('\n\n') + '\n\nQuestion: ' + q;
  var r;
  try { r = complete([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 1800, json: true, fast: true, temperature: 0.1, whole: true }); }
  catch (e) { return { ok: false, error: 'The AI did not answer: ' + String(e.message || e).slice(0, 200) }; }
  var j = r.json || {};
  var byN = {}; passages.forEach(function (p) { byN[p.n] = p; });
  // Only citations that point at a passage we actually sent survive.
  var cites = (j.citations || []).map(function (c) { var p = byN[Number(c.n)]; return p ? { ref_id: p.ref_id, title: p.title, page: p.page, quote: String(c.quote || '').slice(0, 220) } : null; }).filter(Boolean);
  var seen = {}; cites = cites.filter(function (c) { var k = c.ref_id + '|' + c.page + '|' + c.quote; if (seen[k]) return false; seen[k] = 1; return true; });
  var out = { ok: true, layman: String(j.layman || '').slice(0, 1500), details: String(j.details || '').slice(0, 4000), citations: cites, confidence: j.confidence || '',
    provider: r.provider, model: r.model, passages: passages.map(function (p) { return { title: p.title, page: p.page }; }), ms: Date.now() - t0 };
  try { cache.put(key, JSON.stringify(out), 21600); } catch (e) { /* too big to cache */ }
  return out;
}


// =====================================================================
// Wanshah 3 (KIOS, https://kiosapi.com/v1): the image expert (Wan, 19 Oct 2026).
// It is NOT in the text rotation of Wanshah 1 and 2 and cannot be pinned for
// answers. Its gateway on Wan's key offers image models only; pictures are read by
// Wanshah 1 or 2 (visionRead), and Wanshah 3 makes a test picture for the Admin
// check. The key is the Script Property
// KIOS_API_KEY; nothing else is needed anywhere. Models are listed from its
// /models: the picker offers image models for "make" and the other chat models
// for "read". Admin's choice is the Settings keys llm_vision_KIOS and
// llm_image_KIOS (stripped from every public output with the other llm_*).
// =====================================================================
var IMAGE_AI = { KIOS: { base: 'https://kiosapi.com/v1', keyProp: 'KIOS_API_KEY', name: 'Wanshah 3' } };
var IMG_ID = /(image|dall|flux|sdxl|stable-?diff|imagen|midjourney|banana|seedream|recraft|ideogram|kolors|cogview|hidream|qwen-image)/i;
var IMG_PREFER = ['gpt-image', 'flux', 'nano-banana', 'seedream', 'imagen', 'dall-e', 'recraft', 'ideogram', 'qwen-image'];
var VISION_PREFER = ['gpt-4o', 'gpt-5', 'gpt-4.1', 'gemini', 'claude', 'qwen', 'glm-4', 'pixtral', 'llava'];
var VISION_OK = /(vision|vl\b|-vl|4o|gpt-5|gpt-4\.1|gemini|claude|pixtral|llava|omni|qwen|glm-4)/i;
var RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO4IydHU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJI2YD1ZaHIvAAAAAElFTkSuQmCC';
// A picture with words in it, for the "can it read pictures" tests: the answer must contain the number.
var TEXT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQQAAABQBAMAAAANThZsAAAAGFBMVEX////w8PDT09O4uLiZmZlqamouLi4UFBSAyEhaAAADeUlEQVR42u2YvW/bRhiHH1JKV5+UBl0pxejMyHK8ynHszE5hdO2SPyBo8kcEKdrdQJquNewgs4PK7pjIX7sbm2thfTBrY/M63JGSaIlfthEEuGchKVF3v3vv/TqBwWAwGAwGg8Fg+KqworvZRmXGH/TaVxptrlaxZgb9Lf1sL9XEYO8wo4TvV9U1eAkstOBPj9Iz+Pxr9Kgvo5SeRbfBS/juJ3Xf2/QB7DUHkB92AexGrSrg/W5cgq2v5dXYB1fithpt2QGw5gXA8lJdTHw5nHHpevf3DkDZ1XOsJr6rJVjuNbtYC5gLn75NfLes9xS42PIqc1OMlQEJID8eeM0HgABckJ2/1xxs9yjdCjaweSr779YPi0q4AILtrVPZ2VUSSgLOd4I3gAPIk73fk6xggfQA5Ha+eV+oUX6GU+DsDOCgBUIt6wTOgTqwDbeSrCCutvVVYNzWfnSRfkqYDb+0nOIS7kHgxSVYQyVWBgk+sFY8KhzlCpoG4E3JwdMlSMB+9ORBMQVlAf1ouvkWBEdjG2yJ9KAM1JZW73aOCkiwh66w0AKgo5cl9PTCT7XChX6luuIWcwU5Jv3DrpZQjxaZvhE7oRkfFpDghmYMuSu0ZcuL9uO0iAsj4jj0n1Irt4KSgO54mXqMihHr/nNnJEYTJchNb2jVAq7gxcqUA+xk/7nyho22H5WLfNRHEtP7F+ttgBbQ9eOZKiU1yc5620+L4amuMJxj0Hmt82XwBpSjymwSQHZeFZFgO6oQRHTDcc9endLvHOkqmpIXNOdegSxdQtWoYQvnC72Q7gbwKEVCrID411KjLmXvIIOEW+5465GHVrxG2WJ0lLKAkyyN28piWC3zSrBEtMrSD1GfJqN1LV0O2cm+YN2f3T+xmyLFaFMSUy88izz5ePCp2dCp0V65vW833WHRSnPH6rK6JhqNH1US+WVijYJqdV7dHAJYzWYUImEBW1jgv9+S3DFebzKwOOk3weiBRe6QIyKg6+VvVy7v3fHow5mXRcJ52DirjJal2ZngCkMFbwE+q6l7r8lyjgi29xuVyozf+8ufdDzImJguNus1KoPBP2pBwcbDWqUfnXHTT9YT+OYp/PvHTR/u7RRPK5Qvc3aeCQaaddOyyg1LUH8d5I7Ra94I4g3Zl5Ag219agjy+eVdI7PIHcu8Qg8FgMBgMBoNB8z/gqQPXUXTMsgAAAABJRU5ErkJggg==';
var TEXT_PNG_ASK = 'Reply with only the word and the number written in this picture.';

function kiosKey() { return props().getProperty(IMAGE_AI.KIOS.keyProp) || ''; }
function kiosFetch(path, opt) {
  var o = opt || {}; o.muteHttpExceptions = true; o.followRedirects = true;
  o.headers = { Authorization: 'Bearer ' + kiosKey() };
  return UrlFetchApp.fetch(IMAGE_AI.KIOS.base + path, o);
}
function kiosIds() {
  var r = kiosFetch('/models');
  if (r.getResponseCode() >= 300) throw new Error('KIOS /models HTTP ' + r.getResponseCode());
  return (JSON.parse(r.getContentText()).data || []).map(function (m) { return m.id; });
}
function pickBy(ids, prefer) {
  var pick = null;
  prefer.some(function (pre) { pick = ids.filter(function (i) { return i.toLowerCase().indexOf(pre) >= 0; })[0] || null; return !!pick; });
  return pick || ids[0] || null;
}
function kiosSplit(ids) {
  var image = ids.filter(function (i) { return IMG_ID.test(i); });
  var chat = ids.filter(function (i) { return !IMG_ID.test(i) && !/(embed|tts|whisper|audio|moderation|rerank)/i.test(i); });
  var vision = chat.filter(function (i) { return VISION_OK.test(i); });
  return { image: image, vision: vision.length ? vision : chat };
}
function kiosWanted(kind) {
  var st = {}; try { st = readSettings(); } catch (e) { /* Sheet busy: automatic */ }
  return cleanModel(st['llm_' + kind + '_KIOS']) || String(props().getProperty(kind === 'image' ? 'KIOS_IMAGE_MODEL' : 'KIOS_VISION_MODEL') || '').trim();
}
// The model to use for 'vision' or 'image': Admin's choice while the gateway
// still offers it, else the automatic pick; cached 6 h like the other robots.
function kiosModel(kind, fresh) {
  var want = kiosWanted(kind), cache = CacheService.getScriptCache(), ck = 'kios_' + kind + '|' + want;
  if (!fresh) { var hit = cache.get(ck); if (hit) return hit; }
  var ids = kiosIds(), sp = kiosSplit(ids), list = kind === 'image' ? sp.image : sp.vision;
  var pick = want && ids.indexOf(want) >= 0 ? want : pickBy(list, kind === 'image' ? IMG_PREFER : VISION_PREFER);
  if (!pick) throw new Error('KIOS offers no ' + (kind === 'image' ? 'image' : 'vision or text') + ' model' + (ids.length ? ' (it offers: ' + ids.slice(0, 8).join(', ') + (ids.length > 8 ? ', …' : '') + ')' : ''));
  cache.put(ck, pick, 21600);
  return pick;
}

// Admin -> Wanshah 3: key, gateway state, the two models and what is on offer.
function kiosConfig(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) { var hit = cache.get('kios_cfg'); if (hit) { try { return JSON.parse(hit); } catch (e) { /* ask again */ } } }
  var out = { ok: true, name: IMAGE_AI.KIOS.name, key: !!kiosKey(), reachable: false, code: '', why: '', error: '', vision: kiosWanted('vision'), image: kiosWanted('image'), vision_models: [], image_models: [], auto_vision: '', auto_image: '' };
  if (!out.key) { out.code = 'NO KEY'; out.why = 'key'; return out; }
  try {
    var ids = kiosIds(), sp = kiosSplit(ids);
    out.reachable = true; out.code = '200';
    out.vision_models = sp.vision.slice().sort(); out.image_models = (sp.image.length ? sp.image : ids).slice().sort();
    out.all_models = ids.slice().sort(); out.chat_ok = sp.vision.length > 0;
    out.auto_vision = pickBy(sp.vision, VISION_PREFER) || ''; out.auto_image = pickBy(sp.image, IMG_PREFER) || '';
  } catch (e) { var f = llmFail(e); out.error = String(e.message || e).slice(0, 160); out.code = f.code; out.why = f.why; }
  try { cache.put('kios_cfg', JSON.stringify(out), 300); } catch (e) { /* too large */ }
  return out;
}
function kiosConfigSave(b) {
  if (!kiosKey()) throw new Error('KIOS_API_KEY is not set in Script Properties, so Wanshah 3 cannot be set up yet.');
  var v = cleanModel(b.vision), im = cleanModel(b.image), ids = null;
  if (v || im) { try { ids = kiosIds(); } catch (e) { ids = null; } }
  [['vision', v], ['image', im]].forEach(function (x) { if (x[1] && ids && ids.indexOf(x[1]) < 0) throw new Error(x[1] + ' is not offered by Wanshah 3 right now.'); });
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { writeSettings({ llm_vision_KIOS: v, llm_image_KIOS: im }); } finally { lock.releaseLock(); }
  try { CacheService.getScriptCache().removeAll(['kios_cfg', AI_STATUS_KEY]); } catch (e) { /* nothing cached */ }
  return kiosConfig(true);
}

// Prove one choice with one real call, timed. A failed test is still a reply
// (ok:true, works:false) so the page can show the code and the reason.
function kiosTest(b) {
  if (!kiosKey()) return { ok: true, works: false, kind: b.kind, code: 'NO KEY', why: 'key', ms: 0, error: 'No KIOS_API_KEY in Script Properties.' };
  var t0 = Date.now(), model = cleanModel(b.model).split(',')[0].trim();
  try {
    if (b.kind === 'image') {
      var g = kiosGenerate({ prompt: 'A plain green circle on a white background, flat vector style.', model: model || undefined, test: true });
      return { ok: true, works: true, kind: 'image', model: g.model, code: 'HTTP 200', ms: Date.now() - t0, bytes: g.bytes, text: g.mime + ', ' + Math.round(g.bytes / 1024) + ' KB' };
    }
    if (b.kind === 'text') {
      var tr = kiosChat({ model: model || undefined, prompt: 'Balas dengan satu perkataan sahaja: sedia.', max_tokens: 400 });
      return { ok: true, works: true, kind: 'text', model: tr.model, code: 'HTTP 200', ms: Date.now() - t0, text: String(tr.text).replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 80) };
    }
    var r = kiosVision({ model: model || undefined, prompt: 'What colour fills this picture? Reply with one word.', url: RED_PNG, max_tokens: 400 });
    return { ok: true, works: true, kind: 'vision', model: r.model, code: 'HTTP 200', ms: Date.now() - t0, text: String(r.text).replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 80) };
  } catch (e) { var f = llmFail(e); return { ok: true, works: false, kind: b.kind, model: model, ms: Date.now() - t0, code: f.code, why: f.why, error: String(e.message || e).slice(0, 240) }; }
}

// Read a picture: one image (a Drive file id, or base64, or a data URL) and a
// question; returns text, and parsed JSON when asked. Drive files that are not
// pictures (a scanned PDF) are read from their first-page preview.
function kiosVision(b) {
  var url = b.url;
  if (!url) {
    var blob = b.id ? driveImageBlob(String(b.id)) : Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'image/png', 'img');
    if (!blob) throw new Error('KIOS has no picture to read');
    if (blob.getBytes().length > 7 * 1024 * 1024) throw new Error('KIOS picture too large (over 7 MB)');
    url = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  }
  var model = b.model || kiosModel('vision', false), msgs = [];
  if (b.system) msgs.push({ role: 'system', content: String(b.system).slice(0, 6000) });
  msgs.push({ role: 'user', content: [{ type: 'text', text: String(b.prompt || 'Describe this picture.').slice(0, 4000) }, { type: 'image_url', image_url: { url: url } }] });
  var r = kiosFetch('/chat/completions', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ model: model, messages: msgs, temperature: 0.1, max_tokens: b.max_tokens || 1500 }) });
  if (r.getResponseCode() >= 300) throw new Error('KIOS HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  var j = JSON.parse(r.getContentText()), text = j.choices && j.choices[0] && j.choices[0].message && (j.choices[0].message.content || '');
  if (!text) throw new Error('KIOS empty completion');
  markProvider('KIOS', model);
  return { text: text, model: model };
}
// Plain text in, text out, on the same vision-capable chat model: proves the
// gateway also reads and writes words (not only pictures).
function kiosChat(b) {
  var model = b.model || kiosModel('vision', false);
  var r = kiosFetch('/chat/completions', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ model: model, messages: [{ role: 'user', content: String(b.prompt).slice(0, 2000) }], temperature: 0.1, max_tokens: b.max_tokens || 600 }) });
  if (r.getResponseCode() >= 300) throw new Error('KIOS HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  var j = JSON.parse(r.getContentText()), text = j.choices && j.choices[0] && j.choices[0].message && (j.choices[0].message.content || '');
  if (!text) throw new Error('KIOS empty completion');
  markProvider('KIOS', model);
  return { text: text, model: model };
}
function driveImageBlob(id) {
  var meta = Drive.Files.get(id, { fields: 'thumbnailLink,mimeType,size' });
  if (/^image\//.test(meta.mimeType)) return DriveApp.getFileById(id).getBlob();
  if (!meta.thumbnailLink) return null;
  var r = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s1600'), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? r.getBlob().setContentType(r.getHeaders()['Content-Type'] || 'image/png') : null;
}
// The pipeline's door (ingest token): never throws a bare error, so a missing
// key or a model that cannot read the picture is an answer the caller handles.
function visionRead(b) {
  var order = visionOrder();
  if (b.ping) return { ok: true, ready: order.length > 0, code: order.length ? '' : 'NO MODEL', via: order[0] || '' };
  if (!order.length) return { ok: true, read: false, ready: false, code: kiosKey() || llmAnyKey() ? 'NO MODEL' : 'NO KEY', why: kiosKey() || llmAnyKey() ? 'nomodel' : 'key' };
  var errs = [], t0 = Date.now(), last = null;
  for (var i = 0; i < order.length; i++) {
    try {
      var r = order[i] === 'KIOS'
        ? kiosVision({ id: b.id, b64: b.b64, mime: b.mime, system: b.system, prompt: b.prompt, max_tokens: 2000 })
        : textVision(order[i], b);
      var out = { ok: true, read: true, provider: order[i], model: r.model, text: r.text, ms: Date.now() - t0 };
      if (b.json) { try { out.json = parseJson(r.text); } catch (e) { out.read = false; out.code = 'NOT JSON'; out.why = 'other'; errs.push(order[i] + ': not JSON'); last = out; continue; } }
      if (i) out.fallback_from = order[0];
      return out;
    } catch (e) { var f = llmFail(e); last = { ok: true, read: false, code: f.code, why: f.why, error: String(e.message || e).slice(0, 240), ms: Date.now() - t0 }; errs.push(order[i] + ': ' + String(e.message || e).slice(0, 120)); }
  }
  last.tried = errs; return last;
}
// Who can read a picture, in order: Wanshah 3 when its gateway lists a model that
// reads; then Wanshah 1 and 2 (their models do: measured 19 Oct 2026, a fresh
// picture's words and shapes read back correctly), the pinned or faster first.
function llmAnyKey() { return Object.keys(PROVIDERS).some(function (n) { return !!props().getProperty(PROVIDERS[n].keyProp); }); }
function visionOrder() {
  // Fixed priority (Wan, 20 Oct 2026: "wanshah 1 > wanshah 3 > wanshah 2"): Wanshah 1
  // first, Wanshah 3 when Wanshah 1 cannot, Wanshah 2 last. A text AI is still only
  // used once it has passed the picture test (canSee).
  // Then (Wan, 20 Oct 2026: "the faster rate robot will automatically function")
  // the fastest of them by their measured response (ping history, avg_ms) goes
  // first; that fixed order only breaks a tie or stands in while nothing is measured.
  var order = [], has = function (n) { return PROVIDERS[n] && props().getProperty(PROVIDERS[n].keyProp) && canSee(n); };
  if (has('AFIQ')) order.push('AFIQ');
  if (kiosKey()) { try { if (kiosModel('vision', false)) order.push('KIOS'); } catch (e) { /* gateway lists no reading model */ } }
  if (has('MIRELD')) order.push('MIRELD');
  var speed = function (n) { try { var st = pingStats(JSON.parse(props().getProperty('ping_' + n) || '[]')); return st.avg_ms == null || st.ok_rate < 80 ? 9e9 : st.avg_ms; } catch (e) { return 9e9; } };
  var rank = {}; order.forEach(function (n, i) { rank[n] = i; });
  var ms = {}; order.forEach(function (n) { ms[n] = speed(n); });
  return order.sort(function (a, b) { return ms[a] - ms[b] || rank[a] - rank[b]; });
}
// A text AI is only asked to read a picture once it has shown it can: the test
// picture's number must come back (llmTest vision). A model that cannot see makes
// up an answer (deepseek-v4-pro invented a sign when no picture was attached), and
// an invented certificate must never reach the page. The verdict is remembered for
// 7 days (Script Property vision_ok_<NAME>), set by the Admin test or here, once.
function canSee(name) {
  var P = props(), key = 'vision_ok_' + name, v = null;
  try { v = JSON.parse(P.getProperty(key) || 'null'); } catch (e) { v = null; }
  if (v && Date.now() - v.t < 7 * 864e5) return !!v.ok;
  var r = llmTest({ provider: name, vision: true });
  // Only "answered without seeing it" is remembered as a no; an outage or a timeout is not, so a
  // gateway that was down for a minute is asked again next time, not ignored for a week.
  if (r && r.works) rememberSight(name, true); else if (r && r.why === 'novision') rememberSight(name, false);
  return !!(r && r.works);
}
// true / false once tested (the Admin test or the first picture to read), null before.
function sightVerdict(name) { try { var v = JSON.parse(props().getProperty('vision_ok_' + name) || 'null'); return v ? !!v.ok : null; } catch (e) { return null; } }
function rememberSight(name, ok) { try { props().setProperty('vision_ok_' + name, JSON.stringify({ ok: !!ok, t: Date.now() })); } catch (e) { /* properties busy */ } }
function textVision(name, b) {
  var blob = b.id ? driveImageBlob(String(b.id)) : Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'image/png', 'img');
  if (!blob) throw new Error(name + ' has no picture to read');
  if (blob.getBytes().length > 7 * 1024 * 1024) throw new Error(name + ' picture too large (over 7 MB)');
  var url = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()), msgs = [];
  if (b.system) msgs.push({ role: 'system', content: String(b.system).slice(0, 6000) });
  msgs.push({ role: 'user', content: [{ type: 'text', text: String(b.prompt || 'Describe this picture.').slice(0, 4000) }, { type: 'image_url', image_url: { url: url } }] });
  var t0 = Date.now();
  try { var r = callProvider(name, msgs, { max_tokens: 2000, temperature: 0.1, whole: true }); recordSpeed(name, Date.now() - t0, true); return r; }
  catch (e) { recordSpeed(name, Date.now() - t0, false); throw e; }
}

function kiosGenerate(b) {
  var prompt = String(b.prompt || '').trim().slice(0, 1500);
  if (prompt.length < 3) throw new Error('Describe the picture first.');
  var model = b.model || kiosModel('image', false), body = { model: model, prompt: prompt, n: 1 };
  var send = function (withFormat) {
    var p = {}; Object.keys(body).forEach(function (k) { p[k] = body[k]; }); if (withFormat) p.response_format = 'b64_json';
    return kiosFetch('/images/generations', { method: 'post', contentType: 'application/json', payload: JSON.stringify(p) });
  };
  var r = send(true);
  if (r.getResponseCode() === 400 && /response_format|unknown|unsupported/i.test(r.getContentText())) r = send(false); // some gateways reject the option
  if (r.getResponseCode() >= 300) throw new Error('KIOS HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  var d = (JSON.parse(r.getContentText()).data || [])[0] || {}, bytes = null, mime = 'image/png';
  if (d.b64_json) bytes = Utilities.base64Decode(d.b64_json);
  else if (d.url && /^https:\/\//.test(d.url)) { var g = UrlFetchApp.fetch(d.url, { muteHttpExceptions: true }); if (g.getResponseCode() === 200) { bytes = g.getContent(); mime = g.getHeaders()['Content-Type'] || mime; } }
  if (!bytes || !bytes.length) throw new Error('KIOS empty completion');
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 || bytes[0] === -1 && bytes[1] === -40) mime = 'image/jpeg';
  markProvider('KIOS', model);
  return { model: model, mime: mime, bytes: bytes.length };
}
// =====================================================================
// Status for the robot cards and the collectors' live indicator.
// =====================================================================
function heartbeat(b) {
  var src = String(b.source || '').replace(/[^a-z]/g, '').slice(0, 20);
  if (!src) throw new Error('source required');
  props().setProperty('hb_' + src, JSON.stringify({ ts: new Date().toISOString(), group: String(b.group || '').slice(0, 80), last_msg: b.last_msg || '', version: String(b.version || '').slice(0, 20), state: String(b.state || '').slice(0, 20) }));
  return { ok: true };
}

function collectorStatus() {
  var all = props().getProperties(), out = {};
  Object.keys(all).forEach(function (k) { if (k.indexOf('hb_') === 0) { try { out[k.slice(3)] = JSON.parse(all[k]); } catch (e) { /* ignore */ } } });
  return out;
}

// Public, cached 5 minutes: which model each provider is on, whether its
// gateway answers, and when it last did real work.
// Response rate on the baseline URL (Wan, 19 Oct 2026): every status check
// pings each AI's own base URL (its /models) and keeps the last 48 results per
// AI in Script Properties, so the robot cards can show the time now, the
// average and how often it answered. tickWatch also checks, every 10 minutes,
// so the history does not depend on someone opening the page.
function pingNote(name, ms, ok) {
  var P = props(), key = 'ping_' + name, h = [];
  try { h = JSON.parse(P.getProperty(key) || '[]'); } catch (e) { h = []; }
  h.push({ t: Date.now(), ms: ms, ok: !!ok }); if (h.length > 48) h = h.slice(-48);
  try { P.setProperty(key, JSON.stringify(h)); } catch (e) { /* properties busy */ }
  return h;
}
function pingStats(h) {
  var good = h.filter(function (x) { return x.ok; });
  return { pings: h.length, ok_rate: h.length ? Math.round(100 * good.length / h.length) : null, avg_ms: good.length ? Math.round(good.reduce(function (s, x) { return s + x.ms; }, 0) / good.length) : null,
           best_ms: good.length ? Math.min.apply(null, good.map(function (x) { return x.ms; })) : null, since: h.length ? new Date(h[0].t).toISOString() : '' };
}
function baseHost(url) { return String(url).replace(/^https?:\/\//, ''); }

function aiStatus() {
  var cache = CacheService.getScriptCache(), hit = cache.get(AI_STATUS_KEY);
  if (hit) return JSON.parse(hit);
  var runs = readTab('Runs');
  var out = { ok: true, checked_at: new Date().toISOString(), mode: llmCfg().mode, strict: llmCfg().strict, providers: {} };
  Object.keys(PROVIDERS).forEach(function (n) {
    var p = PROVIDERS[n], key = props().getProperty(p.keyProp), s = { host: baseHost(p.base), name: n === 'AFIQ' ? 'Wanshah 1' : 'Wanshah 2', provider: n, key: !!key, reachable: false, code: key ? '' : 'NO KEY', model: '', fast_model: '', ms: null, last_used: '', last_ok: '', last_model: '' };
    if (key) {
      var t = Date.now();
      try {
        var r = UrlFetchApp.fetch(p.base + '/models', { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
        s.ms = Date.now() - t; s.reachable = r.getResponseCode() < 300; s.code = String(r.getResponseCode());
      } catch (e) { s.ms = Date.now() - t; s.code = llmFail(e).code; }
      Object.assign(s, pingStats(pingNote(n, s.ms, s.reachable)));
      s.sees = sightVerdict(n);
      try { s.model = resolveModel(n, false, false); s.fast_model = resolveModel(n, false, true); } catch (e) { /* unreachable */ }
    }
    var last = runs.filter(function (x) { return x.provider === n; }).sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); })[0];
    if (last) s.last_used = last.ts;
    var ok = cache.get('ok_' + n); if (ok) { try { var okj = JSON.parse(ok); s.last_ok = okj.ts; s.last_model = okj.model || ''; } catch (e) { /* ignore */ } }
    out.providers[n] = s;
  });
  // Wanshah 3: gateway check and the two models it would use (vision, image).
  var k = { host: baseHost(IMAGE_AI.KIOS.base), name: IMAGE_AI.KIOS.name, provider: 'KIOS', key: !!kiosKey(), reachable: false, code: kiosKey() ? '' : 'NO KEY', model: '', fast_model: '', ms: null, last_used: '', last_ok: '', last_model: '', role: 'image' };
  if (k.key) {
    var kt = Date.now();
    try { var kr = kiosFetch('/models'); k.ms = Date.now() - kt; k.reachable = kr.getResponseCode() < 300; k.code = String(kr.getResponseCode()); } catch (e) { k.ms = Date.now() - kt; k.code = llmFail(e).code; }
    Object.assign(k, pingStats(pingNote('KIOS', k.ms, k.reachable)));
    if (k.reachable) { try { k.model = kiosModel('vision', false); } catch (e) { /* none listed */ } try { k.fast_model = kiosModel('image', false); } catch (e) { /* none listed */ } }
  }
  var kok = cache.get('ok_KIOS'); if (kok) { try { var kj = JSON.parse(kok); k.last_ok = kj.ts; k.last_model = kj.model || ''; } catch (e) { /* ignore */ } }
  k.sees = k.reachable ? !!k.model : null; // Wanshah 3 reads pictures when its gateway lists a model that does
  out.providers.KIOS = k;
  cache.put(AI_STATUS_KEY, JSON.stringify(out), 300);
  return out;
}

// =====================================================================
// Events added from Admin. A poster is stored in Drive "30 Posters" and
// shared view-only by link so the public page can show it.
// =====================================================================
// Posters: any picture (JPG, PNG, WebP, GIF, HEIC from an iPhone, SVG), a PDF,
// or a PowerPoint/Word file such as a Canva export. The file is kept in Drive
// "30 Posters", shared by link, and shown through Drive's own preview image,
// which renders the first page of a PDF or a slide deck as a picture.
var POSTER_TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif|svg\+xml|bmp|tiff)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(presentationml\.presentation|wordprocessingml\.document)|application\/vnd\.ms-powerpoint|application\/msword)$/;
var POSTER_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword' };

function posterStore(b64, name, mime) {
  if (!b64) throw new Error('Choose a poster file.');
  if (b64.length > 14 * 1024 * 1024) throw new Error('Poster too large (max 10 MB).');
  var ext = String(name || '').toLowerCase().split('.').pop();
  mime = String(mime || '').toLowerCase();
  if (!POSTER_TYPES.test(mime)) mime = POSTER_EXT[ext] || '';
  if (!mime) throw new Error('Poster must be an image, PDF, PowerPoint or Word file.');
  var f = folder('30 Posters').createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime, String(name || 'poster').slice(0, 120)));
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (er) { throw new Error('Poster saved in Drive but could not be shared publicly (' + er.message + '). Use a poster link instead.'); }
  var id = f.getId(), web = /^image\/(jpeg|png|webp|gif)$/.test(mime);
  return { id: id, mime: mime,
    url: web ? 'https://lh3.googleusercontent.com/d/' + id : 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600',
    file: 'https://drive.google.com/file/d/' + id + '/view' };
}

// A Google Drive share link pasted as the poster becomes its preview image.
function posterFromLink(u) {
  var m = String(u || '').match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
  return m ? { url: 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1600', file: 'https://drive.google.com/file/d/' + m[1] + '/view' } : null;
}

// A poster posted in the WhatsApp group (already in Drive "00 Inbox"): a
// copy goes to "30 Posters", shared view-only so the event card can show it,
// the same as a poster uploaded in Admin. The inbox original stays private.
function posterFromDrive(fileId) {
  var src = DriveApp.getFileById(String(fileId)), mime = src.getMimeType();
  if (!/^image\/|^application\/pdf$/.test(mime)) throw new Error('not a picture or PDF');
  var f = src.makeCopy(src.getName(), folder('30 Posters'));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var id = f.getId(), web = /^image\/(jpeg|png|webp|gif)$/.test(mime);
  return { ok: true, url: web ? 'https://lh3.googleusercontent.com/d/' + id : 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600', file: 'https://drive.google.com/file/d/' + id + '/view' };
}

// Admin → Events: a poster chosen in the form is stored like any poster, read
// (OCR for pictures and scanned PDFs) and the AI fills the event fields, the
// same way an uploaded halal certificate is read. The admin checks and saves;
// nothing is published by this call (Wan, 15 Oct 2026).
var EVENT_READ = 'You read a poster or announcement for an event in Malaysia (seminar, course, training, talk, expo) for halal executives. Return JSON {"is_event":true|false,"kind":"competency|awareness|executive|auditor|other","title":"","title_bm":"","date_start":"YYYY-MM-DDTHH:MM","date_end":"YYYY-MM-DDTHH:MM or empty","venue":"","link":"","description":""}. kind: competency for a halal competency course (Pensijilan Halal, Jurusertu, SJH), awareness for a halal awareness talk or briefing, executive for a Halal Executive course or certificate, auditor for an internal halal auditor course, else other. Dates in Malaysia time as printed; if the year is not printed use the next date on or after TODAY. Time 09:00 if no time is printed. title in English, title_bm in Bahasa Malaysia (Malaysian, never Indonesian); keep the official name as printed in the language it is printed. venue as printed (or "Online" / the platform). link: a registration or info URL printed on the poster, else empty. description: 2-4 short sentences: organiser, who it is for, fee if printed, contact as printed. Never invent a date, fee or link that is not on the poster.';
// First-page preview of a PDF or Office poster, as a data URL, so the page can
// read a QR code that is part of it (Apps Script cannot decode one itself). A
// picture poster is read from the file the page already holds.
function posterPreview(fileId) {
  try {
    var meta = Drive.Files.get(fileId, { fields: 'thumbnailLink' });
    if (!meta.thumbnailLink) return '';
    var r = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s2000'), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200 || r.getContent().length > 6e6) return '';
    return 'data:' + (r.getHeaders()['Content-Type'] || 'image/png') + ';base64,' + Utilities.base64Encode(r.getContent());
  } catch (e) { return ''; }
}

// One vacancy ad read for the Admin form (Wan, 20 Oct 2026: "AI can read all
// details without fail"). The same prompt as pipeline/prompts.py VACANCY_READ.
// The words first (OCR or the file's text); when they leave the job title or
// every way to apply empty, the picture itself goes to a picture-reading AI
// (visionRead), which fills only the fields still empty.
var VACANCY_READ = "You read one job vacancy advert from Malaysia (a poster, a screenshot or a message) for the halal, food, cosmetic or pharmaceutical industry. Return JSON {\"is_vacancy\":true|false,\"jobs\":[{\"title\":\"\",\"title_bm\":\"\",\"employer\":\"\",\"location\":\"\",\"state\":\"\",\"job_type\":\"\",\"salary\":\"\",\"requirements\":\"\",\"description\":\"\",\"apply_link\":\"\",\"apply_email\":\"\",\"apply_phone\":\"\",\"closing_date\":\"YYYY-MM-DD\",\"category\":\"halal|food|cosmetic\"}]}. One entry per job title in the ad. title is the POSITION (e.g. Pembantu Pentadbir / Administrative Assistant, Halal Executive), never a slogan such as \"We are hiring\", \"Jawatan Kosong\" or \"Join our team\"; when the position is printed only in Malay, put it in title_bm and its English name in title. employer: the company name as printed, else the name in its logo, else the company named by the email domain or website (e.g. info@bluezone.com.my -> Bluezone); empty only when none of these is there. requirements: a plain string, one requirement per line, never a list. Copy every detail exactly as printed: employer, location, state (a Malaysian state name), job type (full-time, contract, internship, part-time), salary as printed, requirements as short lines separated by newlines, description (duties and benefits, 2-5 short sentences), how to apply (link, email, phone exactly as printed in the ad), closing date. title in English as printed, title_bm in Bahasa Malaysia (Malaysian, never Indonesian: syarikat not perusahaan, kualiti not kualitas). If the year of the closing date is not printed use the next such date on or after TODAY. Never invent a salary, date, employer or contact: leave the field empty when the ad does not print it.";
function vacJobs(j) {
  j = j || {};
  if (j.is_vacancy === false) return [];
  var jobs = Object.prototype.toString.call(j.jobs) === '[object Array]' ? j.jobs : (j.title ? [j] : []);
  return jobs.filter(function (x) { return x && String(x.title || '').trim(); });
}
function vacThin(v) { return !v || !String(v.title || '').trim() || !(v.apply_link || v.apply_email || v.apply_phone); }
function vacancyFromPoster(b) {
  var p = posterStore(b.b64, b.name, b.mime), f = DriveApp.getFileById(p.id), text = '';
  try { text = extractText(f, f.getBlob()); } catch (e) { text = ''; }
  var sys = VACANCY_READ.replace('TODAY', Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd'));
  var out = { ok: true, poster_url: p.url, poster_file: p.file, jobs: [], via: [] };
  if (String(text).trim()) {
    try { var r = complete([{ role: 'system', content: sys }, { role: 'user', content: String(text).slice(0, 9000) }], { json: true, max_tokens: 1800, temperature: 0 }); out.jobs = vacJobs(r.json); out.via.push('text:' + r.provider); }
    catch (e) { out.text_error = String(e.message || e).slice(0, 200); }
  }
  if (!out.jobs.length || out.jobs.some(vacThin)) {
    try {
      var v = visionRead({ id: p.id, system: sys, prompt: 'Read every job in this vacancy advert.', json: true });
      var seen = v.read ? vacJobs(v.json) : [];
      if (seen.length) {
        out.via.push('picture:' + v.provider);
        if (!out.jobs.length) out.jobs = seen;
        else out.jobs.forEach(function (job, i) { var q = seen[i] || seen[0]; VACANCY_FIELDS.forEach(function (k) { if (!String(job[k] || '').trim() && q[k]) job[k] = q[k]; }); });
      }
    } catch (e) { out.picture_error = String(e.message || e).slice(0, 200); }
  }
  out.jobs = out.jobs.map(function (job) {
    var o = {};
    VACANCY_FIELDS.forEach(function (k) { if (Object.prototype.toString.call(job[k]) === '[object Array]') job[k] = job[k].join('\n'); if (job[k] != null && job[k] !== '' && k !== 'poster_url' && k !== 'poster_file') o[k] = String(job[k]).slice(0, k === 'description' || k === 'requirements' ? 4000 : 300); });
    if (o.apply_link && !/^https?:\/\//i.test(o.apply_link)) delete o.apply_link;
    if (['halal', 'food', 'cosmetic'].indexOf(o.category) < 0) o.category = 'halal';
    return o;
  });
  out.read = out.jobs.length > 0;
  if (!out.read) out.note = 'No job could be read from this file; fill the fields by hand.';
  return out;
}

function eventFromPoster(b) {
  var p = posterStore(b.b64, b.name, b.mime), f = DriveApp.getFileById(p.id), text = '';
  try { text = extractText(f, f.getBlob()); } catch (e) { text = ''; }
  var out = { ok: true, poster_url: p.url, poster_file: p.file, fields: {}, read: !!String(text).trim() };
  if (!/^image\//.test(p.mime)) out.qr_image = posterPreview(p.id);
  if (!String(text).trim()) { out.note = 'The poster has no readable text; fill the fields by hand.'; return out; }
  var today = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  var r = complete([{ role: 'system', content: EVENT_READ.replace('TODAY', today) }, { role: 'user', content: String(text).slice(0, 8000) }], { json: true, max_tokens: 900, temperature: 0 });
  var j = r.json || {};
  ['title', 'title_bm', 'date_start', 'date_end', 'venue', 'link', 'description', 'kind'].forEach(function (k) { if (j[k]) out.fields[k] = String(j[k]).slice(0, k === 'description' ? 2000 : 300); });
  if (out.fields.kind && ['competency', 'awareness', 'executive', 'auditor', 'other'].indexOf(out.fields.kind) < 0) out.fields.kind = 'other';
  if (out.fields.link && !/^https?:\/\//i.test(out.fields.link)) delete out.fields.link;
  out.is_event = j.is_event !== false; out.provider = r.provider;
  return out;
}

function posterUpload(b) { var p = posterStore(b.b64, b.name, b.mime); return { ok: true, url: p.url, file: p.file }; }

function eventSave(b) {
  var e = b.event || {};
  if (!e.title) throw new Error('Give the event a title.');
  var id = e.id || ('EV-M' + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyMMddHHmmss'));
  var poster = e.poster_url || '', file = e.poster_file || '';
  var fromLink = posterFromLink(poster); if (fromLink) { poster = fromLink.url; file = fromLink.file; }
  if (b.poster_b64) { var p = posterStore(b.poster_b64, b.poster_name, b.poster_mime); poster = p.url; file = p.file; }
  var clean = function (u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u.slice(0, 500) : ''; };
  upsert('Events', [{ id: id, title: String(e.title).slice(0, 200), title_bm: String(e.title_bm || '').slice(0, 200), date_start: e.date_start || '', date_end: e.date_end || '',
    venue: String(e.venue || '').slice(0, 200), poster_url: clean(poster), link: clean(e.link), description: String(e.description || '').slice(0, 2000),
    status: e.status === 'hidden' ? 'hidden' : 'published', source: 'admin', poster_file: clean(file), kind: ['competency', 'awareness', 'executive', 'auditor', 'other'].indexOf(e.kind) >= 0 ? e.kind : 'other' }]);
  return { ok: true, id: id };
}

// ---------- Vacancies (Admin) ----------
// Typed or corrected in Admin; a row with no id is new. Admin rows publish at
// once, like an Admin event.
function vacancySave(b) {
  var v = b.vacancy || {};
  if (!String(v.title || '').trim()) throw new Error('Give the vacancy a job title.');
  var id = v.id || ('VAC-M' + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyMMddHHmmss'));
  var poster = v.poster_url || '', file = v.poster_file || '';
  var fromLink = posterFromLink(poster); if (fromLink) { poster = fromLink.url; file = fromLink.file; }
  if (b.poster_b64) { var p = posterStore(b.poster_b64, b.poster_name, b.poster_mime); poster = p.url; file = p.file; }
  var clean = function (u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u.slice(0, 500) : ''; };
  var row = { id: id, status: v.status === 'hidden' ? 'hidden' : 'published', source: v.source || 'admin', updated_at: new Date().toISOString() };
  VACANCY_FIELDS.forEach(function (k) { row[k] = String(v[k] == null ? '' : v[k]).slice(0, k === 'description' || k === 'requirements' ? 4000 : 300); });
  row.apply_link = clean(row.apply_link); row.poster_url = clean(poster); row.poster_file = clean(file);
  if (['halal', 'food', 'cosmetic'].indexOf(row.category) < 0) row.category = 'halal';
  upsert('Vacancies', [row]);
  return { ok: true, id: id };
}

// ---------- FHCB and Directory rows (Admin) ----------
// Both tabs are edited by hand in Admin: one row at a time, the fields below
// and nothing else. A row with no id is new. Links must be http(s) or the
// page's own ./fhcb/ and ./directory/ logo paths.
var ROW_FIELDS = {
  FHCB: ['no', 'country', 'name', 'kind', 'address', 'persons', 'tel', 'fax', 'email', 'website', 'logo_url', 'logo_file', 'note', 'source_ref', 'source_page', 'effective_date', 'status'],
  Directory: ['type', 'subtype', 'name', 'coverage', 'state', 'country', 'address', 'pic', 'phone', 'email', 'website', 'website2', 'accreditation', 'description', 'trainers', 'logo_url', 'logo_file', 'source_ref', 'status'],
};
function cleanRow(tab, r) {
  var out = {};
  ROW_FIELDS[tab].forEach(function (k) {
    var v = r[k]; if (v === undefined || v === null) return;
    v = String(v).slice(0, k === 'trainers' || k === 'description' || k === 'address' ? 4000 : 500).trim();
    if ((k === 'logo_url' || k === 'website' || k === 'website2' || k === 'logo_file') && v && !/^(https?:\/\/|\.\/(fhcb|directory)\/[\w.-]+$)/i.test(v)) {
      if (k === 'website' || k === 'website2') v = v.split(/;\s*/).map(function (w) { return /^https?:\/\//i.test(w) ? w : w ? 'https://' + w : ''; }).filter(String).join('; ');
      else throw new Error(k + ' must be a link');
    }
    out[k] = v;
  });
  if (!out.name) throw new Error('Give it a name.');
  if (tab === 'FHCB') { out.kind = out.kind === 'authority' ? 'authority' : 'body'; if (!out.country) throw new Error('Country is needed.'); }
  // Directory: Sertu and Laboratory are services; every other category
  // (JAKIM providers, firms, freelance, any Wan adds) is Training & Consultancy.
  if (tab === 'Directory') {
    out.subtype = String(out.subtype || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'consult';
    out.type = ['jurusertu', 'lab'].indexOf(out.subtype) >= 0 ? 'service' : 'training';
  }
  out.status = ['published', 'hidden', 'draft'].indexOf(out.status) >= 0 ? out.status : 'published';
  out.updated_at = new Date().toISOString();
  return out;
}
function rowSave(tab, row) {
  if (!ROW_FIELDS[tab]) throw new Error('unknown tab');
  var clean = cleanRow(tab, row);
  clean.id = String(row.id || '').trim() || ((tab === 'FHCB' ? 'FHCB-M' : 'DIR-M') + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyMMddHHmmss'));
  if (!row.id && tab === 'FHCB' && !clean.no) { var max = 0; readTab('FHCB').forEach(function (r) { max = Math.max(max, Number(r.no) || 0); }); clean.no = max + 1; }
  if (row.id) { var old = readTab(tab).filter(function (r) { return String(r.id) === clean.id; })[0]; if (old) ROW_FIELDS[tab].forEach(function (k) { if (clean[k] === undefined) clean[k] = old[k]; }); }
  upsert(tab, [clean]);
  return { ok: true, id: clean.id, row: clean };
}
// Load the page's bundled list (FHCB 21 Aug 2026, JAKIM training providers
// Jun 2026) into the Sheet: only ids not there yet, nothing overwritten.
function seedDeleted() { var o = {}; try { JSON.parse(readSettings().seed_deleted || '[]').forEach(function (k) { o[k] = 1; }); } catch (e) { /* none */ } return o; }
function seedRows(tab, rows) {
  if (!ROW_FIELDS[tab]) throw new Error('unknown tab');
  var have = {}; readTab(tab).forEach(function (r) { have[String(r.id)] = r; });
  var add = [], fix = [], deleted = seedDeleted();
  rows.slice(0, 500).forEach(function (r) {
    if (!r.id || deleted[tab + ':' + String(r.id)]) return;
    var c = cleanRow(tab, r); c.id = String(r.id);
    var cur = have[c.id];
    if (!cur) { add.push(c); have[c.id] = c; return; }
    // Repair a cell an earlier load damaged (#ERROR! from a "+" phone number,
    // a lost leading zero) or left empty; a value Wan edited stays as it is.
    var changed = false, out = {};
    ROW_FIELDS[tab].forEach(function (k) { out[k] = cur[k]; });
    ROW_FIELDS[tab].forEach(function (k) {
      var want = c[k], got = cur[k] === undefined || cur[k] === null ? '' : String(cur[k]);
      if (want === undefined || want === '') return;
      // Only cells a load damaged; a field Wan cleared on purpose stays empty.
      if (/^#(ERROR|NAME|VALUE|REF|N\/A)/.test(got) || (/^0\d/.test(want) && got === want.replace(/^0+/, ''))) { out[k] = want; changed = true; }
    });
    if (changed) { out.id = c.id; out.updated_at = new Date().toISOString(); fix.push(out); }
  });
  if (add.length || fix.length) upsert(tab, add.concat(fix));
  return { ok: true, added: add.length, repaired: fix.length };
}
// A logo for a body or provider: stored in Drive "50 Logos", shared view-only
// so the page can show it.
function logoUpload(b) {
  if (!b.b64) throw new Error('Choose an image.');
  if (b.b64.length > 3 * 1024 * 1024) throw new Error('Logo too large (max 2 MB).');
  var mime = String(b.mime || '').toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(mime)) throw new Error('Logo must be a JPG, PNG, WEBP, GIF or SVG picture.');
  var f = folder('50 Logos').createFile(Utilities.newBlob(Utilities.base64Decode(b.b64), mime, String(b.name || 'logo').slice(0, 120)));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: 'https://lh3.googleusercontent.com/d/' + f.getId(), file: 'https://drive.google.com/file/d/' + f.getId() + '/view' };
}
// The FHCB list PDF or a related circular: kept in Drive "40 FHCB", shared
// view-only so the page can embed Drive's viewer, and filed as a Document of
// category fhcb (kind fhcb_list or fhcb_circular). A new list supersedes the
// previous one, which is archived.
function fhcbDocUpload(b, email) {
  if (!b.b64) throw new Error('Choose a file.');
  if (b.b64.length > 34 * 1024 * 1024) throw new Error('File too large (max 25 MB).');
  var kind = b.kind === 'fhcb_list' ? 'fhcb_list' : 'fhcb_circular';
  var mime = String(b.mime || 'application/pdf');
  var f = folder('40 FHCB').createFile(Utilities.newBlob(Utilities.base64Decode(b.b64), mime, String(b.name || 'fhcb.pdf').slice(0, 150)));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var now = new Date().toISOString(), id = 'DOC-FHCB-' + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyMMddHHmmss');
  var prev = '';
  if (kind === 'fhcb_list') {
    var olds = readTab('Documents').filter(function (d) { return d.category === 'fhcb' && d.kind === 'fhcb_list' && d.status === 'current'; });
    if (olds.length) { prev = olds[0].id; updateByIds('Documents', olds.map(function (d) { return d.id; }), { status: 'archived', updated_at: now }); }
  }
  upsert('Documents', [{ id: id, title: String(b.title || b.name || 'FHCB document').slice(0, 200), kind: kind, category: 'fhcb', drive_file_id: f.getId(), drive_url: 'https://drive.google.com/file/d/' + f.getId() + '/view',
    content_hash: '', version: String(b.version || ''), supersedes_id: prev, source_msg_id: '', received_at: now, updated_at: now, status: 'current', notes: 'from:admin ' + email }]);
  return { ok: true, id: id, url: 'https://drive.google.com/file/d/' + f.getId() + '/view' };
}
// Rephrase a FAQ answer with the AI: same facts, clearer words, nothing
// added. Returns the four answers for the admin to check and save.
var REPHRASE = 'You rewrite answers for a halal executive knowledge hub in Malaysia. Rephrase each answer given so it reads clearly and plainly, keeping every fact, number, clause and reference exactly as given and adding nothing new. answer_formal_en and answer_layman_en in English; answer_formal_bm and answer_layman_bm in Bahasa Malaysia (Malaysian register: boleh, ubat, syarikat, kualiti; never Indonesian). Keep regulatory terms as written (Notifikasi Kosmetik, Garis Panduan, Borang, MPPHM, SPHM). Return JSON with exactly those four keys.';
function faqRephrase(b) {
  var r = readTab('FAQ').filter(function (x) { return String(x.id) === String(b.id || ''); })[0];
  if (!r) throw new Error('Not found');
  var src = { question_en: r.question_en, question_bm: r.question_bm, answer_formal_en: r.answer_formal_en, answer_layman_en: r.answer_layman_en, answer_formal_bm: r.answer_formal_bm, answer_layman_bm: r.answer_layman_bm };
  var out = complete([{ role: 'system', content: REPHRASE }, { role: 'user', content: JSON.stringify(src).slice(0, 12000) }], { json: true, max_tokens: 2500, temperature: 0.3 });
  var j = out.json || {}, fields = {};
  ['answer_formal_en', 'answer_layman_en', 'answer_formal_bm', 'answer_layman_bm'].forEach(function (k) { if (j[k] && String(j[k]).trim()) fields[k] = String(j[k]).slice(0, 6000); });
  if (!Object.keys(fields).length) throw new Error('The AI returned nothing usable; try again.');
  return { ok: true, fields: fields, provider: out.provider };
}
