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
  FAQ:        ['id','category','subcategory','question_en','question_bm','answer_formal_en','answer_layman_en','answer_formal_bm','answer_layman_bm','source_refs','confidence','status','created_at','updated_at','model'],
  Guidelines: ['id','category','title','title_bm','summary_en','summary_bm','link','issuer','effective_date','updated_at','status','source'],
  Documents:  ['id','title','kind','category','drive_file_id','drive_url','content_hash','version','supersedes_id','source_msg_id','received_at','updated_at','status','notes'],
  Certificates: ['id','company','cert_no','scheme','category','state','valid_from','valid_to','products','drive_url','doc_id','status','updated_at','notes'],
  Events:     ['id','title','title_bm','date_start','date_end','venue','poster_url','link','description','status','source'],
  News:       ['id','title','url','source','published_at','fetched_at','expires_at','summary_en','summary_bm','category'],
  Settings:   ['key','value'],
  Runs:       ['ts','job','provider','model','processed','ok','error'],
};

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
  showSecrets();
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
  if (a === 'data') return json(publicData());
  if (a === 'ping') return json({ ok: true, ts: new Date().toISOString() });
  if (a === 'thumb') return json(certThumb(String(e.parameter.id || '')));
  return json({ ok: false, error: 'unknown action' });
}

function publicData() {
  var settings = readSettings(); delete settings.llm_turn;
  var now = Date.now();
  var raw = readTab('Raw'), stats = { new: 0, processed: 0, skipped: 0, by_source: {} };
  raw.forEach(function (r) { stats[r.status] = (stats[r.status] || 0) + 1; stats.by_source[r.source] = (stats.by_source[r.source] || 0) + 1; });
  var runs = readTab('Runs').sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); }).slice(0, 20);
  return {
    settings: settings,
    faq: readTab('FAQ').filter(function (r) { return r.status === 'published'; }),
    guidelines: readTab('Guidelines').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft'; }),
    documents: readTab('Documents'),
    certificates: readTab('Certificates').filter(function (r) { return r.status !== 'hidden'; }),
    events: readTab('Events').filter(function (r) { return r.status !== 'hidden' && r.status !== 'draft'; }),
    news: readTab('News').filter(function (r) { return !r.expires_at || Date.parse(r.expires_at) > now; }),
    runs: runs, raw_stats: stats, generated_at: new Date().toISOString(),
  };
}

// ---------- POST: writes ----------
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json({ ok: false, error: 'bad json' }); }
  var a = body.action;
  try {
    if (a === 'chat') return json(chat(body));
    if (a === 'login_request') return json(loginRequest(body.email));
    if (a === 'login_verify') return json(loginVerify(body.email, body.code));
    if (a === 'logout') { if (body.session) CacheService.getScriptCache().remove('sess_' + body.session); return json({ ok: true }); }
    var P = props();
    var sessEmail = sessionEmail(body.session);
    if (a === 'whoami') return json(sessEmail ? { ok: true, email: sessEmail } : { ok: false, error: 'unauthorised' });
    if (a === 'admins_get') return json(sessEmail ? { ok: true, emails: adminEmails(), owner: Session.getEffectiveUser().getEmail().toLowerCase() } : { ok: false, error: 'unauthorised' });
    if (a === 'admins_set') return json(sessEmail ? setAdminEmails(body.emails || []) : { ok: false, error: 'unauthorised' });
    // Admin = a signed-in registered email, or ADMIN_TOKEN for scripts.
    var isAdmin = !!sessEmail || (body.token && body.token === P.getProperty('ADMIN_TOKEN'));
    var isIngest = isAdmin || (body.token && body.token === P.getProperty('INGEST_TOKEN'));
    if (!isIngest) return json({ ok: false, error: 'unauthorised' });
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      if (a === 'manual_upload') { if (!isAdmin) throw new Error('Sign in with a registered email first.'); return json(manualUpload(body, sessEmail || 'token')); }
      if (a === 'review_list')  { if (!isAdmin) throw new Error('Sign in with a registered email first.'); return json(reviewList()); }
      if (a === 'review_set')   { if (!isAdmin) throw new Error('Sign in with a registered email first.'); return json(reviewSet(body.tab, body.id, body.status)); }
      if (a === 'settings')     { if (!isAdmin) throw new Error('Sign in with a registered email first.'); return json(writeSettings(body.settings || {})); }
      if (a === 'ingest')       return json(ingest(body.rows || []));
      if (a === 'raw_list')     return json({ ok: true, rows: readTab('Raw').filter(function (r) { return (!body.status || r.status === body.status) && (!body.source || r.source === body.source); }).slice(0, body.limit || 50) });
      if (a === 'raw_update')   return json(updateByIds('Raw', body.ids || [], body.patch || {}));
      if (a === 'read')         return json({ ok: true, rows: readTab(body.tab) });
      if (a === 'upsert')       return json(upsert(body.tab, body.rows || []));
      if (a === 'delete')       return json(deleteByIds(body.tab, body.ids || []));
      if (a === 'run_log')      { sheet('Runs').appendRow([new Date().toISOString(), body.job, body.provider, body.model, body.processed, body.ok, body.error || '']); return json({ ok: true }); }
      if (a === 'drive_upload') return json(driveUpload(body));
      if (a === 'drive_file')   return json(driveFile(body));
      if (a === 'drive_get')    return json(driveGet(body));
      if (a === 'llm_next')     return json({ ok: true, provider: nextProvider() });
      if (a === 'llm')          return json(llmProxy(body));
      return json({ ok: false, error: 'unknown action ' + a });
    } finally { lock.releaseLock(); }
  } catch (err) { return json({ ok: false, error: String(err && err.message || err) }); }
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
  return { ok: true, drafts: out };
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
  var sh = sheet(tab), v = sh.getDataRange().getValues(), idx = {};
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
  var cols = TABS[tab], sh = sheet(tab), v = sh.getDataRange().getValues(), n = 0;
  var want = {}; ids.forEach(function (i) { want[String(i)] = 1; });
  v.forEach(function (r, i) {
    if (!i || !want[String(r[0])]) return;
    Object.keys(patch).forEach(function (k) { var c = cols.indexOf(k); if (c >= 0) sh.getRange(i + 1, c + 1).setValue(patch[k]); });
    n++;
  });
  return { ok: true, updated: n };
}

