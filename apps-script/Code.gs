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
  Raw:        ['id','source','group','msg_id','sender_hash','ts','text','attachments','status','processed_at','model','notes'],
  FAQ:        ['id','category','subcategory','question_en','question_bm','answer_formal_en','answer_layman_en','answer_formal_bm','answer_layman_bm','source_refs','confidence','status','created_at','updated_at','model','verify_notes','verified_at'],
  Guidelines: ['id','category','title','title_bm','summary_en','summary_bm','link','issuer','effective_date','updated_at','status','source'],
  Documents:  ['id','title','kind','category','drive_file_id','drive_url','content_hash','version','supersedes_id','source_msg_id','received_at','updated_at','status','notes'],
  Certificates: ['id','company','cert_no','scheme','category','state','valid_from','valid_to','products','drive_url','doc_id','status','updated_at','notes'],
  Events:     ['id','title','title_bm','date_start','date_end','venue','poster_url','link','description','status','source','poster_file'],
  News:       ['id','title','url','source','published_at','fetched_at','expires_at','summary_en','summary_bm','category'],
  Settings:   ['key','value'],
  Runs:       ['ts','job','provider','model','processed','ok','error'],
  References: ['id','title','issuer','edition','category','drive_file_id','drive_url','mime','pages','chunks','summary_en','summary_bm','key_points','status','added_by','added_at','indexed_at','error'],
  RefChunks:  ['id','ref_id','page','text','terms'],
};

// Tabs the pipeline may write with upsert/delete. Settings, Raw and Runs have
// their own narrow actions, so an ingest token can never rewrite the hero,
// the notice or the admin list.
var WRITABLE = ['FAQ', 'Guidelines', 'Documents', 'Certificates', 'Events', 'News', 'References', 'RefChunks'];

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
  seedReferences();
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

function sheet(name) { var sh = ss().getSheetByName(name); if (!sh) throw new Error('Missing tab ' + name); return sh; }

// Columns are only ever appended, so an older tab gets the new names written
// after its last header cell and every existing value stays where it was.
function ensureHeader(sh, cols) {
  var have = sh.getLastColumn();
  if (have >= cols.length) return;
  sh.getRange(1, have + 1, 1, cols.length - have).setValues([cols.slice(have)]);
}

function readTab(name) {
  var sh = sheet(name), v = sh.getDataRange().getValues();
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
  if (a === 'thumb') return json(certThumb(String(e.parameter.id || '')));
  if (a === 'status') return json(aiStatus());
  return json({ ok: false, error: 'unknown action' });
}

// [SAHKAN: …] is a working note for the pipeline (pipeline/resolve_sahkan.py
// fills it from the references library or takes it out); readers never see it.
function noMarks(rows) {
  return rows.map(function (r) { Object.keys(r).forEach(function (k) { if (typeof r[k] === 'string' && r[k].indexOf('[') >= 0) r[k] = r[k].replace(/\s*\[SAHKAN[^\]]*\]/gi, '').trim(); }); return r; });
}