function deleteByIds(tab, ids) {
  var sh = sheet(tab), v = sh.getDataRange().getValues(), want = {}, n = 0;
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
var NOT_CHAT = /(embed|image|dall|tts|whisper|audio|moderation|rerank|vision-only)/i;

function listIds(name) {
  var p = PROVIDERS[name], key = props().getProperty(p.keyProp);
  var r = UrlFetchApp.fetch(p.base + '/models', { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error(name + ' /models HTTP ' + r.getResponseCode());
  return (JSON.parse(r.getContentText()).data || []).map(function (m) { return m.id; });
}

// Model for one provider: an exact id, a comma list, or auto. The answer is
// cached for 6 h and dropped the moment the gateway says the model is gone.
function resolveModel(name, fresh) {
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

function postChat(p, key, model, messages, opts) {
  var payload = { model: model, messages: messages, temperature: (opts && opts.temperature) || 0.2, max_tokens: (opts && opts.max_tokens) || 1200 };
  if (opts && opts.json) payload.response_format = { type: 'json_object' };
  return UrlFetchApp.fetch(p.base + '/chat/completions', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + key }, payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: true });
}

function callProvider(name, messages, opts) {
  var p = PROVIDERS[name], key = props().getProperty(p.keyProp);
  if (!key) throw new Error(name + ' key not set');
  var model = (opts && opts.model) || resolveModel(name, false);
  var r = postChat(p, key, model, messages, opts);
  // Model withdrawn or renamed: re-read /models once and retry with the new pick.
  if ((r.getResponseCode() === 400 || r.getResponseCode() === 404) && /model/i.test(r.getContentText()) && !(opts && opts.model)) {
    var again = resolveModel(name, true);
    if (again !== model) { model = again; r = postChat(p, key, model, messages, opts); }
  }
  if (r.getResponseCode() >= 300) throw new Error(name + ' HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  var j = JSON.parse(r.getContentText());
  var text = j.choices && j.choices[0] && j.choices[0].message && (j.choices[0].message.content || '');
  if (!text) throw new Error(name + ' empty completion');
  return { text: text, provider: name, model: model };
}

// Alternate on every call; if the chosen provider fails for any reason the
// other one answers the same request, and the Runs tab records which did.
function complete(messages, opts) {
  var first = nextProvider(), second = first === 'MIRELD' ? 'AFIQ' : 'MIRELD', errs = [];
  try { return callProvider(first, messages, opts); } catch (e) { errs.push(String(e.message || e)); }
  try { var r = callProvider(second, messages, opts); r.fallback_from = first; r.first_error = errs[0]; return r; } catch (e) { errs.push(String(e.message || e)); }
  throw new Error('both providers failed: ' + errs.join(' | '));
}

function llmProxy(b) { var r = complete(b.messages || [], b.opts || {}); return { ok: true, text: r.text, provider: r.provider, model: r.model, fallback_from: r.fallback_from || '' }; }

function chat(b) {
  var lang = b.lang === 'bm' ? 'Bahasa Malaysia (Malaysian register: boleh, ubat, syarikat, kualiti; never Indonesian)' : 'English';
  var ctx = (b.context || []).map(function (c, i) { return '[' + (i + 1) + '] (' + c.type + ' ' + c.id + ') ' + c.title + '\n' + c.body; }).join('\n\n');
  var sys = 'You are the Halal Executive assistant for halal executives in Malaysia. Answer ONLY from the numbered context entries. Cite entries like [1]. If the context does not answer, say so in one sentence and suggest which tab to check (FAQ, Guidelines, Documents). Keep regulatory terms original (Notifikasi Kosmetik, Garis Panduan, Borang). Never invent a limit, entry number or date; if a number is missing write [SAHKAN]. Reply in ' + lang + '. Be brief.';
  try {
    var r = complete([{ role: 'system', content: sys }, { role: 'user', content: 'Context:\n' + (ctx || '(none)') + '\n\nQuestion: ' + b.question }], { max_tokens: 600 });
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