// The public feed is built from eight tabs, which took 5-7 s per visit.
// It is kept in CacheService for 5 minutes, split into 90 KB pieces (the
// per-value limit is 100 KB), and dropped the moment anything is written
// through this script. Collector heartbeats are read fresh each time, so the
// Live chip never waits for the cache. Edits typed straight into the Sheet
// show within 5 minutes.
var PUB_TTL = 300, PUB_PIECE = 90000;
function pubBust() { props().setProperty('pub_v', String(Date.now())); }
function cachedPublicData() {
  var cache = CacheService.getScriptCache(), v = props().getProperty('pub_v') || '0', base = 'pub_' + v + '_';
  var head = cache.get(base + 'n'), body = null;
  if (head) {
    var keys = []; for (var i = 0; i < Number(head); i++) keys.push(base + i);
    var got = cache.getAll(keys), parts = [];
    for (var j = 0; j < keys.length; j++) { if (got[keys[j]] == null) { parts = null; break; } parts.push(got[keys[j]]); }
    if (parts) { try { body = JSON.parse(parts.join('')); } catch (e) { body = null; } }
  }
  if (!body) {
    body = publicData();
    try {
      var str = JSON.stringify(body), put = {}, n = Math.ceil(str.length / PUB_PIECE);
      for (var k = 0; k < n; k++) put[base + k] = str.slice(k * PUB_PIECE, (k + 1) * PUB_PIECE);
      put[base + 'n'] = String(n);
      cache.putAll(put, PUB_TTL);
    } catch (e) { /* too large to cache: serve uncached */ }
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
  var cols = TABS.Raw, src = sh.getRange(2, cols.indexOf('source') + 1, n, 1).getValues(), st = sh.getRange(2, cols.indexOf('status') + 1, n, 1).getValues();
  for (var i = 0; i < n; i++) { if (!src[i][0] && !st[i][0]) continue; stats[st[i][0]] = (stats[st[i][0]] || 0) + 1; stats.by_source[src[i][0]] = (stats.by_source[src[i][0]] || 0) + 1; }
  return stats;
}

function publicData() {
  var settings = readSettings(); delete settings.llm_turn;
  var now = Date.now();
  var stats = rawStats();
  var runs = readTab('Runs').sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); }).slice(0, 20);
  return {
    settings: settings,
    // Open points to confirm are for the admin only.
    faq: noMarks(readTab('FAQ').filter(function (r) { return r.status === 'published'; }).map(function (r) { delete r.verify_notes; return r; })),
    guidelines: noMarks(readTab('Guidelines').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft'; })),
    documents: noMarks(readTab('Documents')),
    certificates: noMarks(readTab('Certificates').filter(function (r) { return r.status !== 'hidden'; })),
    events: noMarks(readTab('Events').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft'; })),
    news: readTab('News').filter(function (r) { return !r.expires_at || Date.parse(r.expires_at) > now; }),
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
    if (a === 'logout') { if (body.session) CacheService.getScriptCache().remove('sess_' + body.session); return json({ ok: true }); }
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
    if (a === 'raw_list')     return json({ ok: true, rows: readTab('Raw').filter(function (r) { return (!body.status || r.status === body.status) && (!body.source || r.source === body.source); }).slice(0, Math.min(body.limit || 50, 500)) });
    if (a === 'read')         { if (WRITABLE.indexOf(body.tab) < 0 && body.tab !== 'Raw') throw new Error('tab not readable'); return json({ ok: true, rows: readTab(body.tab) }); }
    if (a === 'drive_get')    return json(driveGet(body));
    if (a === 'llm_next')     return json({ ok: true, provider: nextProvider() });
    if (a === 'llm')          return json(llmProxy(body));
    if (a === 'heartbeat')    return json(heartbeat(body));

    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      if (a === 'admins_set')    { needAdmin(); return json(setAdminEmails(body.emails || [])); }
      if (a === 'manual_upload') { needAdmin(); return json(manualUpload(body, sessEmail || 'token')); }
      if (a === 'review_set')    { needAdmin(); return json(reviewSet(body.tab, body.id, body.status)); }
      if (a === 'settings')      { needAdmin(); return json(writeSettings(body.settings || {})); }
      if (a === 'ref_upload')    { needAdmin(); return json(refUpload(body, sessEmail || 'token')); }
      if (a === 'ref_set')       { needAdmin(); return json(refSet(body.id, body.status)); }
      if (a === 'event_save')    { needAdmin(); return json(eventSave(body)); }
      if (a === 'poster_upload') { needAdmin(); return json(posterUpload(body)); }
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
  var code = String(Math.floor(100000 + Math.random() * 900000));
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
  var session = newToken();
  c.put('sess_' + session, email, 21600); // 6 hours, the cache maximum
  return { ok: true, session: session, email: email, expires_in: 21600 };
}

function sessionEmail(session) {
  if (!session) return null;
  var email = CacheService.getScriptCache().get('sess_' + session);
  return email && adminEmails().indexOf(email) >= 0 ? email : null; // removed from the list = signed out
}

// ---------- Certificate thumbnails ----------
// Drive's own preview of the certificate, read with the owner's rights and
// handed back as a data URI, so the file itself never has to be shared.
function certThumb(id) {
  var cert = readTab('Certificates').filter(function (r) { return String(r.id) === id && r.status !== 'hidden'; })[0];
  if (!cert) return { ok: false, error: 'not found' };
  var m = String(cert.drive_url || '').match(/\/d\/([\w-]{10,})/), fileId = m && m[1];
  if (!fileId && cert.doc_id) {
    var doc = readTab('Documents').filter(function (d) { return String(d.id) === String(cert.doc_id); })[0];
    fileId = doc && doc.drive_file_id;
  }
  if (!fileId) return { ok: false, error: 'no file' };
  var cache = CacheService.getScriptCache(), hit = cache.get('thumb_' + fileId);
  if (hit) return { ok: true, data: hit };
  var data = null;
  try {
    var meta = Drive.Files.get(fileId, { fields: 'thumbnailLink,mimeType' });
    if (meta.thumbnailLink) {
      var r = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s480'), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      if (r.getResponseCode() === 200) data = 'data:' + (r.getHeaders()['Content-Type'] || 'image/png') + ';base64,' + Utilities.base64Encode(r.getContent());
    }
    if (!data && /^image\//.test(meta.mimeType)) {
      var b = DriveApp.getFileById(fileId).getBlob();
      if (b.getBytes().length < 70000) data = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  if (!data) return { ok: false, error: 'no preview yet' };
  if (data.length < 95000) cache.put('thumb_' + fileId, data, 21600);
  return { ok: true, data: data };
}

// Drafts written by the pipeline wait here for an admin to publish or hide.
var REVIEW_TABS = ['FAQ', 'Events', 'Guidelines', 'Certificates'];
function reviewList() {
  var out = {};
  REVIEW_TABS.forEach(function (t) { out[t] = readTab(t).filter(function (r) { return r.status === 'draft'; }); });
  // Points the pipeline could not confirm from the references library: they
  // were left out of the published answer and wait here until a reference
  // that states them is uploaded.
  var open = readTab('FAQ').filter(function (r) { return r.status !== 'hidden' && String(r.verify_notes || '').length > 2; }).map(function (r) {
    var notes = []; try { notes = JSON.parse(r.verify_notes); } catch (e) { notes = [String(r.verify_notes)]; }
    return { id: r.id, question_en: r.question_en, question_bm: r.question_bm, notes: notes, verified_at: r.verified_at };
  }).filter(function (r) { return r.notes.length; });
  return { ok: true, drafts: out, to_confirm: open };
}
function reviewSet(tab, id, status) {
  if (REVIEW_TABS.indexOf(tab) < 0) throw new Error('unknown tab');
  if (['published', 'hidden', 'draft', 'current'].indexOf(status) < 0) throw new Error('unknown status');
  if (tab === 'Certificates' && status === 'published') status = 'current';
  var patch = { status: status };
  if (TABS[tab].indexOf('updated_at') >= 0) patch.updated_at = new Date().toISOString();
  return updateByIds(tab, [id], patch);
}

function writeSettings(obj) {
  pubBust();
  var sh = sheet('Settings'), v = sh.getDataRange().getValues(), idx = {};
  v.forEach(function (r, i) { if (i) idx[r[0]] = i + 1; });
  Object.keys(obj).forEach(function (k) {
    if (k === 'llm_turn') return;
    if (idx[k]) sh.getRange(idx[k], 2).setValue(String(obj[k])); else sh.appendRow([k, String(obj[k])]);
  });
  return { ok: true, count: Object.keys(obj).length };
}

// Collectors post rows {source, group, msg_id, sender_hash, ts, text, attachments:[{name, mime, b64, sha256}]}.
// Duplicate (source, msg_id) is skipped so a re-run never doubles the queue.
function ingest(rows) {
  var sh = sheet('Raw'), have = {};
  readTab('Raw').forEach(function (r) { have[r.source + ':' + r.msg_id] = 1; });
  var added = 0, skipped = 0;
  rows.forEach(function (r) {
    var key = r.source + ':' + r.msg_id;
    if (have[key]) { skipped++; return; }
    var att = (r.attachments || []).map(function (a) {
      if (a.b64) { var f = saveToInbox(a, r); return { name: f.name, drive_file_id: f.id, drive_url: f.url, mime: a.mime, sha256: a.sha256 || '' }; }
      return a;
    });
    sh.appendRow([r.source + '-' + r.msg_id, r.source, r.group || '', String(r.msg_id), r.sender_hash || '', r.ts || new Date().toISOString(), r.text || '', JSON.stringify(att), 'new', '', '', '']);
    have[key] = 1; added++;
  });
  return { ok: true, added: added, skipped: skipped };
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

function driveUpload(b) {
  var f = folder(b.path || '00 Inbox').createFile(Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'application/octet-stream', b.name));
  return { ok: true, id: f.getId(), url: f.getUrl(), name: f.getName(), modified: f.getLastUpdated().toISOString() };
}

// Rename, move or archive one Drive file. The organiser uses this to file a
// new version under "10 Documents/<category>" as "YYYY-MM-DD v2 Title.pdf"
// and to move the superseded one to "90 Archive/<category>".
function driveFile(b) {
  var f = DriveApp.getFileById(b.id);
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
  var f = DriveApp.getFileById(b.id), blob = f.getBlob(), text = '';
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
function manualUpload(b, email) {
  var hint = { faq: 'Admin upload: material for the FAQ.', certificate: 'Admin upload: this is a halal certificate. File it as a document of kind certificate.', guideline: 'Admin upload: this is a guideline, circular or standard. Add it to guidelines.', event: 'Admin upload: this is an event or course announcement.' }[b.kind] || 'Admin upload.';
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

function upsert(tab, rows) {
  var cols = TABS[tab]; if (!cols) throw new Error('unknown tab ' + tab);
  var sh = sheet(tab); ensureHeader(sh, cols); pubBust();
  var v = sh.getDataRange().getValues(), idx = {};
  v.forEach(function (r, i) { if (i) idx[String(r[0])] = i + 1; });
  var ins = 0, upd = 0;
  rows.forEach(function (r) {
    var line = cols.map(function (c) { var x = r[c]; return x === undefined || x === null ? '' : (typeof x === 'object' ? JSON.stringify(x) : x); });
    if (r.id && idx[String(r.id)]) { sh.getRange(idx[String(r.id)], 1, 1, cols.length).setValues([line]); upd++; }
    else { sh.appendRow(line); idx[String(r.id)] = sh.getLastRow(); ins++; }
  });
  return { ok: true, inserted: ins, updated: upd };
}

function updateByIds(tab, ids, patch) {
  var cols = TABS[tab], sh = sheet(tab), v = sh.getDataRange().getValues(), n = 0; pubBust();
  var want = {}; ids.forEach(function (i) { want[String(i)] = 1; });
  v.forEach(function (r, i) {
    if (!i || !want[String(r[0])]) return;
    Object.keys(patch).forEach(function (k) { var c = cols.indexOf(k); if (c >= 0) sh.getRange(i + 1, c + 1).setValue(patch[k]); });
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

// ---------- LLM: MIRELD and AFIQ alternate, each covers the other ----------
function nextProvider() {
  var P = props(), turn = parseInt(P.getProperty('llm_turn') || '0', 10);
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
function resolveModel(name, fresh, fast) {
  if (fast) return resolveFast(name, fresh);
  var p = PROVIDERS[name], want = (props().getProperty(p.modelProp) || 'auto').trim(), cache = CacheService.getScriptCache(), ck = 'model_' + name;
  if (!fresh) { var hit = cache.get(ck); if (hit) return hit; }
  var wants = want.toLowerCase() === 'auto' ? [] : want.split(',').map(function (x) { return x.trim(); }).filter(String);
  if (wants.length === 1 && !fresh) { cache.put(ck, wants[0], 21600); return wants[0]; }
  var ids = listIds(name), chat = ids.filter(function (i) { return !NOT_CHAT.test(i); }), pick = null;
  wants.some(function (w) { if (ids.indexOf(w) >= 0) { pick = w; return true; } });
  if (!pick) PREFER.some(function (pre) { pick = chat.filter(function (i) { return i.toLowerCase().indexOf(pre) === 0; })[0] || null; return !!pick; });
  if (!pick) pick = chat[0] || ids[0];
  if (!pick) throw new Error(name + ': no models listed');
  cache.put(ck, pick, 21600);
  return pick;
}

// Fast model: FAST_<NAME>_MODEL property if set, else the first quick model
// the gateway lists, else the normal pick.
function resolveFast(name, fresh) {
  var forced = props().getProperty(name + '_FAST_MODEL');
  if (forced) return forced;
  var cache = CacheService.getScriptCache(), ck = 'fast_' + name;
  if (!fresh) { var hit = cache.get(ck); if (hit) return hit; }
  var ids = [];
  try { ids = listIds(name); } catch (e) { return resolveModel(name, fresh, false); }
  var pick = null;
  FAST.some(function (f) { pick = ids.filter(function (i) { return i.toLowerCase().indexOf(f) === 0; })[0] || null; return !!pick; });
  if (!pick) pick = ids.filter(function (i) { return /(flash|mini|lite|haiku|turbo)/i.test(i) && !NOT_CHAT.test(i); })[0] || null;
  if (!pick) pick = resolveModel(name, fresh, false);
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
  return { text: text, provider: name, model: model };
}

// Alternate on every call; if the chosen provider fails for any reason the
// other one answers the same request, and the Runs tab records which did.
function complete(messages, opts) {
  var first = nextProvider(), order = [first, first === 'MIRELD' ? 'AFIQ' : 'MIRELD'], errs = [];
  for (var i = 0; i < order.length; i++) {
    try {
      var r = callProvider(order[i], messages, opts);
      if (opts && opts.json) r.json = parseJson(r.text); // unreadable JSON hands over to the other provider
      if (i) { r.fallback_from = first; r.first_error = errs[0]; }
      return r;
    } catch (e) { errs.push(order[i] + ': ' + String(e.message || e).slice(0, 200)); }
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

function llmProxy(b) { var r = complete(b.messages || [], b.opts || {}); return { ok: true, text: r.text, provider: r.provider, model: r.model, fallback_from: r.fallback_from || '' }; }

function chat(b) {
  b.question = String(b.question || '').slice(0, 600);
  b.context = (b.context || []).slice(0, 8).map(function (c) { return { type: String(c.type || '').slice(0, 20), id: String(c.id || '').slice(0, 40), title: String(c.title || '').slice(0, 300), body: String(c.body || '').slice(0, 1500) }; });
  var lang = b.lang === 'bm' ? 'Bahasa Malaysia (Malaysian register: boleh, ubat, syarikat, kualiti; never Indonesian)' : 'English';
  var ctx = (b.context || []).map(function (c, i) { return '[' + (i + 1) + '] (' + c.type + ' ' + c.id + ') ' + c.title + '\n' + c.body; }).join('\n\n');
  var sys = 'You are the Halal Executive assistant for halal executives in Malaysia. Answer ONLY from the numbered context entries. Cite entries like [1]. If the context does not answer, say so in one sentence and suggest which tab to check (FAQ, Guidelines, Documents). Keep regulatory terms original (Notifikasi Kosmetik, Garis Panduan, Borang). Never invent a limit, entry number or date; if a number is not in the context, say it is not in the site sources yet. Reply in ' + lang + '. Be brief.';
  try {
    var r = complete([{ role: 'system', content: sys }, { role: 'user', content: 'Context:\n' + (ctx || '(none)') + '\n\nQuestion: ' + b.question }], { max_tokens: 600, fast: true });
    return { ok: true, answer: r.text, provider: r.provider, model: r.model };
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
    sh.getRange(1, 1, keep.length, cols.length).setValues(keep);
  }
  var rows = (b.chunks || []).map(function (c, i) { return [b.ref_id + '-' + (c.n != null ? c.n : i), b.ref_id, String(c.page), String(c.text).slice(0, 4000), String(c.terms || '').slice(0, 500)]; });
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

function askReferences(b) {
  var t0 = Date.now();
  var q = String(b.question || '').trim().slice(0, 600);
  if (q.length < 3) return { ok: false, error: 'Type a question.' };
  var lang = b.lang === 'bm' ? 'bm' : (b.lang === 'en' ? 'en' : 'auto');
  var cache = CacheService.getScriptCache();
  var key = 'ans_' + (props().getProperty('ans_v') || '0') + '_' + lang + '_' + sha256(Utilities.newBlob(toks(q).join(' ')).getBytes()).slice(0, 24);
  var hit = cache.get(key);
  if (hit) { var h = JSON.parse(hit); h.cached = true; h.ms = Date.now() - t0; return h; }

  // Retrieve: BM25-style score over every passage, question terms widened
  // with their Malay/English pair.
  var qt = toks(q), terms = {};
  qt.forEach(function (w) { terms[w] = 1; (SYN[w] || []).forEach(function (x) { if (!terms[x]) terms[x] = 0.7; }); });
  var refs = {}; readTab('References').forEach(function (r) { if (r.status === 'indexed') refs[r.id] = r; });
  var rows = sheet('RefChunks').getDataRange().getValues().slice(1).filter(function (r) { return refs[r[1]]; });
  if (!rows.length) return { ok: true, layman: '', details: '', citations: [], none: true, message: 'No references have been indexed yet.', ms: Date.now() - t0 };
  var N = rows.length, df = {}, docs = rows.map(function (r) { var tk = toks(r[3]); var tf = {}; tk.forEach(function (w) { if (terms[w]) tf[w] = (tf[w] || 0) + 1; }); Object.keys(tf).forEach(function (w) { df[w] = (df[w] || 0) + 1; }); return { r: r, tf: tf, len: tk.length }; });
  var avg = docs.reduce(function (s, d) { return s + d.len; }, 0) / N;
  docs.forEach(function (d) {
    var sc = 0;
    Object.keys(d.tf).forEach(function (w) { var idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5)); var f = d.tf[w]; sc += terms[w] * idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg)); });
    d.score = sc;
  });
  var top = docs.filter(function (d) { return d.score > 0; }).sort(function (x, y) { return y.score - x.score; }).slice(0, 6);
  if (!top.length) {
    var none = { ok: true, none: true, layman: '', details: '', citations: [], message: lang === 'bm' ? 'Tiada petikan dalam rujukan yang sepadan dengan soalan ini.' : 'Nothing in the references matches this question.', ms: Date.now() - t0 };
    return none;
  }
  var passages = top.map(function (d, i) { var ref = refs[d.r[1]]; return { n: i + 1, ref_id: d.r[1], page: String(d.r[2]), title: ref.title + (ref.edition ? ' (' + ref.edition + ')' : ''), text: String(d.r[3]).slice(0, 1600) }; });
  var langRule = lang === 'bm' ? 'Bahasa Malaysia (Malaysian register: boleh, ubat, syarikat, kualiti; never Indonesian)' : lang === 'en' ? 'English' : 'the same language as the question (Bahasa Malaysia or English; Malaysian register, never Indonesian)';
  var sys = 'You answer questions from halal executives in Malaysia using ONLY the numbered passages from official references. ' +
    'Return JSON: {"layman":"2-4 short sentences anyone can follow","details":"precise answer naming the requirement, conditions and exceptions, 3-8 sentences","citations":[{"n":<passage number>,"quote":"exact words from that passage, max 25 words"}],"confidence":"high|medium|low"}. ' +
    'Write both answers in ' + langRule + '. Keep regulatory terms original (Sijil Pengesahan Halal Malaysia, MPPHM, MHMS). Cite every fact with the passage number it came from. ' +
    'If the passages do not answer the question, say so plainly in "layman", leave "details" empty and cite nothing. Never use outside knowledge, never invent a number, clause or page.';
  var user = 'Passages:\n' + passages.map(function (p) { return '[' + p.n + '] ' + p.title + ', page ' + p.page + '\n' + p.text; }).join('\n\n') + '\n\nQuestion: ' + q;
  var r;
  try { r = complete([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 900, json: true, fast: true, temperature: 0.1 }); }
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
// Status for the robot cards and the collectors' live indicator.
// =====================================================================
function heartbeat(b) {
  var src = String(b.source || '').replace(/[^a-z]/g, '').slice(0, 20);
  if (!src) throw new Error('source required');
  props().setProperty('hb_' + src, JSON.stringify({ ts: new Date().toISOString(), group: String(b.group || '').slice(0, 80), last_msg: b.last_msg || '', version: String(b.version || '').slice(0, 20) }));
  return { ok: true };
}

function collectorStatus() {
  var all = props().getProperties(), out = {};
  Object.keys(all).forEach(function (k) { if (k.indexOf('hb_') === 0) { try { out[k.slice(3)] = JSON.parse(all[k]); } catch (e) { /* ignore */ } } });
  return out;
}

// Public, cached 5 minutes: which model each provider is on, whether its
// gateway answers, and when it last did real work.
function aiStatus() {
  var cache = CacheService.getScriptCache(), hit = cache.get('ai_status');
  if (hit) return JSON.parse(hit);
  var runs = readTab('Runs');
  var out = { ok: true, checked_at: new Date().toISOString(), providers: {} };
  Object.keys(PROVIDERS).forEach(function (n) {
    var p = PROVIDERS[n], key = props().getProperty(p.keyProp), s = { name: n === 'AFIQ' ? 'Wanshah 1' : 'Wanshah 2', provider: n, key: !!key, reachable: false, model: '', fast_model: '', ms: null, last_used: '', last_ok: '' };
    if (key) {
      var t = Date.now();
      try {
        var r = UrlFetchApp.fetch(p.base + '/models', { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
        s.ms = Date.now() - t; s.reachable = r.getResponseCode() < 300;
      } catch (e) { s.ms = Date.now() - t; }
      try { s.model = resolveModel(n, false, false); s.fast_model = resolveModel(n, false, true); } catch (e) { /* unreachable */ }
    }
    var last = runs.filter(function (x) { return x.provider === n; }).sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); })[0];
    if (last) s.last_used = last.ts;
    var ok = cache.get('ok_' + n); if (ok) { try { s.last_ok = JSON.parse(ok).ts; } catch (e) { /* ignore */ } }
    out.providers[n] = s;
  });
  cache.put('ai_status', JSON.stringify(out), 300);
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
    status: e.status === 'hidden' ? 'hidden' : 'published', source: 'admin', poster_file: clean(file) }]);
  return { ok: true, id: id };
}
