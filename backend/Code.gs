/**
 * CSP DATA MANAGER | Google Apps Script server
 * Run setupProject() once from the script editor before deploying the web app.
 * Deploy as the owner. Staff sign in using one-time codes emailed to
 * their allowlisted addresses, with server-verified, expiring sessions.
 */

const TABLES = Object.freeze({
  Users: ['id', 'role', 'name', 'email', 'manager_id', 'can_supervise', 'acting_lead_id', 'mobile_number', 'birth_date', 'photo_data', 'account_status'],
  Master_Items: ['id', 'type', 'name', 'current_price', 'quantity', 'rate_unit'],
  Tickets: ['id', 'jira_ticket_no', 'location', 'engineer_name', 'status', 'department', 'project_key', 'sub_department', 'summary', 'assigned_supervisor_id', 'assigned_by', 'assigned_at', 'assignment_status', 'return_reason', 'returned_at', 'jira_assignees', 'priority_sequence', 'budget_details', 'issue_links_json', 'lead_id', 'created', 'contact_number', 'request_type', 'sub_request_type', 'design_needed', 'reporter', 'jira_assignee', 'jira_assignment_group'],
  Reports: ['id', 'ticket_id', 'supervisor_id', 'date', 'work_done', 'completion_status', 'amount_of_work', 'status', 'revision_note', 'revision_count', 'approver_id', 'work_measure', 'work_measure_unit', 'daily_report_text', 'work_date', 'source_transcript', 'source_language', 'work_quantities_json'],
  Report_Line_Items: ['id', 'report_id', 'item_id', 'quantity', 'locked_price', 'rate_unit', 'rate_id', 'rate_date', 'rate_source', 'rate_note'],
  Notifications: ['id', 'recipient_id', 'actor_id', 'type', 'title', 'body', 'target_kind', 'target_id', 'created_at', 'read_at'],
  Push_Subscriptions: ['id', 'user_id', 'token', 'device_label', 'created_at', 'updated_at'],
  Sessions: ['token_hash', 'user_id', 'email', 'created_at', 'expires_at'],
  Lead_Rules: ['id', 'supervisor_id', 'lead_id', 'rule_type', 'ticket_id', 'weekday', 'start_time', 'end_time', 'active', 'created_at'],
  Audit_Log: ['id', 'actor_id', 'action', 'target_id', 'created_at', 'before_json', 'after_json'],
  App_Settings: ['key', 'value', 'updated_at', 'updated_by'],
  Item_Rates: ['id','item_id','category','old_rate','new_rate','rate_unit','changed_at','changed_by','effective_date','source','note'],
  CSP_Staff_Profiles: ['role','name','email','mobile_number','manager_name','review_status','source']
});
const ITEM_TYPES = ['material', 'machine', 'labour', 'other'];
const USER_ROLES = ['admin', 'supervisor', 'lead'];
const COMPLETION_STATES = ['not started', 'in progress', 'partially completed', 'completed'];
const CSP_DIRECTORY_HEADERS = ['Roles (App Terms)', 'eMail IDs', 'WhatsApp No.', 'Supervisors (Users)', 'eMail IDs', 'WhatsApp No.', 'Leads (Approvers)', 'eMail IDs', 'WhatsApp No.', 'CSP Centre (Admin)'];
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function doGet() {
  // This deployment is backend-only. Angular is served by a separate HTTPS host.
  return ContentService.createTextOutput(JSON.stringify({
    service:'CSP Data Manager API',status:'ready',frontend:'separately hosted Angular app'
  })).setMimeType(ContentService.MimeType.JSON);
}

/** One-click first-time setup. Creates operations + reporting spreadsheets in the owner's Drive. 
 * Existing SPREADSHEET_ID and REPORTING_WORKBOOK_ID are reused, never replaced. */
function setupProject() {
  const props = PropertiesService.getScriptProperties();
  let databaseUrl = '';
  const existingId = props.getProperty('SPREADSHEET_ID');
  if (existingId) {
    const existing = SpreadsheetApp.openById(existingId);
    ensureSchema_(existing);
    databaseUrl = existing.getUrl();
  } else {
    databaseUrl = initializeNewProject_();
  }
  const reportingUrl = ensureReportingWorkbook_().getUrl();
  seedScreenshotProfilesSheet_(SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID')));
  Logger.log('Operations spreadsheet: ' + databaseUrl);
  Logger.log('Reporting workbook: ' + reportingUrl);
  return {operationsUrl: databaseUrl, reportingWorkbookUrl: reportingUrl,
    message: 'Both Google spreadsheets are ready. No XLSX upload is required.'};
}

/** Initializes a brand-new operations database. It does not import or overwrite historical data. */
function initializeNewProject_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SPREADSHEET_ID')) throw new Error('Project is already initialized. Run setupProject() instead.');
  const owner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!owner) throw new Error('Please run from the Apps Script editor while signed into the owner account.');
  const ss = SpreadsheetApp.create('CSP Data Manager - Operations');
  const initialSheet = ss.getSheets()[0];
  initialSheet.setName('Users');
  ensureSchema_(ss);
  ss.getSheetByName('Users').appendRow([Utilities.getUuid(), 'admin', owner.split('@')[0], owner, '']);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  props.setProperty('CURRENCY_CODE', 'INR');
  return ss.getUrl();
}

/** These column labels match the user's CSP response workbook; no responses are fabricated. */
const CSP_REPORTING_HEADERS = [
  'Timestamp','Email Address','AI Report','Supervisor Name','Civil Ticket No','Work Date',
  'Masons','Helpers','FC','Cement Bags','M Sand','P Sand','Jelly/Chips','Bricks',
  'Solid Blocks','Tiles','Other Materials','Tractor','Crane','JCB','Scaffolding',
  'Other Equipment','Status','Completed','Unit','Labour','Material','Equipment','Total'
];

/** Safe, idempotent creation of a NEW reporting workbook only when none is configured.
 * This is a normal native Google Sheet: staff do not upload or convert XLSX files. */
function ensureReportingWorkbook_() {
  const props = PropertiesService.getScriptProperties();
  const existingId = String(props.getProperty('REPORTING_WORKBOOK_ID') || '').trim();
  if (existingId) {
    if (existingId === String(props.getProperty('SPREADSHEET_ID') || ''))
      throw new Error('Reporting workbook cannot be the operations database.');
    return SpreadsheetApp.openById(existingId);
  }
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const afterLockId = String(props.getProperty('REPORTING_WORKBOOK_ID') || '').trim();
    if (afterLockId) return SpreadsheetApp.openById(afterLockId);
    const book = SpreadsheetApp.create('CSP Reporting Workbook - Created by SitePulse');
    const responses = book.getSheets()[0]; responses.setName('Form Responses 1');
    if (responses.getMaxColumns() < CSP_REPORTING_HEADERS.length)
      responses.insertColumnsAfter(responses.getMaxColumns(), CSP_REPORTING_HEADERS.length-responses.getMaxColumns());
    responses.getRange(1,1,1,CSP_REPORTING_HEADERS.length).setValues([CSP_REPORTING_HEADERS]);
    responses.getRange(1,1,1,CSP_REPORTING_HEADERS.length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#234b44');
    responses.getRange(1,26,1,4).setBackground('#315d4b');
    responses.setFrozenRows(1); responses.setFrozenColumns(2);
    responses.setRowHeight(1,44);
    responses.setColumnWidths(1,29,125);
    responses.setColumnWidth(3,380); responses.setColumnWidth(4,200); responses.setColumnWidth(5,160);
    responses.getRange('A:A').setNumberFormat('dd mmm yyyy hh:mm');
    responses.getRange('Z:AC').setNumberFormat('₹#,##0.00;[Red](₹#,##0.00)');
    // Row two is the clean starter row. Later rows inherit formulas through the UI's Insert row action.
    responses.getRange('Z2:AC2').setFormulas([[
      '=G2*Rates!$B$3+H2*Rates!$B$4+I2*Rates!$B$5',
      '=J2*Rates!$B$6+K2*Rates!$B$7+L2*Rates!$B$8+M2*Rates!$B$9+N2*Rates!$B$10+O2*Rates!$B$11+P2*Rates!$B$12',
      '=R2*Rates!$B$13+S2*Rates!$B$14+T2*Rates!$B$15',
      '=SUM(Z2:AB2)'
    ]]);
    responses.getRange('A2:Y2').setFontColor('#2354a2');
    // Legacy-support tabs are blank templates. Historical rows are not invented or silently migrated.
    const legacy5=book.insertSheet('Sheet5');
    legacy5.getRange(1,1,1,5).setValues([['Timestamp','Email Address','Supervisor Name','Civil Ticket No','Remarks']]);
    const legacy4=book.insertSheet('Sheet4');
    legacy4.getRange(1,1,1,4).setValues([['Timestamp','Email Address','Civil Ticket No','Remarks']]);
    [legacy5,legacy4].forEach(function(sh){sh.getRange(1,1,1,sh.getLastColumn())
      .setBackground('#234b44').setFontWeight('bold').setFontColor('#ffffff');
      sh.setFrozenRows(1);sh.setColumnWidths(1,sh.getLastColumn(),170);
      sh.setColumnWidth(2,240);});
    const rates=book.insertSheet('Rates');
    const rateRows=[
      ['Category','Rate (INR)','Unit / basis','Please review rates before live use'],
      ['Labour Rate','','','Initial values follow the supplied workbook; update as required'],
      ['MS',900,'day',''],['MC',600,'day',''],['FC',450,'day',''],
      ['Cement Bags',350,'bag',''],['M Sand',60,'cu.ft',''],['P Sand',65,'cu.ft',''],
      ['Jelly',50,'cu.ft',''],['Bricks',60,'sq.ft',''],['Solid Blocks',50,'sq.ft',''],
      ['Tiles',40,'sq.ft',''],['Tractor',2000,'shift',''],['Crane',5600,'shift',''],
      ['JCB','=8*900','8h shift',''],['Lorry',3000,'trip','']
    ];
    rates.getRange(1,1,rateRows.length,4).setValues(rateRows);
    rates.getRange('A1:D1').setFontWeight('bold').setFontColor('#ffffff').setBackground('#234b44');
    rates.getRange('A2:D2').setBackground('#fff0d0').setFontColor('#7f4c20');
    rates.getRange('B3:B16').setNumberFormat('₹#,##0.00');
    rates.getRange('B3:B16').setFontColor('#24519a');
    rates.getRange('B15').setFontColor('#26362f');
    rates.setFrozenRows(1);rates.setColumnWidths(1,1,185);rates.setColumnWidth(2,140);
    rates.setColumnWidth(3,170);rates.setColumnWidth(4,480);
    props.setProperty('REPORTING_WORKBOOK_ID',book.getId());
    Logger.log('Created reporting workbook: '+book.getUrl());
    return book;
  } finally { lock.releaseLock(); }
}

function ensureSchema_(ss) {
  Object.keys(TABLES).forEach(function(name) {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = TABLES[name];
    // Existing Google Sheets often have only 26 physical columns: Tickets now exceeds Z.
    if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e2e8f0');
    } else {
      const oldWidth = sheet.getLastColumn();
      if (oldWidth > headers.length) throw new Error('Unexpected extra columns in ' + name + '.');
      const found = sheet.getRange(1, 1, 1, oldWidth).getDisplayValues()[0];
      if (found.join('|') !== headers.slice(0, oldWidth).join('|')) {
        throw new Error('Unexpected headers in ' + name + '. Check sheet before upgrading.');
      }
      if (oldWidth < headers.length) {
        sheet.getRange(1, oldWidth + 1, 1, headers.length - oldWidth).setValues([headers.slice(oldWidth)]);
        sheet.getRange(1, oldWidth + 1, 1, headers.length - oldWidth).setFontWeight('bold').setBackground('#e2e8f0');
      }
    }
  });
  ensureDirectory_(ss);
}

function ensureDirectory_(ss) {
  const sheet=ss.getSheetByName('CSP_Directory') || ss.insertSheet('CSP_Directory');
  if (sheet.getLastRow()===0) {sheet.getRange(1,1,1,CSP_DIRECTORY_HEADERS.length).setValues([CSP_DIRECTORY_HEADERS]);sheet.setFrozenRows(1);sheet.getRange(1,1,1,CSP_DIRECTORY_HEADERS.length).setFontWeight('bold').setBackground('#e2e8f0');}
}

function db_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Project not initialized. Run setupProject() in the Apps Script editor.');
  const ss = SpreadsheetApp.openById(id);
  ensureSchema_(ss); // Safe, non-destructive upgrade of existing six-column Tickets tab.
  return ss;
}

function rows_(ss, table) {
  const sheet = ss.getSheetByName(table);
  if (!sheet) throw new Error('Missing sheet: ' + table);
  const end = sheet.getLastRow();
  if (end < 2) return [];
  const names = TABLES[table];
  return sheet.getRange(2, 1, end - 1, names.length).getValues().map(function(values, index) {
    const out = {_row: index + 2};
    names.forEach(function(name, col) {
      const v = values[col];
      out[name] = v instanceof Date ? v.toISOString() : v;
    });
    return out;
  });
}

function publicRow_(row) {
  const copy = Object.assign({}, row);
  delete copy._row;
  return copy;
}

function write_(ss, table, row) {
  const values = TABLES[table].map(function(key) { return row[key] === undefined ? '' : row[key]; });
  const sheet = ss.getSheetByName(table);
  if (row._row) sheet.getRange(row._row, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
}

function transaction_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(db_()); }
  finally { lock.releaseLock(); }
}

function text_(value, field, max, required) {
  const str = String(value == null ? '' : value).trim();
  if (required && !str) throw new Error(field + ' is required.');
  if (str.length > max) throw new Error(field + ' must be at most ' + max + ' characters.');
  // Prevent spreadsheet-formula injection from form input or Jira fields.
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
}

function number_(value, field, allowZero) {
  const number = typeof value === 'string' && !value.trim() ? NaN : Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0) || number > 1000000000) {
    throw new Error(field + ' must be a valid ' + (allowZero ? 'nonnegative' : 'positive') + ' number.');
  }
  return Math.round((number + Number.EPSILON) * 10000) / 10000;
}

function money_(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function newId_() { return Utilities.getUuid(); }
/** Passwordless authentication for personal Gmail and Workspace accounts.
 * Only allowlisted Users addresses get one-time codes. No browser-supplied role,
 * user ID or email is trusted for an authenticated action.
 */
const LOGIN_CODE_TTL_SECONDS = 600;
// Persistent, server-side hashed sessions live in Sessions; CacheService has a six-hour maximum.
function digest_(input) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(input), Utilities.Charset.UTF_8));
}
function loginEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new Error('Enter a valid email address.');
  }
  return email;
}
function authKey_(email) { return digest_(email).replace(/[^a-zA-Z0-9_-]/g, ''); }
function authCache_() { return CacheService.getScriptCache(); }
function makeLoginCode_() {
  // UUID is generated by Google; use 12 random hex digits for an 8-digit code.
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  return String(parseInt(hex, 16) % 100000000).padStart(8, '0');
}
// Run once from the Apps Script editor after installing this update.
// It requests the additional MailApp authorization without emailing anybody.
function authorizeMailService() {
  MailApp.getRemainingDailyQuota();
  return 'Mail authorization successful. Now deploy a new version of the web app.';
}
function requestLoginCode(emailInput) {
  const email = loginEmail_(emailInput);
  const response = {ok: true, message: 'If this email is registered in CSP Data Manager, a sign-in code will arrive shortly. Check Spam too.'};
  const user = rows_(db_(), 'Users').find(function(u) {
    return String(u.email).trim().toLowerCase() === email;
  });
  if (!user || String(user.account_status||'active')!=='active' ||
      (user.role==='supervisor'&&!user.manager_id)) return response; // Same answer for unknown/inactive addresses.
  const cache = authCache_();
  const key = authKey_(email);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const last = Number(cache.get('login-last:' + key) || 0);
    const sent = Number(cache.get('login-hour:' + key) || 0);
    if (Date.now() - last < 60000 || sent >= 6) return response;
    if (MailApp.getRemainingDailyQuota() < 1) {
      throw new Error('Sign-in email quota reached. Please contact the app owner.');
    }
    const code = makeLoginCode_();
    const nonce = Utilities.getUuid() + Utilities.getUuid();
    const challenge = {email: email, hash: digest_(nonce + ':' + code), nonce: nonce, attempts: 0, expires: Date.now() + 600000};
    // Reserve this request before sending. Cache expiry/eviction fails closed.
    cache.put('login-last:' + key, String(Date.now()), 60);
    cache.put('login-hour:' + key, String(sent + 1), 3600);
    cache.put('login-otp:' + key, JSON.stringify(challenge), LOGIN_CODE_TTL_SECONDS);
    MailApp.sendEmail({
      to: email,
      subject: 'Your CSP Data Manager sign-in code',
      body: 'Your CSP Data Manager sign-in code is: ' + code + '\n\n' +
        'This code expires in 10 minutes and can be used once.\n' +
        'If you did not request it, ignore this message.\n\n' +
        'Never share this code with anyone.',
      name: 'CSP Data Manager'
    });
    return response;
  } finally {
    lock.releaseLock();
  }
}
function verifyLoginCode(emailInput, codeInput) {
  const email = loginEmail_(emailInput);
  const code = String(codeInput || '').trim();
  if (!/^\d{8}$/.test(code)) throw new Error('Enter the 8-digit code from your email.');
  const cache = authCache_();
  const key = authKey_(email);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const stored = cache.get('login-otp:' + key);
    if (!stored) throw new Error('Code expired or not found. Request a new sign-in code.');
    const challenge = JSON.parse(stored);
    if (Date.now() >= challenge.expires) {
      cache.remove('login-otp:' + key);
      throw new Error('Code expired. Request a new sign-in code.');
    }
    if (challenge.attempts >= 5) {
      cache.remove('login-otp:' + key);
      throw new Error('Too many attempts. Request a new code.');
    }
    challenge.attempts += 1;
    if (challenge.email !== email || challenge.hash !== digest_(challenge.nonce + ':' + code)) {
      if (challenge.attempts >= 5) cache.remove('login-otp:' + key);
      else cache.put('login-otp:' + key, JSON.stringify(challenge), Math.max(1, Math.ceil((challenge.expires - Date.now()) / 1000)));
      throw new Error('Incorrect code. Try again.');
    }
    cache.remove('login-otp:' + key); // One-time use.
    const user = rows_(db_(), 'Users').find(function(u) {
      return String(u.email).trim().toLowerCase() === email;
    });
    if (!user || String(user.account_status||'active')!=='active') throw new Error('Account access is pending administrator approval.');
    const sessionToken = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    const ss=db_();
    write_(ss,'Sessions',{token_hash:digest_(sessionToken),user_id:String(user.id),email:email,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+SESSION_TTL_MS).toISOString()});
    return {authorized: true, sessionToken: sessionToken};
  } finally {
    lock.releaseLock();
  }
}
function logoutSession(sessionToken) {
  if (typeof sessionToken === 'string' && /^[a-f\d-]{108}$/i.test(sessionToken)) {
    transaction_(function(ss){const hash=digest_(sessionToken);const row=rows_(ss,'Sessions').find(function(s){return s.token_hash===hash;}); if(row)ss.getSheetByName('Sessions').deleteRow(row._row);});
  }
  return {ok:true};
}
function identity_(ss, sessionToken) {
  if (typeof sessionToken !== 'string' || !/^[a-f\d-]{108}$/i.test(sessionToken)) throw new Error('Please sign in using the email code.');
  const hash=digest_(sessionToken);
  const session=rows_(ss,'Sessions').find(function(r){return String(r.token_hash)===hash;});
  if (!session || Date.now()>=new Date(session.expires_at).getTime()) throw new Error('Your seven-day session has expired. Please sign in again.');
  const user=rows_(ss,'Users').find(function(u){return String(u.id)===String(session.user_id) && String(u.email).toLowerCase()===String(session.email).toLowerCase();});
  if (!user || String(user.account_status||'active')!=='active') throw new Error('Your account is not active.');
  return user;
}
function requireRole_(ss, allowed, sessionToken) {
  const user = identity_(ss, sessionToken);
  if (allowed.indexOf(String(user.role)) === -1 && !(allowed.indexOf('supervisor')!==-1 && user.role==='lead' && (user.can_supervise===true || String(user.can_supervise)==='true'))) throw new Error('You are not authorized to perform this action.');
  return user;
}

function isOpen_(status) {
  return !/\b(done|closed|resolved|cancelled|canceled|completed|complete)\b/i.test(String(status || ''));
}

function peopleById_(ss) {
  return Object.fromEntries(rows_(ss, 'Users').map(function(u) { return [String(u.id), u]; }));
}
function canViewSupervisor_(viewer, supervisor, people) {
  return viewer.role === 'admin' || ((viewer.role === 'supervisor' || (viewer.role==='lead' && String(viewer.can_supervise)==='true')) && String(viewer.id) === String(supervisor.id)) ||
    (viewer.role === 'lead' && String(supervisor.manager_id) === String(viewer.id));
}
function scopedTickets_(ss, user) {
  const people = peopleById_(ss);
  const leadRules=user.role==='lead'?rows_(ss,'Lead_Rules'):[];
  return rows_(ss, 'Tickets').filter(function(t) {
    if (user.role==='admin') return true;
    const sup=people[String(t.assigned_supervisor_id)];
    if (!sup) return false;
    if (user.role==='supervisor') return String(sup.id)===String(user.id);
    if (String(sup.id)===String(user.id) && String(user.can_supervise)==='true') return true;
    return canViewSupervisor_(user,sup,people) || effectiveLeadId_(ss,sup,t,new Date(),leadRules)===String(user.id);
  }).map(function(t){return publicRow_(t);}).sort(function(a,b){return Number(a.priority_sequence||999999)-Number(b.priority_sequence||999999) || String(a.jira_ticket_no).localeCompare(String(b.jira_ticket_no));});
}
function notificationRows_(ss, recipientId) {
  return rows_(ss, 'Notifications').filter(function(n) {
    return String(n.recipient_id) === String(recipientId);
  }).sort(function(a,b) { return String(b.created_at).localeCompare(String(a.created_at)); })
    .slice(0, 100).map(publicRow_);
}
function getBootstrap(sessionToken) {
  const ss = db_();
  let user;
  try { user = identity_(ss, sessionToken); }
  catch (error) { return {authorized: false, message: error.message}; }
  const role = String(user.role);
  const allRates=itemRates_(ss);
  const allItems = effectivePrices_(rows_(ss, 'Master_Items').map(publicRow_),allRates);
  const props = PropertiesService.getScriptProperties();
  const old = jiraLegacyConfig_(props);
  const jiraHost = String(props.getProperty('JIRA_BASE_URL') || old.jiraBaseUrl || 'https://servicedesk.isha.in').trim().replace(/\/+$/, '');
  return {
    authorized: true, user: publicRow_(user),
    items: role === 'supervisor' ? allItems.map(function(i) { return {id:i.id, type:i.type, name:i.name, rate_unit:i.rate_unit||'unit'}; }) : allItems,
    itemRates: allRates.filter(function(r){return role!=='supervisor'||rateDay_(r)<=Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd');}).map(publicRow_).reverse(),
    tickets: scopedTickets_(ss, user), reports: reportsFor_(ss, user),
    leadRules: role==='admin' ? rows_(ss,'Lead_Rules').map(publicRow_) : [],
    users: role === 'admin' ? rows_(ss, 'Users').map(publicRow_) :
      role === 'lead' ? (function() {
        const supIds = new Set(rows_(ss,'Reports').filter(function(r){return String(r.approver_id)===String(user.id);}).map(function(r){return String(r.supervisor_id);}));
        rows_(ss,'Lead_Rules').filter(function(r){return String(r.lead_id)===String(user.id);}).forEach(function(r){supIds.add(String(r.supervisor_id));});
        return rows_(ss,'Users').filter(function(u){return (u.role==='supervisor'||(u.role==='lead'&&String(u.can_supervise)==='true')) && (String(u.manager_id)===String(user.id) || supIds.has(String(u.id)));}).map(publicRow_);
      })() : [],
    notifications: notificationRows_(ss, user.id),
    contacts: rows_(ss,'Users').filter(function(u){return u.email&&String(u.id)!==String(user.id)&&String(u.account_status||'active')==='active';}).map(function(u){return {id:u.id,name:u.name,role:u.role};}),
    jiraReady: role === 'admin' && jiraConfigured_(props),
    reportingWorkbookReady:!!props.getProperty('REPORTING_WORKBOOK_ID'),
    jiraBaseUrl: /^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(jiraHost) ? jiraHost : '',
    jiraDefaultProject: 'CIVIL',
    aiEnabled: !!props.getProperty('GEMINI_API_KEY'),
    jiraAssignmentFieldsReady:!!props.getProperty('JIRA_ASSIGNEE_MAINTENANCE_FIELD') || !!props.getProperty('JIRA_ASSIGNEE_NEW_WORKS_FIELD') || !!props.getProperty('JIRA_ASSIGNEE_NEW_PROJECTS_FIELD'),
    currency: props.getProperty('CURRENCY_CODE') || 'INR',
    menuLabels: getMenuLabels_(ss)
  };
}
function listReports(sessionToken) {
  const ss = db_();
  return reportsFor_(ss, requireRole_(ss, USER_ROLES, sessionToken));
}
function reportsFor_(ss, user) {
  const people = peopleById_(ss);
  const tickets = Object.fromEntries(rows_(ss, 'Tickets').map(function(t) { return [String(t.id), t]; }));
  const items = Object.fromEntries(rows_(ss, 'Master_Items').map(function(i) { return [String(i.id), i]; }));
  const priced = String(user.role) !== 'supervisor';
  const reports = rows_(ss, 'Reports').filter(function(r) {
    const sup = people[String(r.supervisor_id)];
    return sup && (canViewSupervisor_(user, sup, people) || (user.role==='lead' && String(r.approver_id)===String(user.id)));
  }).sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
  const reportIds = new Set(reports.map(function(r) { return String(r.id); }));
  const byReport = {};
  rows_(ss, 'Report_Line_Items').forEach(function(line) {
    const id = String(line.report_id);
    if (!reportIds.has(id)) return;
    const item = items[String(line.item_id)];
    const detail = {id: line.id, item_id: line.item_id, rate_id:line.rate_id||'',rate_date:line.rate_date||'',rate_source:line.rate_source||'',rate_note:line.rate_note||'', item_name: item ? item.name : 'Archived item',
      type: item ? item.type : 'other', quantity: Number(line.quantity), rate_unit:line.rate_unit || (item && item.rate_unit) || 'unit'};
    if (priced) {detail.locked_price = Number(line.locked_price); detail.line_total = money_(detail.quantity * detail.locked_price);}
    (byReport[id] = byReport[id] || []).push(detail);
  });
  return reports.map(function(r) {
    const ticket = tickets[String(r.ticket_id)] || {};
    const supervisor = people[String(r.supervisor_id)] || {};
    const view = {id:r.id, ticket_id:r.ticket_id, supervisor_id:r.supervisor_id,
      ticket_no:ticket.jira_ticket_no || 'Unknown ticket', location:ticket.location || '',
      supervisor_name:supervisor.name || 'Unknown user', date:r.date,work_date:r.work_date||String(r.date).slice(0,10),
      work_done:r.work_done,daily_report_text:r.daily_report_text||'', source_transcript:r.source_transcript||'', source_language:r.source_language||'', work_quantities_json:r.work_quantities_json||'[]', completion_status:r.completion_status, status:r.status,
      revision_note:r.revision_note || '', revision_count:Number(r.revision_count || 0),
      work_measure:Number(r.work_measure||0),work_measure_unit:r.work_measure_unit||'',
      lines:byReport[String(r.id)] || []};
    if (priced) view.amount_of_work = Number(r.amount_of_work);
    return view;
  });
}

function saveMasterItem(sessionToken, payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid item.');
  return transaction_(function(ss) {
    requireRole_(ss, ['admin'], sessionToken);
    const type = String(payload.type || '').toLowerCase();
    if (ITEM_TYPES.indexOf(type) < 0) throw new Error('Invalid item type.');
    const name = text_(payload.name, 'Item name', 120, true);
    const price = number_(payload.current_price, 'Current price', true);
    const quantity = number_(payload.quantity===undefined ? 0 : payload.quantity,'Default quantity',true);
    const rateUnit=text_(payload.rate_unit || (type==='machine'?'hour':'unit'),'Rate unit',32,true);
    const all = rows_(ss, 'Master_Items');
    const duplicate = all.find(function(i) {
      return String(i.id) !== String(payload.id || '') && String(i.type) === type &&
        String(i.name).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) throw new Error('An item with this name and type already exists.');
    const existing = payload.id ? all.find(function(i) { return String(i.id) === String(payload.id); }) : null;
    if (payload.id && !existing) throw new Error('Item not found.');
    if (existing && (String(existing.type) !== type || String(existing.name) !== name)) {
      const used = rows_(ss, 'Report_Line_Items').some(function(l) { return String(l.item_id) === String(existing.id); });
      if (used) throw new Error('Items in submitted reports cannot be renamed or retyped, preserving historical descriptions. Price changes are allowed.');
    }
    const saved = {id: existing ? existing.id : newId_(), type: type, name: name, current_price: price, quantity:quantity, rate_unit:rateUnit};
    if (existing) saved._row = existing._row;
    write_(ss, 'Master_Items', saved);
    if (!existing || Number(existing.current_price)!==price) {
      const actor=identity_(ss,sessionToken);
      write_(ss,'Item_Rates',{id:newId_(),item_id:saved.id,category:type,old_rate:existing?Number(existing.current_price):'',new_rate:price,rate_unit:rateUnit,changed_at:new Date().toISOString(),changed_by:actor.id,effective_date:Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd'),source:'Catalog update',note:''});
    }
    return publicRow_(saved);
  });
}

/** Rates are append-only. Future prices are planned; historical rates remain selectable for work dated after their effective date. */
function siteDate_(input,label,required){
  const val=String(input||'').trim();if(!val&&!required)return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(val)||Number.isNaN(Date.parse(val+'T00:00:00Z'))||new Date(val+'T00:00:00Z').toISOString().slice(0,10)!==val)throw new Error((label||'Date')+' must be YYYY-MM-DD.');
  return val;
}
function itemRates_(ss){return rows_(ss,'Item_Rates');}
function rateDay_(r){return String(r.effective_date||r.changed_at||'').slice(0,10);}
function approvedRateOn_(rates,itemId,day){
  return rates.filter(function(r){return String(r.item_id)===String(itemId)&&rateDay_(r)<=day;})
    .sort(function(a,b){return rateDay_(b).localeCompare(rateDay_(a))||String(b.changed_at).localeCompare(String(a.changed_at));})[0]||null;
}
function effectivePrices_(items,rates){
  const today=Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd');
  return items.map(function(item){const current=approvedRateOn_(rates,item.id,today);
    return Object.assign({},item,{current_price:current?Number(current.new_rate):Number(item.current_price)});
  });
}
function addItemRate(sessionToken,itemId,amount,date,source,note){
  return transaction_(function(ss){
    const actor=requireRole_(ss,['admin','lead'],sessionToken);
    const item=rows_(ss,'Master_Items').find(function(i){return String(i.id)===String(itemId);});
    if(!item)throw new Error('Choose a valid item.');
    const price=number_(amount,'Rate',true),day=siteDate_(date,'Effective date',true);
    const origin=text_(source||'Market','Source/vendor',80,true),details=text_(note||'','Rate note',250,false);
    const existing=itemRates_(ss),earlier=approvedRateOn_(existing,item.id,day);
    const r={id:newId_(),item_id:item.id,category:item.type,old_rate:earlier?Number(earlier.new_rate):Number(item.current_price),new_rate:price,
      rate_unit:item.rate_unit||'unit',changed_at:new Date().toISOString(),changed_by:actor.id,effective_date:day,source:origin,note:details};
    write_(ss,'Item_Rates',r);return publicRow_(r);
  });
}
function deleteMasterItem(sessionToken, itemId) {
  return transaction_(function(ss) {
    requireRole_(ss, ['admin'], sessionToken);
    const target = rows_(ss, 'Master_Items').find(function(i) { return String(i.id) === String(itemId); });
    if (!target) throw new Error('Item not found.');
    if (rows_(ss, 'Report_Line_Items').some(function(l) { return String(l.item_id) === String(itemId); })) {
      throw new Error('Cannot delete an item used in a report. Its historical name and price must remain intact.');
    }
    ss.getSheetByName('Master_Items').deleteRow(target._row);
    return {deleted: true};
  });
}

function saveUser(sessionToken, payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid user.');
  return transaction_(function(ss) {
    const actor = requireRole_(ss, ['admin'], sessionToken);
    const name = text_(payload.name, 'Name', 100, true);
    const email = String(payload.email || '').trim().toLowerCase();
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)) throw new Error('Enter a valid email address.');
    const role = String(payload.role || '').toLowerCase();
    if (USER_ROLES.indexOf(role) < 0) throw new Error('Invalid user role.');
    const all = rows_(ss, 'Users');
    const existing = payload.id ? all.find(function(u) { return String(u.id) === String(payload.id); }) : null;
    if (payload.id && !existing) throw new Error('User not found.');
    if (email && all.some(function(u) { return String(u.email).toLowerCase() === email && (!existing || u.id !== existing.id); })) {
      throw new Error('This email is already assigned.');
    }
    if (existing && existing.id === actor.id && (email !== String(actor.email).toLowerCase() || role !== 'admin')) {
      throw new Error('You cannot change your own admin email or role.');
    }
    const managerId = String(payload.manager_id || '').trim();
    if (!email && role==='admin') throw new Error('Administrators require a verified email. Other roles may be placeholders until verified.');
    const canSupervise = role==='supervisor' || (role==='lead' && (payload.can_supervise===true || String(payload.can_supervise)==='true'));
    const actingLeadId = role==='lead' && canSupervise ? String(payload.acting_lead_id||'') : '';
    if (role === 'admin' && managerId) throw new Error('Admin accounts have no parent account.');
    if (role==='supervisor' && email && !managerId) throw new Error('Assign a reporting lead before enabling supervisor login; clear email to keep a draft placeholder.');
    if (role !== 'admin' && managerId) {
      const manager = all.find(function(u) { return String(u.id) === managerId; });
      if (!manager || manager.role !== (role === 'lead' ? 'admin' : 'lead')) {
        throw new Error(role === 'lead' ? 'Select the admin responsible for this lead.' : 'Select the lead responsible for this supervisor.');
      }
      if (existing && String(existing.id) === managerId) throw new Error('Users cannot manage themselves.');
    }
    if (existing && existing.role !== role && all.some(function(u) { return String(u.manager_id) === String(existing.id); })) {
      throw new Error('Reassign this member’s direct reports before changing their role.');
    }
    if (canSupervise && role==='lead' && actingLeadId && !all.some(function(u){return u.role==='lead' && String(u.id)===actingLeadId && (!existing || String(u.id)!==String(existing.id));})) throw new Error('Select another lead as reviewer.');
    const status=String(payload.account_status|| (existing&&existing.account_status)||'active');
    if(['active','pending'].indexOf(status)<0)throw new Error('Invalid account status.');
    const mobile=text_(payload.mobile_number||'','Mobile number',30,false);
    const date=validBirthDate_(payload.birth_date||'');
    const photo=validPhoto_(payload.photo_data||'');
    const saved = {id: existing ? existing.id : newId_(), role: role, name: name, email: email, manager_id:managerId,can_supervise:canSupervise,acting_lead_id:actingLeadId,mobile_number:mobile,birth_date:date,photo_data:photo,account_status:status};
    if (existing) saved._row = existing._row;
    write_(ss, 'Users', saved);
    if(status==='active') notify_(ss,saved.id,actor.id,'team_access',existing?'Account permissions updated':'Welcome to CSP Data Manager',
      'Role: '+role+(managerId ? '. Your assigned manager is '+(all.find(function(u){return String(u.id)===managerId;})||{}).name : '')+'. Sign in using your registered email.','team',saved.id);
    if (managerId && (!existing || String(existing.manager_id)!==managerId)) {
      notify_(ss,managerId,actor.id,'hierarchy_assigned','New direct report',saved.name+' is now assigned under you.','team',saved.id);
    }
    return publicRow_(saved);
  });
}

function deleteUser(sessionToken, id) {
  return transaction_(function(ss) {
    const actor = requireRole_(ss, ['admin'], sessionToken);
    const target = rows_(ss, 'Users').find(function(u) { return String(u.id) === String(id); });
    if (!target) throw new Error('User not found.');
    if (String(target.id) === String(actor.id)) throw new Error('You cannot remove your own admin access.');
    if (rows_(ss, 'Users').some(function(u) { return String(u.manager_id) === String(id); })) throw new Error('Reassign direct reports before removing this manager.');
    if (rows_(ss, 'Tickets').some(function(t) { return String(t.assigned_supervisor_id) === String(id); })) throw new Error('Reassign this user’s tickets before removal.');
    if (rows_(ss, 'Reports').some(function(r) { return String(r.supervisor_id) === String(id); })) {
      throw new Error('Cannot delete a user with submitted reports.');
    }
    ss.getSheetByName('Users').deleteRow(target._row);
    return {deleted: true};
  });
}

function notify_(ss, recipientId, actorId, type, title, body, targetKind, targetId) {
  if (!recipientId || String(recipientId) === 'undefined') return;
  const user = rows_(ss, 'Users').find(function(u) {return String(u.id) === String(recipientId);});
  if (!user) return;
  const note = {id:newId_(), recipient_id:user.id, actor_id:actorId || '', type:type,
    title:text_(title,'Notification title',150,true), body:text_(body,'Notification details',700,false),
    target_kind:targetKind || '', target_id:targetId || '', created_at:new Date().toISOString(), read_at:''};
  write_(ss, 'Notifications', note);
  try {
    if (type!=='direct_message' && user.email && MailApp.getRemainingDailyQuota() > 0) MailApp.sendEmail({to:user.email,
      subject:'CSP Data Manager: ' + title, body:title + '\n\n' + body +
        '\n\nOpen CSP Data Manager to review. This is an automated notification.', name:'CSP Data Manager'});
  } catch (ignored) { console.warn('CSP Data Manager notification email was unavailable: ' + type); }
  // FCM push is best-effort: failure must never roll back field reporting or approvals.
  try { cspPushNotification_(ss,note); } catch(pushError) { console.warn('FCM push unavailable: ' + String(pushError.message||pushError)); }
}
function notifyLeads_(ss, sup, actorId, type, title, body, kind, id) {
  if (sup.manager_id) notify_(ss, sup.manager_id, actorId, type, title, body, kind, id);
}
function listNotifications(sessionToken) {
  const ss=db_(); return notificationRows_(ss, requireRole_(ss, USER_ROLES, sessionToken).id);
}
function markNotificationRead(sessionToken, notificationId) {
  return transaction_(function(ss) {
    const user=requireRole_(ss, USER_ROLES, sessionToken);
    const n=rows_(ss,'Notifications').find(function(x) {return String(x.id)===String(notificationId) && String(x.recipient_id)===String(user.id);});
    if (!n) throw new Error('Notification not found.');
    if (!n.read_at) {n.read_at=new Date().toISOString(); write_(ss,'Notifications',n);}
    return {ok:true};
  });
}
function assignTicket(sessionToken, ticketId, supervisorId) {
  return transaction_(function(ss) {
    const admin=requireRole_(ss, ['admin'], sessionToken);
    const ticket=rows_(ss,'Tickets').find(function(t) {return String(t.id)===String(ticketId);});
    const sup=rows_(ss,'Users').find(function(u) {return (u.role==='supervisor'||(u.role==='lead'&&String(u.can_supervise)==='true')) && String(u.id)===String(supervisorId);});
    if (!ticket) throw new Error('Ticket not found.');
    if (!sup || !sup.manager_id) throw new Error('Select a supervisor with an assigned lead.');
    if (!isOpen_(ticket.status)) throw new Error('Closed Jira issues cannot be assigned for new work.');
    if (ticket.assignment_status === 'completed') throw new Error('This ticket is already completed.');
    // Admin-confirmed local assignment is authoritative for reporting. Jira custom-field users may not expose email addresses.
    const previous=String(ticket.assigned_supervisor_id || '');
    ticket.assigned_supervisor_id=sup.id; ticket.assigned_by=admin.id;
    ticket.assigned_at=new Date().toISOString(); ticket.assignment_status='assigned';
    ticket.return_reason='';ticket.returned_at=''; write_(ss,'Tickets',ticket);
    notify_(ss,sup.id,admin.id,'ticket_assigned','New ticket assigned',ticket.jira_ticket_no+' — '+ticket.summary,'ticket',ticket.id);
    notifyLeads_(ss,sup,admin.id,'ticket_assigned','Supervisor ticket assignment',sup.name+' was assigned '+ticket.jira_ticket_no,'ticket',ticket.id);
    if (previous && previous!==String(sup.id)) notify_(ss,previous,admin.id,'ticket_reassigned','Ticket reassigned',ticket.jira_ticket_no+' is no longer assigned to you.','ticket',ticket.id);
    return publicRow_(ticket);
  });
}
function returnTicket(sessionToken, ticketId, reasonInput) {
  return transaction_(function(ss) {
    const sup=requireRole_(ss,['supervisor'],sessionToken);
    const t=rows_(ss,'Tickets').find(function(x) {return String(x.id)===String(ticketId);});
    if (!t || String(t.assigned_supervisor_id)!==String(sup.id)) throw new Error('This ticket is not assigned to you.');
    if (t.assignment_status==='returned' || t.assignment_status==='completed') throw new Error('This ticket cannot be returned in its current state.');
    if (rows_(ss,'Reports').some(function(r) {return String(r.ticket_id)===String(t.id) && r.status==='pending';})) throw new Error('A report is waiting for approval.');
    t.return_reason=text_(reasonInput,'Reason for not performing work',1000,true);
    t.assignment_status='returned';t.returned_at=new Date().toISOString();
    write_(ss,'Tickets',t);
    notify_(ss,effectiveLeadId_(ss,sup,t,new Date()),sup.id,'ticket_returned','Ticket returned',sup.name+' returned '+t.jira_ticket_no+': '+t.return_reason,'ticket',t.id);
    const admins=rows_(ss,'Users').filter(function(u) {return u.role==='admin';});
    admins.forEach(function(a) {notify_(ss,a.id,sup.id,'ticket_returned','Ticket returned',sup.name+' returned '+t.jira_ticket_no+': '+t.return_reason,'ticket',t.id);});
    return {ok:true};
  });
}
function reportLinePayload_(ss, payload, prior) {
  if (!Array.isArray(payload.lines) || payload.lines.length>200) throw new Error('Invalid line items.');
  const masters=Object.fromEntries(rows_(ss,'Master_Items').map(function(i){return [String(i.id),i];}));
  const old=Object.fromEntries((prior||[]).map(function(l){return [String(l.id),l];}));
  const rates=itemRates_(ss),today=Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd');
  const workDate=siteDate_(payload.work_date||today,'Work date',true);
  if(workDate>today)throw new Error('A daily work report cannot be dated in the future.');
  const seenOld=new Set();
  return payload.lines.map(function(l){
    const key=String(l.item_id||''),existing=old[String(l.id||'')];
    if(!masters[key])throw new Error('Unknown item in report.');
    if(existing&&String(existing.item_id)!==key)throw new Error('Revision cannot change the original resource.');
    if(existing&&seenOld.has(existing.id))throw new Error('Duplicate report line.');
    if(existing)seenOld.add(existing.id);
    const quantity=number_(l.quantity,'Quantity',false);
    const base={id:existing?existing.id:'',item_id:key,quantity:quantity};
    // Approved reports and revisions retain the exact transaction price originally used.
    if(existing)return Object.assign(base,{locked_price:Number(existing.locked_price),rate_unit:String(existing.rate_unit||masters[key].rate_unit||'unit'),
      rate_id:String(existing.rate_id||''),rate_date:String(existing.rate_date||''),rate_source:String(existing.rate_source||''),rate_note:String(existing.rate_note||'')});
    if(l.rate_mode==='actual'){
      const actual=number_(l.actual_rate,'Actual paid rate',true);
      const note=text_(l.rate_note,'Receipt or vendor reference',250,true);
      return Object.assign(base,{locked_price:actual,rate_unit:String(masters[key].rate_unit||'unit'),rate_id:'',rate_date:workDate,rate_source:'Actual purchase',rate_note:note});
    }
    let r=null;
    if(l.rate_id){r=rates.find(function(x){return String(x.id)===String(l.rate_id)&&String(x.item_id)===key;});
      if(!r)throw new Error('The selected rate is not available for this item.');
      if(rateDay_(r)>workDate)throw new Error('Future-dated rates cannot be used for an earlier work date.');
    }else r=approvedRateOn_(rates,key,workDate);
    return Object.assign(base,{locked_price:r?Number(r.new_rate):number_(masters[key].current_price,'Catalog price',true),
      rate_unit:String(r&&r.rate_unit||masters[key].rate_unit||'unit'),rate_id:r?String(r.id):'',rate_date:r?rateDay_(r):workDate,
      rate_source:r?String(r.source||'Catalog'):'Legacy catalog',rate_note:r?String(r.note||''):''});
  });
}

function validateWorkQuantities_(input){
  if(input===undefined || input===null)return [];
  if(!Array.isArray(input)||input.length>60)throw new Error('Work quantities must be a list of up to 60 items.');
  return input.map(function(row){
    const description=text_(row.description,'Work activity',150,true),unit=text_(row.unit,'Unit',40,true);
    const quantity=number_(row.quantity,'Work quantity',false);
    if(quantity<=0)throw new Error('Work quantity must be positive.');
    return {description:description,quantity:quantity,unit:unit};
  });
}

function dailyReportText_(payload,ticket,sup){
  const text=text_(payload.daily_report_text||'', 'Daily site report', 11000, true);
  if(!ticket||!sup||!text.startsWith('DAILY SITE REPORT\n')||
    text.indexOf('Ticket No: '+ticket.jira_ticket_no)<0||
    text.indexOf('Supervisor name: '+sup.name)<0||
    text.indexOf('Work Done:')<0||text.indexOf('Materials Used')<0||
    text.indexOf('Equipment Used')<0||text.indexOf('Work Completion Status')<0){
    throw new Error('The daily site report preview is incomplete. Generate and verify it before submitting.');
  }
  // Reject tampering that would make the stored copy disagree with structured spreadsheet values.
  const quantities=validateWorkQuantities_(payload.work_quantities);
  if(quantities.length&&!text.includes('Work Quantities\n'))throw new Error('Work quantities section is missing.');
  quantities.forEach(function(q){
    if(text.indexOf(q.description+': '+q.quantity+' '+q.unit)<0)throw new Error('Work quantity does not match the report text: '+q.description);
  });
  const resources=text.match(/(?:^|\n)(?:Labours|Materials Used|Equipment Used)\n/g)||[];
  if(resources.length!==3)throw new Error('The report must contain all three resource sections.');
  // Always store the final reviewed English Work Done, not an older local-language preview.
  const expectedStatus=String(payload.completion_status||'').trim().toLowerCase();
  const recordedStatus=String(text.split('Work Completion Status').pop()||'').trim().split('\n')[0].toLowerCase();
  if(expectedStatus!==recordedStatus)throw new Error('Completion status differs from the report text. Click Apply text changes again.');
  const day=siteDate_(payload.work_date,'Work date',true).split('-').reverse().join('/');
  if(text.indexOf('Work Date: '+day)<0)throw new Error('Work date differs from the report text. Reload the report template.');
  const english=text_(payload.work_done,'English Work Done',3000,true);
  return text.replace(/(Work Done:\s*\n)[\s\S]*?(\n\nWork Quantities\b)/,function(_,head,tail){return head+english+tail;});
}
function submitReport(sessionToken,payload) {
  if (!payload || typeof payload!=='object') throw new Error('Invalid report.');
  // Authenticate BEFORE any paid translation request.
  requireRole_(db_(),['supervisor'],sessionToken);
  payload=Object.assign({},payload,{work_done:cspEnglishWork_(payload.work_done)});
  return transaction_(function(ss) {
    const sup=requireRole_(ss,['supervisor'],sessionToken);
    const ticket=rows_(ss,'Tickets').find(function(t){return String(t.id)===String(payload.ticket_id);});
    if (!ticket || !isOpen_(ticket.status) || String(ticket.assigned_supervisor_id)!==String(sup.id) ||
        ticket.assignment_status==='returned' || ticket.assignment_status==='completed') {
      throw new Error('Select a current open ticket assigned to you.');
    }
    const work=text_(payload.work_done,'Work performed',3000,true);
    const completion=String(payload.completion_status||'').toLowerCase();
    if (COMPLETION_STATES.indexOf(completion)<0) throw new Error('Invalid completion status.');
    const existingReports=rows_(ss,'Reports').filter(function(r){return String(r.ticket_id)===String(ticket.id) && String(r.supervisor_id)===String(sup.id);});
    if (existingReports.some(function(r){return r.status==='pending' || r.status==='revision_requested';})) {
      throw new Error('An existing report needs review or revision before you submit another.');
    }
    const lines=reportLinePayload_(ss,payload,[]);
    const reviewer=effectiveLeadId_(ss,sup,ticket,new Date());
    if(!reviewer||String(reviewer)===String(sup.id)||!rows_(ss,'Users').some(function(u){return u.role==='lead'&&String(u.id)===String(reviewer);}))throw new Error('Choose a separate reviewing lead for this ticket before submitting a report.');
    const report={id:newId_(),ticket_id:ticket.id,supervisor_id:sup.id,date:new Date().toISOString(),work_date:siteDate_(payload.work_date||Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd'),'Work date',true),
      approver_id:reviewer,work_measure:number_(payload.work_measure||0,'Work quantity',true),work_measure_unit:text_(payload.work_measure_unit||'','Work unit',32,false),
      work_done:work,daily_report_text:dailyReportText_(payload, ticket, sup),source_transcript:String(payload.source_transcript||'').slice(0,5000),source_language:String(payload.source_language||''),work_quantities_json:JSON.stringify(validateWorkQuantities_(payload.work_quantities)),completion_status:completion,
      amount_of_work:money_(lines.reduce(function(total,l){return total+l.quantity*l.locked_price;},0)),
      status:'pending',revision_note:'',revision_count:0};
    write_(ss,'Reports',report);
    const lineSheet=ss.getSheetByName('Report_Line_Items');
    const insert=lines.map(function(l){return TABLES.Report_Line_Items.map(function(k){return k==='id'?newId_():k==='report_id'?report.id:l[k]||'';});});
    if (insert.length) lineSheet.getRange(lineSheet.getLastRow()+1,1,insert.length,TABLES.Report_Line_Items.length).setValues(insert);
    ticket.assignment_status='in_progress'; write_(ss,'Tickets',ticket);
    notify_(ss,report.approver_id,sup.id,'report_submitted','Report awaiting review',sup.name+' submitted a report for '+ticket.jira_ticket_no,'report',report.id);
    return {id:report.id,status:report.status};
  });
}
function requestRevision(sessionToken,reportId,noteInput) {
  return transaction_(function(ss) {
    const lead=requireRole_(ss,['lead'],sessionToken);
    const report=rows_(ss,'Reports').find(function(r){return String(r.id)===String(reportId);});
    const sup=report && peopleById_(ss)[String(report.supervisor_id)];
    if (!report || !sup || String(report.approver_id||sup.manager_id)!==String(lead.id)) throw new Error('Report is not under your lead.');
    if (report.status!=='pending') throw new Error('Only pending reports can be returned for revision.');
    report.revision_note=text_(noteInput,'Revision comments',1000,true);
    report.revision_count=Number(report.revision_count||0)+1;
    report.status='revision_requested';write_(ss,'Reports',report);
    notify_(ss,sup.id,lead.id,'revision_requested','Report revision requested',
      'Report needs changes: '+report.revision_note,'report',report.id);
    return {ok:true};
  });
}
function reviseReport(sessionToken,reportId,payload) {
  if (!payload || typeof payload!=='object') throw new Error('Invalid revision.');
  requireRole_(db_(),['supervisor'],sessionToken);
  payload=Object.assign({},payload,{work_done:cspEnglishWork_(payload.work_done)});
  return transaction_(function(ss) {
    const sup=requireRole_(ss,['supervisor'],sessionToken);
    const report=rows_(ss,'Reports').find(function(r){return String(r.id)===String(reportId);});
    if (!report || String(report.supervisor_id)!==String(sup.id) || report.status!=='revision_requested') throw new Error('No revision is pending for this report.');
    const prior=rows_(ss,'Report_Line_Items').filter(function(l){return String(l.report_id)===String(report.id);});
    const lines=reportLinePayload_(ss,payload,prior);
    const completion=String(payload.completion_status||'').toLowerCase();
    if (COMPLETION_STATES.indexOf(completion)<0) throw new Error('Invalid completion status.');
    report.work_done=text_(payload.work_done,'Work performed',3000,true);
    report.source_transcript=String(payload.source_transcript||report.source_transcript||'').slice(0,5000);
    report.source_language=String(payload.source_language||report.source_language||'');
    report.work_quantities_json=JSON.stringify(validateWorkQuantities_(payload.work_quantities));
    const currentTicket=rows_(ss,'Tickets').find(function(t){return String(t.id)===String(report.ticket_id);});
    report.daily_report_text=dailyReportText_(payload,currentTicket,sup);
    report.completion_status=completion;
    report.work_measure=number_(payload.work_measure||0,'Work quantity',true);report.work_measure_unit=text_(payload.work_measure_unit||'','Work unit',32,false);
    report.amount_of_work=money_(lines.reduce(function(sum,l){return sum+l.quantity*l.locked_price;},0));
    report.status='pending';report.revision_note='';report.date=new Date().toISOString();report.work_date=siteDate_(payload.work_date||report.work_date||Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd'),'Work date',true);
    write_(ss,'Reports',report);
    const keep=new Set(lines.filter(function(l){return l.id;}).map(function(l){return String(l.id);}));
    prior.filter(function(l){return !keep.has(String(l.id));}).sort(function(a,b){return b._row-a._row;})
      .forEach(function(l){ss.getSheetByName('Report_Line_Items').deleteRow(l._row);});
    const fresh=rows_(ss,'Report_Line_Items').filter(function(l){return String(l.report_id)===String(report.id);});
    const byId=Object.fromEntries(fresh.map(function(l){return [String(l.id),l];}));
    lines.forEach(function(l){const old=byId[String(l.id)];
      write_(ss,'Report_Line_Items',Object.assign({},l,{id:old?old.id:newId_(),report_id:report.id,_row:old?old._row:undefined}));
    });
    notify_(ss,report.approver_id||sup.manager_id,sup.id,'report_resubmitted','Revised report submitted',sup.name+' revised a report for review.','report',report.id);
    return {ok:true};
  });
}
function reviewReport(sessionToken,reportId,action,edits) {
  return transaction_(function(ss) {
    const lead=requireRole_(ss,['lead'],sessionToken);
    const decision=String(action||'').toLowerCase();
    if (decision!=='approved' && decision!=='rejected') throw new Error('Choose Approve or Reject.');
    const report=rows_(ss,'Reports').find(function(r){return String(r.id)===String(reportId);});
    const sup=report && peopleById_(ss)[String(report.supervisor_id)];
    if (!report || !sup || String(report.approver_id||sup.manager_id)!==String(lead.id)) throw new Error('Report is not under your lead.');
    if (String(report.status)!=='pending') throw new Error('This report was already actioned. Reload the dashboard.');
    const lines=rows_(ss,'Report_Line_Items').filter(function(l){return String(l.report_id)===String(report.id);});
    if (decision==='approved') {
      if (!Array.isArray(edits) || edits.length!==lines.length) throw new Error('Submit all original line quantities.');
      const byId={};
      edits.forEach(function(e){const id=String(e.id||'');if(Object.prototype.hasOwnProperty.call(byId,id))throw new Error('Duplicate line item.');byId[id]=number_(e.quantity,'Quantity',true);});
      if (!lines.every(function(l){return Object.prototype.hasOwnProperty.call(byId,String(l.id));})) throw new Error('Line IDs do not match the report.');
      if (lines.length && !lines.some(function(l){return byId[String(l.id)]>0;})) throw new Error('At least one quantity must be positive.');
      lines.forEach(function(l){l.quantity=byId[String(l.id)];write_(ss,'Report_Line_Items',l);});
      report.amount_of_work=money_(lines.reduce(function(sum,l){return sum+Number(l.quantity)*Number(l.locked_price);},0));
      if (report.completion_status==='completed') {
        const ticket=rows_(ss,'Tickets').find(function(t){return String(t.id)===String(report.ticket_id);});
        if (ticket && String(ticket.assigned_supervisor_id)===String(sup.id)) {ticket.assignment_status='completed';write_(ss,'Tickets',ticket);}
      }
    }
    report.status=decision;write_(ss,'Reports',report);
    notify_(ss,sup.id,lead.id,'report_'+decision,'Report '+decision,
      'Your report was '+decision+' by '+lead.name+'.','report',report.id);
    return {id:report.id,status:decision,amount_of_work:Number(report.amount_of_work)};
  });
}

/** Approximate 15:00 reminder in the Apps Script project time zone.
 * Run installDailyReportReminder() once from Apps Script editor after setting
 * the project time zone to Asia/Kolkata (or your site's preferred zone).
 * Time-driven triggers are NOT guaranteed to fire at exactly 15:00.
 */
/** Admin correction is audited. Decisions and locked unit rates remain immutable. */
function adminUpdateReport(sessionToken,reportId,payload) {
  return transaction_(function(ss){
    const actor=requireRole_(ss,['admin'],sessionToken);
    const report=rows_(ss,'Reports').find(function(r){return String(r.id)===String(reportId);});
    if(!report)throw new Error('Report not found.');
    if(!payload||typeof payload!=='object')throw new Error('Invalid edit.');
    const before=Object.assign({},report);
    report.work_done=cspEnglishWork_(payload.work_done);
    const completion=String(payload.completion_status||'');
    if(COMPLETION_STATES.indexOf(completion)===-1)throw new Error('Invalid completion status.');
    report.completion_status=completion;
    report.work_measure=number_(payload.work_measure,'Work quantity',true);
    report.work_measure_unit=text_(payload.work_measure_unit,'Work unit',32,false);
    const lines=rows_(ss,'Report_Line_Items').filter(function(l){return String(l.report_id)===String(report.id);});
    const quantities=payload.lines||[];
    if(!Array.isArray(quantities)||quantities.length!==lines.length)throw new Error('Include every existing line.');
    const updates={};
    quantities.forEach(function(l){if(updates[String(l.id)]!==undefined)throw new Error('Duplicate report line.');updates[String(l.id)]=number_(l.quantity,'Quantity',true);});
    if(!lines.every(function(l){return updates[String(l.id)]!==undefined;}))throw new Error('Unknown report line.');
    if(lines.length && !lines.some(function(l){return updates[String(l.id)]>0;}))throw new Error('At least one item quantity must be positive.');
    const lineBefore=lines.map(function(l){return {id:l.id,quantity:l.quantity};});
    lines.forEach(function(l){l.quantity=updates[String(l.id)];write_(ss,'Report_Line_Items',l);});
    report.amount_of_work=money_(lines.reduce(function(sum,l){return sum+Number(l.quantity)*Number(l.locked_price);},0));
    write_(ss,'Reports',report);
    write_(ss,'Audit_Log',{id:newId_(),actor_id:actor.id,action:'admin_report_edit',target_id:report.id,created_at:new Date().toISOString(),before_json:JSON.stringify({report:publicRow_(before),lines:lineBefore}).slice(0,44000),after_json:JSON.stringify({report:publicRow_(report),lines:lines.map(function(l){return {id:l.id,quantity:l.quantity};})}).slice(0,44000)});
    notify_(ss,report.supervisor_id,actor.id,'report_updated','Report corrected by admin','An administrator corrected report quantities or description.','report',report.id);
    return {ok:true,amount_of_work:report.amount_of_work};
  });
}

function installDailyReportReminder() {
  const handler='sendDailyReportReminders';
  ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===handler;})
    .forEach(function(t){ScriptApp.deleteTrigger(t);});
  const tz=PropertiesService.getScriptProperties().getProperty('SITE_TIMEZONE') || 'Asia/Kolkata';
  ScriptApp.newTrigger(handler).timeBased().everyDays(1).atHour(15).nearMinute(0).inTimezone(tz).create();
  return 'Daily reminders enabled around 15:00 (approximate) in '+tz+'.';
}
function sendDailyReportReminders() {
  return transaction_(function(ss) {
    const tz=PropertiesService.getScriptProperties().getProperty('SITE_TIMEZONE') || 'Asia/Kolkata';
    const now=new Date(); const today=Utilities.formatDate(now,tz,'yyyy-MM-dd');
    const people=peopleById_(ss);
    const reports=rows_(ss,'Reports');
    const oldNotes=rows_(ss,'Notifications');
    let count=0;
    rows_(ss,'Tickets').forEach(function(t) {
      const sup=people[String(t.assigned_supervisor_id)];
      if (!sup || (sup.role!=='supervisor' && !(sup.role==='lead'&&String(sup.can_supervise)==='true')) || !isOpen_(t.status) ||
        t.assignment_status==='returned' || t.assignment_status==='completed') return;
      const reported=reports.some(function(r){return String(r.ticket_id)===String(t.id) &&
        String(r.supervisor_id)===String(sup.id) &&
        Utilities.formatDate(new Date(r.date),tz,'yyyy-MM-dd')===today;});
      const duplicate=oldNotes.some(function(n){return n.type==='daily_reminder' && String(n.target_id)===String(t.id) &&
        String(n.recipient_id)===String(sup.id) && Utilities.formatDate(new Date(n.created_at),tz,'yyyy-MM-dd')===today;});
      if (!reported && !duplicate) {
        notify_(ss,sup.id,'','daily_reminder','Daily field report due',
          'No report was submitted today for '+t.jira_ticket_no+'. Submit work quantities, or return the ticket with a reason if no work was done.','ticket',t.id);
        count++;
      }
    });
    return {notified:count,day:today};
  });
}

/**
 * Jira Server / Data Center integration for https://servicedesk.isha.in.
 * Script Properties:
 *   JIRA_BASE_URL = https://servicedesk.isha.in
 *   JIRA_API_TOKEN = personal access token issued by Jira
 *   JIRA_PROJECT_KEY = CIVIL (optional default)
 *   JIRA_AUTH_MODE = bearer (Data Center) or basic (if old connector used basic)
 *   JIRA_SUBDEPARTMENT_FIELD = customfield_12345 (optional)
 *   JIRA_LOCATION_FIELD, JIRA_ENGINEER_FIELD, JIRA_DEPARTMENT_FIELD (optional)
 *   JIRA_EXTRA_JQL = reporter in (...) (optional AND clause for Admin-raised issues)
 * The legacy Jira.gs configuration stored as Script Property "config" is also supported
 * if it lives in THIS SAME Apps Script project; distinct projects do not share secrets.
 * All credentials remain on the server. No arbitrary URLs or JQL are accepted
 * from the browser. The token's Jira permissions bound what can be imported.
 */
/** Compatible with the already-working Jira.gs connector.
 *  Data Center: GET /rest/api/2/search with Bearer PAT, opt-in header and retries.
 *  Config stays SERVER-SIDE. A legacy "config" value is accepted only if it
 *  exists in THIS Apps Script project's Script Properties.
 */
function jiraLegacyConfig_(props) {
  const raw = props.getProperty('config');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}
function jiraConfigured_(props) {
  const old = jiraLegacyConfig_(props);
  return !!(String(props.getProperty('JIRA_API_TOKEN') || old.jiraToken || '').trim() &&
    String(props.getProperty('JIRA_BASE_URL') || old.jiraBaseUrl || '').trim());
}
function jiraSettings_() {
  const p = PropertiesService.getScriptProperties();
  const old = jiraLegacyConfig_(p);
  const host = String(p.getProperty('JIRA_BASE_URL') || old.jiraBaseUrl || 'https://servicedesk.isha.in')
    .trim().replace(/\/+$/, '');
  const token = String(p.getProperty('JIRA_API_TOKEN') || old.jiraToken || '').trim();
  const mode = String(p.getProperty('JIRA_AUTH_MODE') || old.authMode || 'bearer').trim().toLowerCase();
  const email = String(p.getProperty('JIRA_EMAIL') || old.jiraUser || '').trim();
  if (!/^https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9](?::443)?$/i.test(host) ||
      /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(host)) {
    throw new Error('JIRA_BASE_URL must be the Jira HTTPS site root, for example https://servicedesk.isha.in.');
  }
  if (!token) {
    throw new Error('No Jira token in this Apps Script project. Set JIRA_API_TOKEN in Project Settings -> Script Properties. Token settings in a different Apps Script project are not shared.');
  }
  if (mode !== 'bearer' && mode !== 'basic') throw new Error('JIRA_AUTH_MODE must be bearer (Data Center PAT) or basic (older connector).');
  if (mode === 'basic' && !email) throw new Error('For basic authentication, set JIRA_EMAIL in Script Properties.');
  const names = ['JIRA_LOCATION_FIELD', 'JIRA_ENGINEER_FIELD', 'JIRA_DEPARTMENT_FIELD', 'JIRA_SUBDEPARTMENT_FIELD'];
  const custom = names.map(function(name) { return String(p.getProperty(name) || '').trim(); });
  custom.forEach(function(name) {
    if (name && !/^customfield_\d+$/.test(name)) throw new Error('Invalid custom Jira field ID: ' + name);
  });
  return {host: host, token: token, mode: mode, email: email, custom: custom, props: p,
    source: p.getProperty('JIRA_API_TOKEN') ? 'Script Properties (JIRA_API_TOKEN)' : 'legacy config (same project)'};
}

/** Uses the exact read-only URL and header approach from the supplied Jira.gs.
 *  GET is the default; search JQL is passed as query parameters, NOT a POST body.
 */
function jiraRequest_(settings, path, query) {
  const params = query || {};
  const suffix = Object.keys(params).map(function(key) {
    const value = Array.isArray(params[key]) ? params[key].join(',') : params[key];
    return encodeURIComponent(key) + '=' + encodeURIComponent(value);
  }).join('&');
  const url = settings.host + path + (suffix ? (path.indexOf('?') === -1 ? '?' : '&') + suffix : '');
  const headers = {Accept: 'application/json', 'X-ExperimentalApi': 'opt-in'};
  headers.Authorization = settings.mode === 'basic'
    ? 'Basic ' + Utilities.base64Encode(settings.email + ':' + settings.token)
    : 'Bearer ' + settings.token;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get', headers: headers, muteHttpExceptions: true, followRedirects: false
      });
    } catch (error) {
      // Never include Authorization values or raw HTTP bodies in messages.
      const raw = String(error && error.message || error || 'unknown transport error');
      const safe = raw.split(settings.token).join('[redacted]').slice(0, 350);
      throw new Error('Jira GET request failed before an HTTP response: ' + safe +
        '. The previous connector used this same GET method. Check Apps Script Executions and whether the two deployments have different network permissions.');
    }
    const code = response.getResponseCode();
    if ([429, 502, 503, 504].indexOf(code) !== -1 && attempt < 2) {
      const h = response.getHeaders ? response.getHeaders() : {};
      const secs = Math.min(10, Math.max(1, Number(h['Retry-After'] || h['retry-after']) || Math.pow(2, attempt)));
      Utilities.sleep(secs * 1000);
      continue;
    }
    if (code >= 300 && code < 400) throw new Error('Jira redirected the REST call (HTTP ' + code + '). Check direct API access versus the SSO browser login.');
    if (code === 401) throw new Error('Jira HTTP 401: the token or authentication mode was rejected. Verify the existing token and JIRA_AUTH_MODE.');
    if (code === 403) throw new Error('Jira HTTP 403: the token account lacks access to this issue/project or REST API.');
    if (code === 404) throw new Error('Jira HTTP 404: project or ticket not found, or this REST endpoint is unavailable.');
    if (code !== 200) {
      let detail = '';
      try {
        const parsed = JSON.parse(response.getContentText());
        detail = (parsed.errorMessages || []).join('; ') || String(parsed.message || '');
        if (parsed.errors) detail += ' ' + Object.keys(parsed.errors).map(function(k) { return k + ': ' + parsed.errors[k]; }).join('; ');
      } catch (_) {}
      detail = String(detail).split(settings.token).join('[redacted]').slice(0, 300);
      throw new Error('Jira HTTP ' + code + ' on ' + path.split('?')[0] + (detail ? ': ' + detail : ''));
    }
    try { return JSON.parse(response.getContentText()); }
    catch (_) { throw new Error('Jira returned non-JSON on ' + path.split('?')[0] + '. Check API routing.'); }
  }
  throw new Error('Jira retry limit exceeded.');
}

function jiraProjectKey_(input) {
  const key = String(input || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(key)) {
    throw new Error('Enter a valid Jira project key, e.g. CIVIL or FAB.');
  }
  return key;
}
function jiraIssueKey_(input) {
  const key = String(input || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,29}-[1-9]\d{0,11}$/.test(key)) {
    throw new Error('Enter a Jira ticket number such as CIVIL-123.');
  }
  return key;
}
function jiraAssigneeFields_(settings) {
  if(settings.assigneeFields)return settings.assigneeFields;
  const p=settings.props;
  return ['JIRA_ASSIGNEE_MAINTENANCE_FIELD','JIRA_ASSIGNEE_NEW_WORKS_FIELD','JIRA_ASSIGNEE_NEW_PROJECTS_FIELD']
    .map(function(n){return String(p.getProperty(n)||'').trim();}).filter(function(x){return /^customfield_\d+$/.test(x);});
}
function jiraFieldMetadata_(settings){
  if(settings.fieldMeta)return settings.fieldMeta;
  settings.fieldMeta=jiraRequest_(settings,'/rest/api/2/field');
  return settings.fieldMeta;
}
function jiraResolveAssigneeFields_(settings) {
  const ids=jiraAssigneeFields_(settings);
  if(ids.length===3){settings.assigneeFields=ids;settings.assigneeGroups=Object.fromEntries(ids.map(function(id,i){return [id,['maintenance','new_works','new_projects'][i]];}));return;}
  // Look up EXACT Jira labels. Do not accept the generic issue assignee instead.
  const wanted=['Assignee_Maintenance','Assignee_New Works','Assignee_New Projects'];
  const normalize=function(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');};
  let fieldList=[];
  try{fieldList=jiraFieldMetadata_(settings);}catch(error){
    // Lack of Jira custom-field metadata must not prevent manual ticket synchronization.
    // Existing manually assigned supervisors remain attached to their tickets.
    settings.assigneeFields=ids;
    settings.assigneeMappingWarning='Custom supervisor fields are unavailable. The standard Jira Assignee will be used where its name matches the approved roster.';
    return;
  }
  settings.assigneeGroups={};
  settings.assigneeFields=Array.from(new Set(wanted.map(function(label,index){
    const found=(fieldList||[]).find(function(f){return normalize(f.name)===normalize(label);});
    if(found&&/^customfield_\d+$/.test(String(found.id))){settings.assigneeGroups[String(found.id)]=['maintenance','new_works','new_projects'][index];return String(found.id);}return '';
  }).concat(ids).filter(Boolean)));
  if(!settings.assigneeFields.length)settings.assigneeMappingWarning='Custom supervisor fields were not found. Using the standard Jira Assignee when it matches one of the 12 approved supervisors.';
}
function jiraResolveLocationField_(settings){
  // IESM_Location is a *specific field* in the CIVIL desk, not the ticket summary.
  if(settings.custom[0])return;
  const norm=function(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');};
  const explicit=String(settings.props.getProperty('JIRA_LOCATION_FIELD')||'').trim();
  if(explicit){if(!/^customfield_\d+$/.test(explicit))throw new Error('Invalid JIRA_LOCATION_FIELD.');settings.custom[0]=explicit;return;}
  try{const fields=jiraFieldMetadata_(settings);
    const matches=(fields||[]).filter(function(f){return norm(f.name)==='iesmlocation' && /^customfield_\d+$/.test(String(f.id||''));});
    if(matches.length===1){settings.custom[0]=matches[0].id;return;}
  }catch(e){/* Use visible placeholder rather than making up a location. */}
  settings.locationWarning='IESM_Location Jira field was not detected. Set JIRA_LOCATION_FIELD to the exact customfield ID; empty locations will be shown as —.';
}
function jiraResolveDisplayFields_(settings){
  const options=[['contact','JIRA_CONTACT_FIELD','Contact Number'],['request','JIRA_REQUEST_TYPE_FIELD','Request Type'],
    ['subRequest','JIRA_SUB_REQUEST_FIELD','Sub-Request Type'],['design','JIRA_DESIGN_NEEDED_FIELD','Design Needed']];
  const norm=function(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');};
  let fields=[];try{fields=jiraFieldMetadata_(settings);}catch(_){/* Existing Script Properties may still work. */}
  settings.displayFields={};
  options.forEach(function(row){const prop=String(settings.props.getProperty(row[1])||'').trim();
    if(prop && !/^customfield_\d+$/.test(prop))throw new Error('Invalid '+row[1]+' custom field ID.');
    const match=fields.find(function(f){return norm(f.name)===norm(row[2])&&/^customfield_\d+$/.test(String(f.id||''));});
    settings.displayFields[row[0]]=prop||match&&String(match.id)||'';
  });
}
function jiraFields_(settings) {
  return Array.from(new Set(['summary','status','assignee','project','components','issuelinks','created','reporter']
    .concat(settings.custom.filter(Boolean)).concat(Object.values(settings.displayFields||{}).filter(Boolean)).concat(settings.assigneeFields||jiraAssigneeFields_(settings))));
}
function jiraAssigneeList_(fields,settings) {
  const output=[];
  (settings.assigneeFields||jiraAssigneeFields_(settings)).forEach(function(id){
    const value=fields[id];
    (Array.isArray(value)?value:[value]).forEach(function(x){
      if(!x)return;
      const o=typeof x==='object'?x:{displayName:String(x)};
      const name=String(o.displayName||o.name||o.value||'').trim();
      const email=String(o.emailAddress||o.email||'').trim().toLowerCase();
      if(name||email)output.push({name:name,email:email,group:settings.assigneeGroups&&settings.assigneeGroups[id]||''});
    });
  });
  // Jira's built-in Assignee is visible in the provided screenshot; it can hold the supervisor
  // even when the optional three custom assignee fields do not exist.
  if(fields.assignee){const a=fields.assignee;
    const name=String(a.displayName||a.name||a.value||'').trim();const email=String(a.emailAddress||a.email||'').toLowerCase().trim();
    if(name||email)output.push({name:name,email:email,group:''});
  }
  return output;
}
function jiraMatchesSupervisor_(ticket,user) {
  let assigned=[]; try{assigned=JSON.parse(String(ticket.jira_assignees||'[]'));}catch(_){}
  if(!Array.isArray(assigned)||!assigned.length)return false;
  const norm=function(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');};
  return assigned.some(function(a){return (a.email && String(a.email).toLowerCase()===String(user.email).toLowerCase()) ||
    (a.name && norm(a.name) && norm(a.name)===norm(user.name));});
}
function jiraMapIssue_(issue, settings) {
  const f = issue.fields || {};
  const cf = settings.custom;
  const projectName = jiraText_(cf[2] ? f[cf[2]] : null) || jiraText_(f.project) || 'Unassigned';
  const subDept = jiraText_(cf[3] ? f[cf[3]] : null) || jiraText_(f.components) || '';
  return {
    jira_ticket_no: text_(issue.key, 'Jira key', 80, true),
    location: text_(jiraText_(cf[0] ? f[cf[0]] : null) || '', 'IESM_Location', 240, false),
    engineer_name: text_(jiraText_(cf[1] ? f[cf[1]] : null) || jiraText_(f.assignee) || 'Unassigned', 'Engineer', 160, false),
    status: text_(jiraText_(f.status) || 'Unknown', 'Status', 100, false),
    department: text_(projectName, 'Department', 160, false),
    project_key: text_(jiraText_(f.project && f.project.key) || String(issue.key).split('-')[0], 'Project key', 40, false),
    sub_department: text_(subDept, 'Sub-department', 180, false),
    summary: text_(f.summary || '', 'Summary', 400, false),
    jira_assignees:JSON.stringify(jiraAssigneeList_(f,settings)),
    jira_assignment_group:(jiraAssigneeList_(f,settings).find(function(a){return a.group;})||{}).group||'',
    issue_links_json:JSON.stringify(jiraIssueLinks_(f.issuelinks)),
    created:String(f.created||''),contact_number:jiraText_(f[settings.displayFields&&settings.displayFields.contact]||'').slice(0,60),
    request_type:jiraText_(f[settings.displayFields&&settings.displayFields.request]||'').slice(0,160),
    sub_request_type:jiraText_(f[settings.displayFields&&settings.displayFields.subRequest]||'').slice(0,160),
    design_needed:jiraText_(f[settings.displayFields&&settings.displayFields.design]||'').slice(0,80),
    reporter:jiraText_(f.reporter).slice(0,160),jira_assignee:jiraText_(f.assignee).slice(0,160)
  };
}


/** Same people, different Jira and staff-sheet display names. Never rename staff records. */
function cspCanonicalJiraName_(name){
  const key=String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const aliases={
    raju:'rajuvenkatesh',rajuvenkatesh:'rajuvenkatesh',
    balakrishnan:'balakrishanan',balakrishanan:'balakrishanan',balakrishnanerusappan:'balakrishanan',
    kalairasan:'kalai',kalaijarasanpanneerselvam:'kalai',kalai:'kalai',
    vasanth:'vasant',vasanthkongarayan:'vasant',vasant:'vasant',
    shiva:'siva',siva:'siva',vignesh:'vighnesh',vighnesh:'vighnesh',
    bankim:'bankim'
  };
  return aliases[key]||key;
}
function cspJiraAssigneeMatch_(ticket,user){
  let assignees=[];
  try{assignees=JSON.parse(ticket.jira_assignees||'[]');}catch(_){}
  if(!Array.isArray(assignees))return false;
  const email=String(user.email||'').toLowerCase().trim();
  const name=cspCanonicalJiraName_(user.name);
  return assignees.some(function(a){
    const jiraEmail=String(a.email||'').toLowerCase().trim();
    const jiraName=cspCanonicalJiraName_(a.name);
    // An exact verified email is best; otherwise use the explicit display-name mapping.
    return (email&&jiraEmail&&email===jiraEmail)||(name&&jiraName&&name===jiraName);
  });
}

function upsertJiraIssues_(sessionToken, allowedRoles, issues, settings) {
  const rows = issues.map(function(issue) { return jiraMapIssue_(issue, settings); });
  return transaction_(function(ss) {
    requireRole_(ss, allowedRoles, sessionToken);
    const existing = rows_(ss, 'Tickets');
    const users = rows_(ss, 'Users').filter(function(u){return u.role==='supervisor'||(u.role==='lead'&&String(u.can_supervise)==='true');});
    const resolvedSupervisor=function(t){
      const matched=users.filter(function(u){return cspJiraAssigneeMatch_(t,u);});
      return matched.length===1 ? matched[0].id : '';
    };
    const byKey = Object.fromEntries(existing.map(function(t) { return [String(t.jira_ticket_no).toUpperCase(), t]; }));
    const sheet = ss.getSheetByName('Tickets');
    const additions = [];
    let created = 0;
    let updated = 0;
    let lastTicket = null;
    const newlyAssigned=[];
    const seen = new Set();
    rows.forEach(function(t) {
      const key = String(t.jira_ticket_no).toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      const old = byKey[key];
      if (old) {
        const match=resolvedSupervisor(t);
        const merged = Object.assign({}, old, t, {id: old.id, _row: old._row});
        if(match && String(old.assigned_supervisor_id||'')!==String(match) && (!old.assigned_by||old.assigned_by==='jira')){
          merged.assigned_supervisor_id=match;merged.assigned_at=new Date().toISOString();merged.assigned_by='jira';merged.assignment_status='assigned';
          newlyAssigned.push({ticket:merged,previous:String(old.assigned_supervisor_id||'')});
        }
        write_(ss, 'Tickets', merged);
        updated++;
        lastTicket = publicRow_(merged);
      } else {
        const match=resolvedSupervisor(t);
        const added = Object.assign({id: newId_(),assigned_supervisor_id:match||'',assigned_at:match?new Date().toISOString():'',assigned_by:match?'jira':'',assignment_status:match?'assigned':''}, t);
        additions.push(added);
        if(match)newlyAssigned.push({ticket:added,previous:''});
        created++;
        lastTicket = added;
      }
    });
    if (additions.length) {
      const values = additions.map(function(t) { return TABLES.Tickets.map(function(k) { return t[k] || ''; }); });
      sheet.getRange(sheet.getLastRow() + 1, 1, values.length, TABLES.Tickets.length).setValues(values);
    }
    newlyAssigned.slice(0,150).forEach(function(entry){
      const ticket=entry.ticket;const sup=users.find(function(u){return String(u.id)===String(ticket.assigned_supervisor_id);});
      notify_(ss,ticket.assigned_supervisor_id,'jira','ticket_assigned','Jira ticket assigned',ticket.jira_ticket_no+' — '+ticket.summary,'ticket',ticket.id);
      if(sup)notifyLeads_(ss,sup,'jira','ticket_assigned','Supervisor assigned in Jira',sup.name+': '+ticket.jira_ticket_no,'ticket',ticket.id);
      if(entry.previous)notify_(ss,entry.previous,'jira','ticket_reassigned','Jira ticket reassigned',ticket.jira_ticket_no+' has moved to another supervisor.','ticket',ticket.id);
    });
    return {created: created, updated: updated, ticket: lastTicket,assignmentAlerts:newlyAssigned.length};
  });
}

/** Admin: available projects readable by the Jira service-account token. */
function listJiraProjects(sessionToken) {
  requireRole_(db_(), ['admin'], sessionToken);
  const settings = jiraSettings_();
  const projects = jiraRequest_(settings, '/rest/api/2/project');
  if (!Array.isArray(projects)) throw new Error('Unexpected Jira project-list response.');
  return projects.filter(function(p) { return p && /^[A-Z][A-Z0-9_]{1,29}$/i.test(String(p.key || '')); })
    .map(function(p) { return {key: String(p.key).toUpperCase(), name: String(p.name || p.key)}; })
    .sort(function(a, b) { return a.name.localeCompare(b.name); });
}

/** Admin: sync selected project, using Jira Server/Data Center's working GET /search API.
 * Fail before writing rows if a response is malformed or a required page is missing.
 * Up to the first 1,000 matches are imported per run (newest first).
 */
function syncJiraTickets(sessionToken, payload) {
  requireRole_(db_(), ['admin'], sessionToken);
  const settings = jiraSettings_();
  jiraResolveAssigneeFields_(settings);jiraResolveLocationField_(settings);jiraResolveDisplayFields_(settings);
  const project = 'CIVIL'; // Civil Service Desk only, regardless of client payload.
  const extra = String(settings.props.getProperty('JIRA_EXTRA_JQL') || '').trim();
  const jql = 'project = ' + project + (extra ? ' AND (' + extra + ')' : '') + ' ORDER BY updated DESC';
  const results = [];
  const seen = {};
  let startAt = 0;
  let total = null;
  for (let page = 0; page < 10; page++) {
    const data = jiraRequest_(settings, '/rest/api/2/search', {
      jql: jql, startAt: startAt, maxResults: 100, fields: jiraFields_(settings).join(',')
    });
    if (!data || !Array.isArray(data.issues)) throw new Error('Jira search returned no issues array; no tickets were changed.');
    const issues = data.issues;
    if (!issues.length && total !== null && startAt < total) {
      throw new Error('Jira returned an incomplete issue page; no tickets were changed.');
    }
    issues.forEach(function(issue) {
      const key = String(issue.key || '').toUpperCase();
      if (!key || seen[key]) throw new Error('Jira search returned a duplicate or missing issue key; no tickets were changed.');
      seen[key] = true;
      results.push(issue);
    });
    startAt += issues.length;
    if (data.total !== undefined && data.total !== null) total = Number(data.total);
    if (!issues.length || (total !== null && startAt >= total) ||
        (total === null && issues.length < 100)) break;
  }
  const counts = upsertJiraIssues_(sessionToken, ['admin'], results, settings);
  return {created: counts.created, updated: counts.updated, fetched: results.length,
    limited: total !== null && startAt < total, project: project, requestMethod: 'GET',
    supervisorMapping:settings.assigneeFields&&settings.assigneeFields.length?'custom fields + built-in Assignee':'built-in Assignee',
    warning:[settings.assigneeMappingWarning||'',settings.locationWarning||''].filter(Boolean).join(' ')};
}

/** Admin: exact CIVIL issue lookup, comments, links and budget summaries. */
function fetchJiraTicketByKey(sessionToken, issueKey) {
  requireRole_(db_(), ['admin'], sessionToken);
  const key=jiraIssueKey_(issueKey);
  if (key.split('-')[0]!=='CIVIL') throw new Error('Only Civil Service Desk (CIVIL) tickets are permitted.');
  const settings=jiraSettings_();jiraResolveAssigneeFields_(settings);jiraResolveLocationField_(settings);jiraResolveDisplayFields_(settings);
  const issue=jiraRequest_(settings,'/rest/api/2/issue/'+encodeURIComponent(key),{fields:'*all',expand:'renderedFields'});
  if (!issue || String(issue.key||'').toUpperCase()!==key) throw new Error('Jira did not return the expected issue.');
  let fieldLabels={};try{jiraRequest_(settings,'/rest/api/2/field').forEach(function(f){fieldLabels[f.id]=String(f.name||f.id);});}catch(_){/* Keep field IDs when metadata is unavailable. */}
  const detail=jiraDetailShape_(issue,fieldLabels);
  const comments=jiraGetComments_(settings,key);
  detail.comments=comments;
  detail.budget=comments.filter(function(c){return /\bbudget\b|estimate|estimated cost|sanction|approved amount|rs\.?\s*\d|₹/i.test(c.body);}).slice(-30);
  const result=upsertJiraIssues_(sessionToken,['admin'],[issue],settings);
  transaction_(function(ss){const t=rows_(ss,'Tickets').find(function(r){return r.jira_ticket_no===key;});
    if(t){t.budget_details=detail.budget.map(function(c){return c.author+': '+c.body;}).join('\n').slice(0,35000);
      t.issue_links_json=JSON.stringify(detail.links);write_(ss,'Tickets',t);}});
  return {ticket:result.ticket,detail:detail};
}
function jiraIssueLinks_(links) {
  return (Array.isArray(links)?links:[]).slice(0,40).map(function(x){
    const target=x.outwardIssue||x.inwardIssue||{};
    return {key:String(target.key||''),relationship:String((x.type||{})[x.outwardIssue?'outward':'inward']||x.type&&x.type.name||'linked'),
      summary:String((target.fields||{}).summary||'').slice(0,240),status:jiraText_((target.fields||{}).status).slice(0,80),
      priority:jiraText_((target.fields||{}).priority).slice(0,80),assignee:jiraText_((target.fields||{}).assignee).slice(0,160)};
  });
}
function jiraDetailShape_(issue,fieldLabels) {
  const f=issue.fields||{};
  const properties=Object.keys(f).sort().map(function(key){
    const value=f[key];if(value==null || value==='' || key==='comment'||key==='issuelinks')return null;
    const label=(fieldLabels&&fieldLabels[key])||String(key).replace(/^customfield_/,'Custom field ');
    const valueStr=typeof value==='object'?JSON.stringify(value):String(value);
    return {key:key,label:label,value:valueStr.slice(0,2000)};
  }).filter(Boolean).slice(0,180);
  return {key:String(issue.key||''),summary:String(f.summary||''),description:jiraText_(f.description).slice(0,12000),
    status:jiraText_(f.status),priority:jiraText_(f.priority),reporter:jiraText_(f.reporter),
    assignee:jiraText_(f.assignee),created:String(f.created||''),updated:String(f.updated||''),
    links:jiraIssueLinks_(f.issuelinks),properties:properties};
}
function jiraGetComments_(settings,key) {
  const out=[]; let start=0;
  for(let n=0;n<10;n++){
    const page=jiraRequest_(settings,'/rest/api/2/issue/'+encodeURIComponent(key)+'/comment',{startAt:start,maxResults:100});
    const comments=page.comments||[]; if(!Array.isArray(comments))break;
    comments.forEach(function(c){out.push({author:jiraText_(c.author)||'Unknown',created:String(c.created||''),body:jiraText_(c.body).slice(0,3500)});});
    start+=comments.length;if(!comments.length || start>=Number(page.total||0))break;
  }
  return out.slice(-500);
}
/** Admin: confirm the configured token and direct API connection. */
function testJiraConnection(sessionToken) {
  requireRole_(db_(), ['admin'], sessionToken);
  const settings = jiraSettings_();
  const me = jiraRequest_(settings, '/rest/api/2/myself');
  return {ok: true, account: String(me.displayName || me.name || 'Authorized Jira account'), requestMethod: 'GET', credentialSource: settings.source};
}

function jiraText_(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(jiraText_).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return String(value.displayName || value.value || value.name || value.key || value.text || '');
  }
  return String(value);
}

/** Live Jira Service Management queues; never accept arbitrary URLs/JQL from browsers. */
function jiraPaged_(settings,path,limitPages) {
  let records=[];
  let start=0;
  for (let i=0;i<limitPages;i++) {
    const page=jiraRequest_(settings,path,{start:start,limit:50,includeCount:'true'});
    if (!page || !Array.isArray(page.values)) throw new Error('Unexpected Jira service desk response.');
    records=records.concat(page.values);
    start+=page.values.length;
    if (page.isLastPage===true || !page.values.length || page.values.length<50) break;
  }
  return records;
}
function listJiraServiceDesks(sessionToken) {
  requireRole_(db_(),['admin'],sessionToken);
  return jiraPaged_(jiraSettings_(),'/rest/servicedeskapi/servicedesk',20)
    .map(function(d){return {id:String(d.id),name:String(d.projectName||d.name||d.projectKey||'Service desk'),projectKey:String(d.projectKey||'')};})
    .filter(function(d){return /^\d+$/.test(d.id);});
}
function listJiraQueues(sessionToken,deskId) {
  requireRole_(db_(),['admin'],sessionToken);
  if (!/^\d+$/.test(String(deskId||''))) throw new Error('Select a valid service desk.');
  return jiraPaged_(jiraSettings_(),'/rest/servicedeskapi/servicedesk/'+deskId+'/queue',20)
    .map(function(q){return {id:String(q.id),name:String(q.name||'Unnamed queue'),count:Number(q.issueCount||0)};})
    .filter(function(q){return /^\d+$/.test(q.id);});
}
function listJiraQueueIssues(sessionToken,deskId,queueId,startInput) {
  requireRole_(db_(),['admin'],sessionToken);
  if (!/^\d+$/.test(String(deskId||'')) || !/^\d+$/.test(String(queueId||''))) throw new Error('Select a valid queue.');
  const start=Number(startInput||0);
  if (!Number.isInteger(start)||start<0||start>10000) throw new Error('Invalid queue page.');
  const path='/rest/servicedeskapi/servicedesk/'+deskId+'/queue/'+queueId+'/issue';
  const page=jiraRequest_(jiraSettings_(),path,{start:start,limit:50});
  if (!page || !Array.isArray(page.values)) throw new Error('Unexpected queue issue response.');
  return {issues:page.values.map(function(issue){
    const f=issue.fields||{};
    return {key:String(issue.key||''),summary:String(f.summary||''),status:jiraText_(f.status)||'Unknown',assignee:jiraText_(f.assignee)||''};
  }).filter(function(issue){return /^[A-Z][A-Z0-9_]{1,29}-[1-9]\d{0,11}$/.test(issue.key);}),
  next:page.isLastPage===true||page.values.length<50?null:start+page.values.length};
}

/** Access the native workbook, creating a fresh template on first use if needed.
 * Historical XLSX response rows are not auto-imported, so the old file is unchanged. */
function reportingWorkbook_() { return ensureReportingWorkbook_(); }
function getReportingWorkbook(sessionToken,tabName,pageInput,pageSizeInput) {
  requireRole_(db_(),['admin'],sessionToken);
  const book=reportingWorkbook_();const all=book.getSheets();
  const tab=tabName?book.getSheetByName(String(tabName)):all.find(function(s){return s.getName()==='Form Responses 1';})||all[0];
  if(!tab)throw new Error('Sheet not found.');
  const pagesize=Math.max(10,Math.min(75,Number(pageSizeInput)||35));
  const lastRow=tab.getLastRow(),lastCol=tab.getLastColumn();
  const page=Math.max(1,Math.min(100000,Number(pageInput)||1));
  const first=Math.max(1,(page-1)*pagesize+1);
  const count=Math.max(0,Math.min(pagesize,lastRow-first+1));
  const width=Math.min(70,lastCol||1);
  const r=count?tab.getRange(first,1,count,width):null;
  const formatted=r?r.getDisplayValues():[];
  const colors=r?r.getBackgrounds():[];
  const fontColors=r?r.getFontColors():[];
  const formulas=r?r.getFormulas():[];
  const fontWeights=r?r.getFontWeights():[];
  const fontSizes=r?r.getFontSizes():[];
  const fontFamilies=r?r.getFontFamilies():[];
  const headers=lastRow?tab.getRange(1,1,1,width).getDisplayValues()[0]:[];
  const headerColors=lastRow?tab.getRange(1,1,1,width).getBackgrounds()[0]:[];
  return {tab:tab.getName(),tabs:all.map(function(s){return s.getName();}),page:page,pageSize:pagesize,
    totalRows:lastRow,totalColumns:lastCol,firstRow:first,lastRow:first+count-1,
    headers:headers,headerColors:headerColors,rows:formatted,colors:colors,fontColors:fontColors,formulas:formulas,fontWeights:fontWeights,fontSizes:fontSizes,fontFamilies:fontFamilies,
    url:book.getUrl()};
}
function workbookEdit_(sessionToken,fn){
  requireRole_(db_(),['admin'],sessionToken);
  // Resolve/auto-create the workbook before taking the edit lock to avoid nested locks.
  const book=reportingWorkbook_();
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{return fn(book);}finally{lock.releaseLock();}
}
function reportingTab_(book,name){const tab=book.getSheetByName(String(name||''));if(!tab)throw new Error('Worksheet not found.');return tab;}
function workbookCell_(value) {
  if(value===null||value===undefined)return '';
  const v=String(value);if(v.length>15000)throw new Error('Cell content exceeds 15,000 characters.');
  // Explicitly entered formulas are allowed for the admin, preserving totals.
  // Other values beginning with Excel operators are treated as plain text.
  return /^=/.test(v)?v:/^[+\-@\t\r]/.test(v)?"'"+v:v;
}
/** Header rename only; formulas and data rows are untouched. */
function renameReportingWorkbookColumn(sessionToken,tabName,colInput,newHeading){
  requireRole_(db_(),['admin'],sessionToken);
  const book=ensureReportingWorkbook_();
  const tab=book.getSheetByName(String(tabName||''));
  if(!tab)throw new Error('Worksheet not found.');
  const col=Number(colInput);if(!Number.isInteger(col)||col<1||col>tab.getLastColumn())throw new Error('Invalid column.');
  const name=text_(newHeading,'Column heading',90,true);
  const cell=tab.getRange(1,col);if(cell.getFormula())throw new Error('Cannot rename a formula cell.');
  const old=cell.getDisplayValue();cell.setValue(name);
  return {oldHeading:old,newHeading:name,column:col};
}

function editReportingWorkbookCell(sessionToken,tabName,rowInput,colInput,value) {
  return workbookEdit_(sessionToken,function(book){const tab=reportingTab_(book,tabName);const row=Number(rowInput),col=Number(colInput);
    if(!Number.isInteger(row)||row<1||row>tab.getLastRow()||!Number.isInteger(col)||col<1||col>tab.getLastColumn())throw new Error('Cell is outside the worksheet.');
    tab.getRange(row,col).setValue(workbookCell_(value));return {ok:true};});
}
function insertReportingWorkbookRow(sessionToken,tabName,afterRowInput) {
  return workbookEdit_(sessionToken,function(book){const tab=reportingTab_(book,tabName);const after=Number(afterRowInput);
    if(!Number.isInteger(after)||after<1||after>tab.getLastRow()||tab.getLastRow()>=30000)throw new Error('Invalid insertion row.');
    tab.insertRowAfter(after);const width=tab.getLastColumn();
    if(width){const source=after>1?after:after+2;
      if(source<=tab.getLastRow()){const dest=tab.getRange(after+1,1,1,width);tab.getRange(source,1,1,width).copyTo(dest);
        const formulaFlags=dest.getFormulas()[0];
        formulaFlags.forEach(function(formula,i){if(!formula)tab.getRange(after+1,i+1).clearContent();});
      }}
    return {ok:true};});
}
function deleteReportingWorkbookRow(sessionToken,tabName,rowInput) {
  return workbookEdit_(sessionToken,function(book){const tab=reportingTab_(book,tabName);const row=Number(rowInput);
    if(!Number.isInteger(row)||row<=1||row>tab.getLastRow())throw new Error('Cannot delete header or nonexistent row.');
    tab.deleteRow(row);return {ok:true};});
}
function insertReportingWorkbookColumn(sessionToken,tabName,afterColInput,heading) {
  return workbookEdit_(sessionToken,function(book){const tab=reportingTab_(book,tabName);const col=Number(afterColInput);
    if(!Number.isInteger(col)||col<1||col>tab.getLastColumn()||tab.getLastColumn()>=70)throw new Error('Invalid column.');
    tab.insertColumnAfter(col);
    const rowCount=tab.getLastRow();if(rowCount)tab.getRange(1,col,Math.min(rowCount,3000),1).copyTo(tab.getRange(1,col+1,Math.min(rowCount,3000),1),{formatOnly:true});
    tab.getRange(1,col+1).setValue(text_(heading,'New column heading',80,true));return {ok:true};});
}
function deleteReportingWorkbookColumn(sessionToken,tabName,colInput) {
  return workbookEdit_(sessionToken,function(book){const tab=reportingTab_(book,tabName);const col=Number(colInput);
    if(!Number.isInteger(col)||col<1||col>tab.getLastColumn()||tab.getLastColumn()<=1)throw new Error('Invalid column.');
    tab.deleteColumn(col);return {ok:true};});
}

/** Team directory: the original spreadsheet_data.md columns are preserved VERBATIM.
 * It is not silently merged into Users, because names/emails in the Markdown
 * do not provide a verified one-to-one mapping for all fields.
 */
/** Private roster is stored only as Apps Script Properties, never in a public repository. */
function privateCspDirectory_(){
  const raw=PropertiesService.getScriptProperties().getProperty('CSP_PRIVATE_STAFF_JSON');
  if(!raw)return [];
  const data=JSON.parse(raw);
  if(!Array.isArray(data)||!data.every(function(r){return Array.isArray(r)&&r.length===10;}))throw new Error('Private staff roster is invalid.');
  return data;
}
function seedCspDirectory(sessionToken) {
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);const sh=ss.getSheetByName('CSP_Directory');
    if(sh.getLastRow()>1) return {seeded:false,reason:'Directory already contains rows; no data was overwritten.'};
    const directory=privateCspDirectory_();
    if(!directory.length)throw new Error('Install the separate PRIVATE roster file before importing staff.');
    sh.getRange(2,1,directory.length,10).setValues(directory);
    return {seeded:true,rows:directory.length};
  });
}
function getDirectory(sessionToken) {
  const ss=db_();requireRole_(ss,['admin'],sessionToken);
  const sh=ss.getSheetByName('CSP_Directory');
  const width=Math.max(CSP_DIRECTORY_HEADERS.length,sh.getLastColumn());
  const headers=sh.getRange(1,1,1,width).getDisplayValues()[0];
  const rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,width).getDisplayValues():[];
  const users=rows_(ss,'Users');
  return {headers:headers,rows:rows,linkedEmails:users.map(function(u){return String(u.email).toLowerCase();})};
}
function saveDirectoryCell(sessionToken,rowIndex,columnIndex,value) {
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);
    const sh=ss.getSheetByName('CSP_Directory');const r=Number(rowIndex),c=Number(columnIndex);
    if(!Number.isInteger(r)||r<0||r>2000||!Number.isInteger(c)||c<0||c>=sh.getLastColumn())throw new Error('Invalid directory cell.');
    const safe=text_(value,'Cell value',1000,false);
    // Append only at the next row; never create uncontrolled gaps.
    if(r>=sh.getLastRow()-1)throw new Error('Add the row before editing it.');
    sh.getRange(r+2,c+1).setValue(safe);return {ok:true};
  });
}
function addDirectoryRow(sessionToken) {
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);
    const sh=ss.getSheetByName('CSP_Directory');const row=new Array(sh.getLastColumn()).fill('');row[0]='(new row)';sh.appendRow(row);
    return {ok:true};
  });
}
function deleteDirectoryRow(sessionToken,rowIndex) {
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);
    const sh=ss.getSheetByName('CSP_Directory');const row=Number(rowIndex)+2;
    if(!Number.isInteger(row)||row<2||row>sh.getLastRow())throw new Error('Invalid row.');
    sh.deleteRow(row);return {ok:true};
  });
}
function addDirectoryColumn(sessionToken,header) {
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);
    const sh=ss.getSheetByName('CSP_Directory');
    if(sh.getLastColumn()>=40)throw new Error('Maximum 40 directory columns.');
    const label=text_(header,'Column title',80,true);
    if(sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0].includes(label))throw new Error('Column name already exists.');
    sh.getRange(1,sh.getLastColumn()+1).setValue(label).setFontWeight('bold').setBackground('#e2e8f0');return {ok:true};
  });
}
function effectiveLeadId_(ss,supervisor,ticket,at,preloadedRules) {
  const rules=(preloadedRules||rows_(ss,'Lead_Rules')).filter(function(r){return String(r.supervisor_id)===String(supervisor.id) && String(r.active)!=='false';});
  const date=at||new Date();const tz=PropertiesService.getScriptProperties().getProperty('SITE_TIMEZONE')||'Asia/Kolkata';
  const weekday=Utilities.formatDate(date,tz,'u');const hhmm=Utilities.formatDate(date,tz,'HH:mm');
  const selected=rules.find(function(r){return r.rule_type==='ticket' && String(r.ticket_id)===String(ticket.id);}) ||
    rules.find(function(r){return r.rule_type==='time' && hhmm>=r.start_time && hhmm<r.end_time;}) ||
    rules.find(function(r){return r.rule_type==='weekday' && String(r.weekday)===String(weekday);});
  return String(selected?selected.lead_id:(ticket.lead_id||supervisor.acting_lead_id||supervisor.manager_id||''));
}
function saveLeadRule(sessionToken,payload) {
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);
    const people=rows_(ss,'Users');const sup=people.find(function(u){return String(u.id)===String(payload.supervisor_id)&&(u.role==='supervisor'||(u.role==='lead'&&String(u.can_supervise)==='true'));});
    const lead=people.find(function(u){return String(u.id)===String(payload.lead_id)&&u.role==='lead';});
    if(!sup||!lead)throw new Error('Choose a valid supervisor and lead.');
    if(String(sup.id)===String(lead.id))throw new Error('People cannot approve their own reports.');
    const kind=String(payload.rule_type||'');if(['ticket','weekday','time'].indexOf(kind)<0)throw new Error('Choose ticket, weekday or time rule.');
    if(kind==='ticket'&&!rows_(ss,'Tickets').some(function(t){return String(t.id)===String(payload.ticket_id)&&String(t.assigned_supervisor_id)===String(sup.id);}))throw new Error('Ticket is not assigned to this supervisor.');
    if(kind==='weekday'&&!/^[1-7]$/.test(String(payload.weekday||'')))throw new Error('Choose a weekday.');
    if(kind==='time'&&(!/^\d{2}:\d{2}$/.test(String(payload.start_time||'')) || !/^\d{2}:\d{2}$/.test(String(payload.end_time||'')) || payload.start_time>=payload.end_time))throw new Error('Invalid time window.');
    const old=payload.id?rows_(ss,'Lead_Rules').find(function(r){return String(r.id)===String(payload.id);}):null;
    const saved={id:old?old.id:newId_(),supervisor_id:sup.id,lead_id:lead.id,rule_type:kind,
      ticket_id:kind==='ticket'?String(payload.ticket_id):'',weekday:kind==='weekday'?String(payload.weekday):'',
      start_time:kind==='time'?String(payload.start_time):'',end_time:kind==='time'?String(payload.end_time):'',active:true,created_at:new Date().toISOString()};
    if(old)saved._row=old._row;write_(ss,'Lead_Rules',saved);
    return publicRow_(saved);
  });
}
function deleteLeadRule(sessionToken,id) {
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);
    const r=rows_(ss,'Lead_Rules').find(function(x){return String(x.id)===String(id);});if(!r)throw new Error('Rule not found.');
    ss.getSheetByName('Lead_Rules').deleteRow(r._row);return {ok:true};
  });
}
/** Admin-only explicit Jira issue lead; avoids changing the Jira issue's native assignee. */
function saveTicketLead(sessionToken,ticketId,leadId) {
  return transaction_(function(ss){
    requireRole_(ss,['admin'],sessionToken);
    const ticket=rows_(ss,'Tickets').find(function(t){return String(t.id)===String(ticketId);});
    if(!ticket)throw new Error('Ticket not found.');
    const value=String(leadId||'');
    if(value && !rows_(ss,'Users').some(function(u){return u.role==='lead'&&String(u.id)===value;}))throw new Error('Choose a valid lead.');
    if(value && value===String(ticket.assigned_supervisor_id))throw new Error('A person cannot approve their own ticket.');
    ticket.lead_id=value;write_(ss,'Tickets',ticket);
    if(value)notify_(ss,value,'','ticket_lead_assigned','New ticket lead assignment','You are the reviewing lead for '+ticket.jira_ticket_no+'.','ticket',ticket.id);
    return {ok:true};
  });
}

/** Import user-requested staff names. Blank email means pending admin verification: no login access. */
const CSP_SUPERVISOR_ROSTER=['Raju venkatesh','Murugesh Subbappa','Ayush','Guna','Balakrishanan','Kalai','Vasant','Prakash','Thangapandi','SURESH','KARTIKEYAN','KARTIK'];
function syncCspRoster(sessionToken) {
  return transaction_(function(ss){
    requireRole_(ss,['admin'],sessionToken);
    const users=rows_(ss,'Users');const tickets=rows_(ss,'Tickets');
    const norm=function(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');};
    const aliases={rajuvenkatesh:['raju'],balakrishanan:['balakrishnan'],vasant:['vasanth'],kalai:['kalairasan']};
    const approvedName=function(n){return CSP_SUPERVISOR_ROSTER.some(function(x){return cspCanonicalJiraName_(n)===cspCanonicalJiraName_(x);});};
    let created=0,kept=0,verified=0;
    CSP_SUPERVISOR_ROSTER.forEach(function(name){
      const key=norm(name);const candidate=users.find(function(u){return norm(u.name)===key || (aliases[key]||[]).indexOf(norm(u.name))!==-1;});
      if(candidate){kept++;return;}
      const candidates=[];
      tickets.forEach(function(t){let a=[];try{a=JSON.parse(t.jira_assignees||'[]');}catch(_){}
        a.forEach(function(p){if(norm(p.name)===key || (aliases[key]||[]).indexOf(norm(p.name))!==-1){if(p.email)candidates.push(String(p.email).toLowerCase());}});
      });
      const matching=Array.from(new Set(candidates));
      const email=matching.length===1 && !users.some(function(u){return String(u.email).toLowerCase()===matching[0];})?matching[0]:'';
      const saved={id:newId_(),role:'supervisor',name:name,email:'',manager_id:'',can_supervise:true,acting_lead_id:''};
      // Preserve a discovered Jira email as a suggestion only; admin must verify identity before account activation.
      if(email)verified++;
      write_(ss,'Users',saved);users.push(saved);created++;
    });
    ['Bankim','Vignesh'].forEach(function(name){
      const found=users.find(function(u){return norm(u.name)===norm(name);});
      if(found && found.role==='lead'){if(String(found.can_supervise)!=='true'){found.can_supervise=true;write_(ss,'Users',found);}return;}
      if(found)return; // An existing different role is flagged for manual admin review, not silently changed.
      const pending={id:newId_(),role:'lead',name:name,email:'',manager_id:'',can_supervise:true,acting_lead_id:''};
      write_(ss,'Users',pending);users.push(pending);created++;
    });
    let linkedTickets=0;
    tickets.filter(function(t){return !t.assigned_supervisor_id;}).forEach(function(t){
      let people=[];try{people=JSON.parse(t.jira_assignees||'[]');}catch(_){}
      const matched=users.filter(function(u){if(!approvedName(u.name))return false;return (u.role==='supervisor'||String(u.can_supervise)==='true')&&people.some(function(a){return (u.email && a.email && String(u.email).toLowerCase()===String(a.email).toLowerCase()) || (a.name && (norm(a.name)===norm(u.name) || (aliases[norm(u.name)]||[]).indexOf(norm(a.name))>=0));});});
      if(matched.length===1){t.assigned_supervisor_id=matched[0].id;t.assigned_by='jira';t.assigned_at=new Date().toISOString();t.assignment_status='assigned';write_(ss,'Tickets',t);linkedTickets++;}
    });
    return {created:created,existing:kept,jiraEmailSuggestions:verified,ticketsLinked:linkedTickets,needsReview:CSP_SUPERVISOR_ROSTER.length-verified,notes:'Add manager and check Jira identity/email before enabling sign-in. Leads acting as supervisors need a reviewing lead.'};
  });
}



/** Link existing synced CIVIL tickets using Jira's actual assigned staff, without changing any user record. */
function linkJiraAssignedTickets(sessionToken){
  return transaction_(function(ss){
    requireRole_(ss,['admin'],sessionToken);
    const users=rows_(ss,'Users').filter(function(u){return u.role==='supervisor'||(u.role==='lead'&&String(u.can_supervise)==='true');});
    const tickets=rows_(ss,'Tickets').filter(function(t){return String(t.project_key||'CIVIL').toUpperCase()==='CIVIL';});
    let linked=0,already=0,unmatched=0,ambiguous=0,manualOverrides=0;
    tickets.forEach(function(t){
      const matches=users.filter(function(u){return cspJiraAssigneeMatch_(t,u);});
      if(matches.length>1){ambiguous++;return;}
      if(!matches.length){unmatched++;return;}
      const id=String(matches[0].id);
      if(String(t.assigned_supervisor_id||'')===id){already++;return;}
      if(t.assigned_by&&t.assigned_by!=='jira'){manualOverrides++;return;}
      t.assigned_supervisor_id=id;
      t.assigned_by='jira';
      t.assigned_at=new Date().toISOString();
      t.assignment_status='assigned';
      write_(ss,'Tickets',t);linked++;
    });
    return {linked:linked,already:already,unmatched:unmatched,ambiguous:ambiguous,manualOverrides:manualOverrides,
      note:'User names and profiles were not changed. Unmatched and ambiguous tickets were not reassigned.'};
  });
}

function setSupervisorPriorities(sessionToken,supervisorId,entries){
  return transaction_(function(ss){
    requireRole_(ss,['admin'],sessionToken);
    if(!Array.isArray(entries)||entries.length>2000)throw new Error('Invalid priority list.');
    const supervisor=rows_(ss,'Users').find(function(u){return String(u.id)===String(supervisorId)&&(u.role==='supervisor'||String(u.can_supervise)==='true');});
    if(!supervisor)throw new Error('Select a valid supervisor.');
    const all=rows_(ss,'Tickets').filter(function(t){return String(t.assigned_supervisor_id)===String(supervisorId);});
    const original=new Set(all.map(function(t){return String(t.id);}));
    if(entries.length!==original.size)throw new Error('Reload the ticket list before saving priorities.');
    const used=new Set(),numbers=new Set();
    entries.forEach(function(e){
      const id=String(e.id||''),p=Number(e.priority);
      if(!original.has(id)||used.has(id)||!Number.isInteger(p)||p<1||p>9999||numbers.has(p))throw new Error('Each assigned ticket needs one unique priority between 1 and 9999.');
      used.add(id);numbers.add(p);
    });
    const ranking=Object.fromEntries(entries.map(function(e){return [String(e.id),Number(e.priority)];}));
    const sh=ss.getSheetByName('Tickets');
    const col=TABLES.Tickets.indexOf('priority_sequence')+1;
    const last=sh.getLastRow();
    if(last>1){const range=sh.getRange(2,col,last-1,1),values=range.getValues();
      all.forEach(function(t){values[t._row-2][0]=ranking[String(t.id)];});
      range.setValues(values);
    }
    return {updated:all.length};
  });
}

function setTicketPriority(sessionToken,ticketId,priority) {
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);
    const t=rows_(ss,'Tickets').find(function(x){return String(x.id)===String(ticketId);});if(!t||!t.assigned_supervisor_id)throw new Error('Assign a supervisor first.');
    const p=number_(priority,'Priority sequence',false);if(!Number.isInteger(p)||p>9999)throw new Error('Enter a whole-number sequence from 1 to 9999.');
    const existing=rows_(ss,'Tickets').find(function(x){return String(x.id)!==String(t.id)&&String(x.assigned_supervisor_id)===String(t.assigned_supervisor_id)&&Number(x.priority_sequence)===p;});
    if(existing)throw new Error('Priority number already used for this supervisor.');
    t.priority_sequence=p;write_(ss,'Tickets',t);return publicRow_(t);
  });
}
function listCivilTickets(sessionToken,section) {
  const ss=db_();requireRole_(ss,['admin'],sessionToken);
  const mode=String(section||'all');if(['all','open','closed'].indexOf(mode)<0)throw new Error('Invalid view.');
  return rows_(ss,'Tickets').filter(function(t){return String(t.project_key).toUpperCase()==='CIVIL'&&(mode==='all'||(mode==='open'?isOpen_(t.status):!isOpen_(t.status)));})
    .map(publicRow_).sort(function(a,b){return String(b.assigned_at||'').localeCompare(String(a.assigned_at||''));});
}
/** Optional Gemini integration; enabled only when GEMINI_API_KEY is configured.
 * Spoken text is transmitted to the configured Google model ONLY when the supervisor clicks Analyse.
 */
function sitePulseGemini_(prompt,audio) {
  const p=PropertiesService.getScriptProperties(),key=p.getProperty('GEMINI_API_KEY');
  if(!key)throw new Error('AI is not configured. Use the manual entry controls.');
  const configured=String(p.getProperty('GEMINI_MODEL')||'gemini-2.5-flash').replace(/^models\//,'');
  if(!/^[a-z0-9._-]+$/i.test(configured))throw new Error('Invalid AI model setting.');
  const base='https://generativelanguage.googleapis.com/v1beta/models/';
  const headers={'x-goog-api-key':key};
  const request=function(model){
    const parts=[{text:prompt}];
    if(audio)parts.push({inlineData:{mimeType:audio.mime,data:audio.data}});
    return UrlFetchApp.fetch(base+encodeURIComponent(model)+':generateContent',{
      method:'post',contentType:'application/json',headers:headers,muteHttpExceptions:true,
      payload:JSON.stringify({contents:[{parts:parts}],generationConfig:{temperature:0.1,responseMimeType:'application/json'}})
    });
  };
  let model=configured,response=request(model);
  // HTTP 404 usually means the configured model is not available to this particular API key.
  // Ask Google for supported models and retry a compatible model, rather than guessing names.
  if(response.getResponseCode()===404){
    const listing=UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{
      method:'get',headers:headers,muteHttpExceptions:true});
    if(listing.getResponseCode()===200){
      const available=JSON.parse(listing.getContentText()).models||[];
      const compatible=available.filter(function(m){return (m.supportedGenerationMethods||[]).indexOf('generateContent')!==-1&&/^models\/gemini-/i.test(String(m.name||''));});
      const choice=compatible.find(function(m){return m.name!=='models/'+configured&&/flash/i.test(String(m.name||''));})||
        compatible.find(function(m){return m.name!=='models/'+configured;})||compatible[0];
      if(choice){model=String(choice.name).replace(/^models\//,'');response=request(model);}
    }
  }
  if(response.getResponseCode()!==200)throw new Error('AI interpretation unavailable (HTTP '+response.getResponseCode()+', model '+model+'). Check GEMINI_API_KEY and GEMINI_MODEL; you can enter resources manually.');
  const obj=JSON.parse(response.getContentText()),parts=((((obj.candidates||[])[0]||{}).content||{}).parts||[]);
  const raw=parts.map(function(x){return x.text||'';}).join('');
  if(!raw)throw new Error('AI returned no report data. Please retry or enter quantities manually.');
  return JSON.parse(raw);
}
/** Conservative offline fallback: only explicit digit + clear English item phrase.
 * Does not guess missing quantities or convert number words. */
function cspLiteralSpeech_(speech,items){
  const aliases={
    'Masons':['masons?'], 'Helpers':['helpers?'], 'FC':['f\\.?c\\.?'],
    'Cement Bags':['cement\\s+bags?','bags?\\s+of\\s+cement'],
    'M Sand':['m\\s*[- ]?sand'], 'P Sand':['p\\s*[- ]?sand'],
    'Jelly/Chips':['jelly','chips?'], 'Bricks':['bricks?'],
    'Solid Blocks':['solid\\s+blocks?'], 'Tiles':['tiles?'],
    'Tractor':['tractors?'], 'Crane':['cranes?'], 'JCB':['j\\s*\\.?c\\s*\\.?b'],
    'Scaffolding':['scaffolding']
  };
  const quantity='([0-9]+(?:\\.[0-9]+)?)';
  const matched=[],resources={};
  Object.keys(aliases).forEach(function(label){
    const item=items.find(function(i){return String(i.name||'').toLowerCase()===label.toLowerCase();});
    if(!item)return;
    for(const phrase of aliases[label]){
      const r1=new RegExp('(?:^|\\b)'+quantity+'\\s*(?:units?\\s+)?'+phrase+'\\b','i');
      const r2=new RegExp('\\b'+phrase+'\\s*[:= -]*'+quantity+'\\b','i');
      const match=speech.match(r1)||speech.match(r2);
      if(!match)continue;
      const n=Number(match[1]);if(!Number.isFinite(n)||n<=0)continue;
      matched.push({item_id:String(item.id),quantity:n});resources[label]=String(n)+' '+String(item.rate_unit||'unit');break;
    }
  });
  const low=speech.toLowerCase();
  const status=/\bpartially\s+completed\b/.test(low)?'partially completed':
    /\b(completed|finished|work done)\b/.test(low)?'completed':'in progress';
  return {workDone:speech,completionStatus:status,resources:resources,
    questions: /\b(completed|finished|partially\s+completed|in progress|ongoing)\b/.test(low)?[]:['Was the work completed, partially completed, or in progress?'],
    lines:matched};
}
/** Voice can be supplied as text (accessibility/manual) or as a short microphone recording.
 * Recording stays in memory, is sent only on Generate report, and is not stored in Sheets.
 */
function interpretWorkVoice(sessionToken,transcript,language,ticketId,workDate) {
  return cspInterpretSiteUpdate_(sessionToken,transcript,language,ticketId,workDate,null);
}
function interpretWorkAudio(sessionToken,audioBase64,audioMime,language,ticketId,workDate) {
  // Validate before any external API request; the session/role is checked inside the shared function.
  const mime=String(audioMime||'').split(';')[0].toLowerCase();
  if(['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg'].indexOf(mime)<0)
    throw new Error('Unsupported recording format. Try Chrome or enter the transcript manually.');
  const raw=String(audioBase64||'');
  if(raw.length<100 || raw.length>1050000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw))
    throw new Error('The recording is missing or too large. Record a shorter site update (up to 45 seconds).');
  return cspInterpretSiteUpdate_(sessionToken,'',language,ticketId,workDate,{mime:mime,data:raw});
}
function cspInterpretSiteUpdate_(sessionToken,transcript,language,ticketId,workDate,audio) {
  const ss=db_();const engineer=requireRole_(ss,['supervisor'],sessionToken);
  const lang=text_(language,'Language code',12,true);
  const languageNames={'en-IN':'English','ta-IN':'Tamil','kn-IN':'Kannada','te-IN':'Telugu',
    'bn-IN':'Bengali','mr-IN':'Marathi','hi-IN':'Hindi','ml-IN':'Malayalam'};
  if(!languageNames[lang])throw new Error('Select a supported voice language.');
  let speech=audio?'':text_(transcript,'Transcript',5000,true);
  const ticket=rows_(ss,'Tickets').find(function(t){return String(t.id)===String(ticketId)&&String(t.assigned_supervisor_id)===String(engineer.id);});
  if(!ticket)throw new Error('Select one of your assigned tickets before generating a report.');
  const timezone=PropertiesService.getScriptProperties().getProperty('SITE_TIMEZONE')||'Asia/Kolkata';
  const selectedWorkDate=siteDate_(workDate||Utilities.formatDate(new Date(),timezone,'yyyy-MM-dd'),'Work date',true);
  const items=rows_(ss,'Master_Items');
  const fields=['Masons','Helpers','FC','Etc','Cement Bags','M Sand','P Sand','Jelly/Chips','Bricks','Solid Blocks','Tiles','Other Materials','Tractor','Crane','JCB','Scaffolding','Other Equipment'];
  const catalog=items.map(function(i){return {id:i.id,name:i.name,type:i.type,unit:i.rate_unit||'unit'};});
  let answer,mode='ai',warning='';
  try {
    answer=sitePulseGemini_(
      'Interpret a daily CIVIL construction site '+(audio?'AUDIO recording':'TRANSCRIPT')+' in '+languageNames[lang]+
      ' (including regional accents, code-switching, and construction shorthand). '+
      'If audio is supplied, transcribe what was actually said in the ORIGINAL language/script, word for word, in transcript. '+
      'If text is supplied, preserve the original text exactly in transcript. '+
      'Recognize construction terms by meaning and catalog context, not by superficial spelling. Common local variants include mastri/mestri (mason), '+
      'coolie/helper, cement bags, M-sand, P-sand, jalli/jelly/chips, bricks, solid blocks, tiles, tractor, crane, JCB, scaffolding. '+
      'FC is a distinct labour category; do not guess what it means. '+
      'Translate Work Done into fluent, plain ENGLISH for the Admin/Lead. Never return local-script text in workDoneEnglish. '+
      'Preserve the meaning and ALL quantities/units. Never invent work, material use, units, numbers, dates or status. '+
      'Only match a catalog resource when the spoken quantity AND item are clear. '+
      'For numbers spoken as local-language words, include evidence: the EXACT phrase in the transcript that contains that number and item, '+
      'and output its numerical value only when certain. For digit quantities evidence must still include the matching item phrase. '+
      'Ask at most two essential questions when status or an important quantity is unclear. Unmentioned fields should be Not Used. '+
      'Return JSON ONLY with {transcript:string,workDoneEnglish:string,completionStatus:"completed"|"partially completed"|"in progress",'+
      'resources:object keyed by exact labels,questions:string[],lines:[{item_id:string,quantity:number,evidence:string}]}. '+
      'Write the resources quantities in digits with their spoken unit, without converting units. '+
      'If completion status was not said, ask a question, and use in progress as the temporary UI placeholder only. '+
      'Labels: '+JSON.stringify(fields)+'. Actual catalog: '+JSON.stringify(catalog)+
      '. Work ticket location (context only): '+String(ticket.location||'')+
      '. Selected language: '+lang+'. Supplied transcript: '+speech,
      audio);
    if(audio){
      const recognized=String(answer.transcript||'').trim();
      if(!recognized)throw new Error('No speech was recognized from the recording. Please try again in a quieter location.');
      speech=text_(recognized,'Recognized transcript',5000,true);
    }
  }catch(error){
    if(audio)throw new Error('Unable to interpret the recording. You can type the local-language transcript and retry. '+String(error&&error.message||error));
    mode='literal';answer=cspLiteralSpeech_(speech,items);
    warning='AI interpretation/English translation unavailable. Only clear English item names and digit quantities were extracted. '+
      'If the Work Done is in a local language, enter a verified English description before submitting; check all values.';
    console.warn('Gemini interpretation unavailable: '+String(error&&error.message||error));
  }
  const allowed=Object.fromEntries(items.map(function(i){return [String(i.id),i];}));
  const numericalEvidence=Array.from(speech.matchAll(/[0-9]+(?:[.,][0-9]+)?/g)).map(function(x){return Number(x[0].replace(/,/g,''));});
  const acceptedFromWords=new Set();
  const lineIds=new Set();
  const lines=(Array.isArray(answer.lines)?answer.lines:[]).filter(function(l){
    const id=String(l.item_id||''),quantity=Number(l.quantity),evidence=String(l.evidence||'').trim();
    if(!allowed[id]||lineIds.has(id)||!Number.isFinite(quantity)||quantity<=0)return false;
    const digitExplicit=numericalEvidence.indexOf(quantity)!==-1;
    // For regional number words, evidence must be an exact excerpt from the transcript;
    // the supervisor still checks each interpreted number before submission.
    const wordEvidence=mode==='ai'&&evidence.length>=5&&speech.toLocaleLowerCase().indexOf(evidence.toLocaleLowerCase())!==-1;
    if(!digitExplicit&&!wordEvidence)return false;
    if(!digitExplicit&&wordEvidence)acceptedFromWords.add(quantity);
    lineIds.add(id);return true;
  }).slice(0,60).map(function(l){return {item_id:String(l.item_id),quantity:Number(l.quantity)};});
  const transcriptDigits=Array.from(speech.matchAll(/[0-9]+(?:[.,][0-9]+)?/g)).map(function(m){return Number(m[0].replace(/,/g,''));});
  const questions=Array.isArray(answer.questions)?answer.questions.filter(function(q){return typeof q==='string'&&q.trim();}).slice(0,2).map(function(q){return q.slice(0,240);}):[];
  const digitNotSpoken=function(value){return Array.from(String(value||'').matchAll(/[0-9]+(?:[.,][0-9]+)?/g)).some(function(m){
    const n=Number(m[0].replace(/,/g,''));return transcriptDigits.indexOf(n)<0&&!acceptedFromWords.has(n);
  });};
  const resources={};fields.forEach(function(label){
    const value=answer.resources&&answer.resources[label];
    const found=typeof value==='string'&&value.trim()?value.trim().slice(0,90):'Not Used';
    if(digitNotSpoken(found)){
      resources[label]='Not Used';
      if(questions.length<2)questions.push('Please confirm the quantity and unit for '+label+'.');
    }else resources[label]=found;
  });
  const added=new Set(lines.map(function(l){return String(l.item_id);}));
  fields.forEach(function(label){
    const item=items.find(function(i){return String(i.name).toLowerCase()===label.toLowerCase();});
    if(!item||added.has(String(item.id)))return;
    const m=String(resources[label]||'').match(/^\s*([0-9]+(?:\.[0-9]+)?)(?:\s|$)/);
    if(!m)return;const value=Number(m[1]);
    if(value>0&&numericalEvidence.indexOf(value)!==-1){lines.push({item_id:String(item.id),quantity:value});added.add(String(item.id));}
  });
  let workDone=String(answer.workDoneEnglish||answer.workDone||'').slice(0,3000).trim();
  if(mode==='literal'&&lang!=='en-IN'){
    // Even transliterated local speech is NOT guaranteed to be English.
    // Leave the English field blank for manual correction if Gemini is offline.
    workDone='';
  }
  if(cspIndicScript_(workDone))workDone='';
  if(digitNotSpoken(workDone)){
    workDone='';
    warning='An unverified number was removed from the English Work Done. Enter the correct English work and numbers manually.';
  }
  const completion=['completed','partially completed','in progress'].indexOf(String(answer.completionStatus||'').toLowerCase())>=0?String(answer.completionStatus).toLowerCase():'in progress';
  // The user can fill English Work Done manually even if AI is unavailable.
  // Use the explicit verification control before submission.
  if(mode==='literal')questions.length=0;
  if(mode==='ai'&&lang!=='en-IN'){
    warning='English Work Done prepared from '+languageNames[lang]+'. Review the translation and every quantity before submission.';
  }
  const report=[
    'DAILY SITE REPORT','Ticket No: '+ticket.jira_ticket_no,'Work Date: '+selectedWorkDate.split('-').reverse().join('/'),
    'Project Location: '+(ticket.location||'Not Applicable'),'Supervisor name: '+engineer.name,'Work Done:',workDone||'Not Applicable','',
    'Labours',...fields.slice(0,4).map(function(k){return k+': '+resources[k];}),'',
    'Materials Used',...fields.slice(4,12).map(function(k){return k+': '+resources[k];}),'',
    'Equipment Used',...fields.slice(12,17).map(function(k){return k+': '+resources[k];}),'',
    'Work Completion Status',completion==='completed'?'Completed':completion==='partially completed'?'Partially Completed':'In Progress'
  ].join('\n');
  return {reportText:report,work_done:workDone,source_transcript:speech,source_language:lang,
    completion_status:completion,work_measure:0,work_measure_unit:'',lines:lines,questions:questions,resources:resources,mode:mode,warning:warning};
}
/** Detect regional script; never silently pass untranslated text to Admin/Lead. */
function cspIndicScript_(s){return /[\u0900-\u0DFF]/.test(String(s||''));}
function cspEnglishWork_(value){
  const candidate=text_(value,'Work Done in English',3000,true);
  if(!cspIndicScript_(candidate))return candidate;
  const result=sitePulseGemini_('Translate this site work description accurately into concise ENGLISH. '+
    'Retain every quantity, unit and construction item. Do not invent anything. Return JSON {"english":"..."}. Original: '+candidate);
  const translated=String(result.english||'').trim();
  if(!translated||cspIndicScript_(translated))throw new Error('English translation unavailable. Please enter Work Done in English before submitting.');
  return text_(translated,'English translation',3000,true);
}
function localizeRevision(sessionToken,revisionText,language) {
  const ss=db_();requireRole_(ss,['supervisor'],sessionToken);
  const input=text_(revisionText,'Revision note',1500,true);
  const choices={'ta-IN':'Tamil','te-IN':'Telugu','kn-IN':'Kannada','ml-IN':'Malayalam','hi-IN':'Hindi','bn-IN':'Bengali','mr-IN':'Marathi'};
  if(!choices[language])throw new Error('Select a supported language.');
  const r=sitePulseGemini_('Translate this construction-site report revision note into natural, contextually accurate '+choices[language]+'. Preserve numbers and units. Return JSON {"translation":"..."}. Text: '+input);
  return {translation:String(r.translation||'').slice(0,2000),language:language};
}

/** Opt-in import of headers from the historical CSP response sheet PDF.
 * Prices and quantities are intentionally zero; no historical response rows are changed.
 */
function seedLegacyCspItems(sessionToken) {
  const defaults={
    labour:['Masons','Helpers','FC','Etc'],
    material:['Cement Bags','M Sand','P Sand','Jelly/Chips','Bricks','Solid Blocks','Tiles','Other Materials'],
    machine:['Tractor','Crane','JCB','Scaffolding','Other Equipment']
  };
  return transaction_(function(ss){requireRole_(ss,['admin'],sessionToken);
    const names=rows_(ss,'Master_Items');let created=0;
    Object.keys(defaults).forEach(function(type){defaults[type].forEach(function(name){
      if(names.some(function(i){return String(i.type)===type&&String(i.name).toLowerCase()===name.toLowerCase();}))return;
      const item={id:newId_(),type:type,name:name,current_price:0,quantity:0,rate_unit:type==='machine'?'day':'unit'};
      write_(ss,'Master_Items',item);names.push(item);created++;
    });});
    return {created:created,summary:'Imported missing legacy item names with zero prices and quantities.'};
  });
}
function cleanupExpiredSessions() {
  return transaction_(function(ss){const expired=rows_(ss,'Sessions').filter(function(s){return Date.now()>=new Date(s.expires_at).getTime();}).sort(function(a,b){return b._row-a._row;});
    expired.forEach(function(s){ss.getSheetByName('Sessions').deleteRow(s._row);});return {removed:expired.length};});
}
function installSessionCleanup() {
  const handler='cleanupExpiredSessions';ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===handler;}).forEach(function(t){ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger(handler).timeBased().everyDays(1).atHour(3).create();return 'Session cleanup trigger installed.';
}


/**
 * SitePulse decoupled JSON RPC + FCM HTTP v1 integration.
 * Merged into Code.gs in this distribution. Never put these secrets in Angular.
 * Script properties required for push: FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON, PUSH_APP_URL.
 * Existing Google Sheets and authentication remain authoritative.
 */
const CSP_PUBLIC_RPC_METHODS = Object.freeze([
  'requestLoginCode','verifyLoginCode','logoutSession','getBootstrap','listReports',
  'saveMasterItem','deleteMasterItem','saveUser','deleteUser','listNotifications',
  'markNotificationRead','assignTicket','returnTicket','submitReport',
  'requestRevision','reviseReport','reviewReport','adminUpdateReport',
  'listJiraProjects','syncJiraTickets','fetchJiraTicketByKey','testJiraConnection',
  'listJiraServiceDesks','listJiraQueues','listJiraQueueIssues',
  'getReportingWorkbook','editReportingWorkbookCell','insertReportingWorkbookRow',
  'deleteReportingWorkbookRow','insertReportingWorkbookColumn','deleteReportingWorkbookColumn',
  'seedCspDirectory','getDirectory','saveDirectoryCell','addDirectoryRow',
  'deleteDirectoryRow','addDirectoryColumn','saveLeadRule','deleteLeadRule',
  'saveTicketLead','syncCspRoster','setTicketPriority','setSupervisorPriorities','linkJiraAssignedTickets','listCivilTickets',
  'localizeRevision','seedLegacyCspItems',
  'registerPushToken','unregisterPushToken','sendPushTest','saveMenuLabels',
  'getLiveUpdates','addItemRate','saveMyProfile','requestProfileEmailChange','confirmProfileEmailChange',
  'renameReportingWorkbookColumn','importScreenshotStaffProfiles',
]);

function doPost(e) {
  try {
    if (!e || !e.postData || String(e.postData.contents || '').length > 1500000) throw new Error('Invalid request size.');
    const request = JSON.parse(e.postData.contents);
    const method = String(request.method || '');
    const functions = {
      requestLoginCode, verifyLoginCode, logoutSession, getBootstrap, listReports, saveMasterItem,
      deleteMasterItem, saveUser, deleteUser, listNotifications, markNotificationRead, assignTicket,
      returnTicket, submitReport, requestRevision, reviseReport, reviewReport, adminUpdateReport,
      listJiraProjects, syncJiraTickets, fetchJiraTicketByKey, testJiraConnection, listJiraServiceDesks, listJiraQueues,
      listJiraQueueIssues, getReportingWorkbook, editReportingWorkbookCell, insertReportingWorkbookRow, deleteReportingWorkbookRow, insertReportingWorkbookColumn,
      deleteReportingWorkbookColumn, seedCspDirectory, getDirectory, saveDirectoryCell, addDirectoryRow, deleteDirectoryRow,
      addDirectoryColumn, saveLeadRule, deleteLeadRule, saveTicketLead, syncCspRoster, setTicketPriority, setSupervisorPriorities, linkJiraAssignedTickets,
      listCivilTickets, localizeRevision, seedLegacyCspItems, registerPushToken, unregisterPushToken,
      sendPushTest, saveMenuLabels, getLiveUpdates,addItemRate,
      saveMyProfile,requestProfileEmailChange,confirmProfileEmailChange,renameReportingWorkbookColumn,importScreenshotStaffProfiles,
      
    };
    const handler = functions[method];
    if (CSP_PUBLIC_RPC_METHODS.indexOf(method) < 0 || typeof handler !== 'function') {
      throw new Error('Unsupported API method.');
    }
    if (!Array.isArray(request.args) || request.args.length > 10) throw new Error('Invalid API arguments.');
    const authless = ['requestLoginCode','verifyLoginCode'];
    const args = authless.indexOf(method) !== -1 ? request.args : [request.sessionToken || ''].concat(request.args);
    // Session and role checks remain in the original business functions.
    return cspRpcJson_({ok:true,result:handler.apply(null,args)});
  } catch (error) {
    console.error('CSP RPC error: ' + String(error && error.message || error));
    return cspRpcJson_({ok:false,error:String(error && error.message || 'Request failed')});
  }
}
function cspRpcJson_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function registerPushToken(sessionToken,tokenInput,labelInput) {
  const token=String(tokenInput||'').trim();
  if (!/^[A-Za-z0-9_:.-]{80,4096}$/.test(token)) throw new Error('Invalid Firebase registration token.');
  const label=text_(labelInput||'Web browser','Device label',100,false);
  return transaction_(function(ss) {
    const user=requireRole_(ss,USER_ROLES,sessionToken);
    const rows=rows_(ss,'Push_Subscriptions');
    const existing=rows.find(function(r){return String(r.token)===token;});
    const now=new Date().toISOString();
    if (existing) {
      existing.user_id=user.id;
      existing.device_label=label;
      existing.updated_at=now;
      write_(ss,'Push_Subscriptions',existing);
    } else {
      write_(ss,'Push_Subscriptions',{id:newId_(),user_id:user.id,token:token,
        device_label:label,created_at:now,updated_at:now});
    }
    return {ok:true,subscribed:true};
  });
}
function unregisterPushToken(sessionToken,tokenInput) {
  return transaction_(function(ss) {
    const user=requireRole_(ss,USER_ROLES,sessionToken);
    const token=String(tokenInput||'').trim();
    rows_(ss,'Push_Subscriptions').filter(function(s){return String(s.user_id)===String(user.id)&&s.token===token;})
      .sort(function(a,b){return b._row-a._row;})
      .forEach(function(s){ss.getSheetByName('Push_Subscriptions').deleteRow(s._row);});
    return {ok:true};
  });
}
function cspFcmToken_() {
  const cache=CacheService.getScriptCache();
  const saved=cache.get('csp-fcm-oauth-v1');
  if (saved) return saved;
  const props=PropertiesService.getScriptProperties();
  const source=props.getProperty('FCM_SERVICE_ACCOUNT_JSON');
  if (!source) return '';
  const account=JSON.parse(source);
  if (!account.client_email || !account.private_key) throw new Error('FCM service account JSON is incomplete.');
  const now=Math.floor(Date.now()/1000);
  const encode=function(obj){return Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(obj)).getBytes()).replace(/=+$/,'');};
  const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:account.client_email,
    scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500});
  const signature=Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned,account.private_key)).replace(/=+$/,'');
  const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{
    method:'post',contentType:'application/x-www-form-urlencoded',
    payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature},
    muteHttpExceptions:true
  });
  if (response.getResponseCode()!==200) throw new Error('FCM OAuth service-account authorization failed ('+response.getResponseCode()+').');
  const data=JSON.parse(response.getContentText());
  if (!data.access_token) throw new Error('FCM OAuth response has no access token.');
  cache.put('csp-fcm-oauth-v1',data.access_token,Math.max(60,Math.min(3300,Number(data.expires_in||3600)-120)));
  return data.access_token;
}

/** Notification delivered only to the recipient's own registered browsers. */
function cspPushNotification_(ss,note) {
  const props=PropertiesService.getScriptProperties();
  const project=String(props.getProperty('FCM_PROJECT_ID')||'').trim();
  if (!/^[a-z][a-z0-9-]{3,60}$/.test(project)) return;
  const devices=rows_(ss,'Push_Subscriptions').filter(function(r){return String(r.user_id)===String(note.recipient_id);}).slice(0,8);
  if (!devices.length) return;
  let access;
  try {access=cspFcmToken_();}catch(error){console.warn('FCM auth: '+error.message);return;}
  if (!access) return;
  const url=String(props.getProperty('PUSH_APP_URL')||'');
  const bad=[];
  devices.forEach(function(device) {
    const message={message:{token:String(device.token),data:{
      title:String(note.title||'CSP Data Manager'),body:String(note.body||''),noteId:String(note.id||''),
      targetKind:String(note.target_kind||''),targetId:String(note.target_id||''),url:url
    },webpush:{headers:{Urgency:'normal'}}}};
    try {
      const response=UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(project)+'/messages:send',{
        method:'post',contentType:'application/json',
        headers:{Authorization:'Bearer '+access},payload:JSON.stringify(message),muteHttpExceptions:true
      });
      const status=response.getResponseCode();
      if (status>=400) {
        const reply=JSON.parse(response.getContentText()||'{}');
        const code=String(reply.error && reply.error.status || '');
        const details=(reply.error && reply.error.details)||[];
        const unregistered=status===404 || details.some(function(d){return d.errorCode==='UNREGISTERED';});
        if (unregistered) bad.push(device._row);
        console.warn('FCM delivery: HTTP '+status+' ('+code+').');
      }
    } catch(error) {console.warn('FCM delivery error: '+String(error.message||error));}
  });
  bad.sort(function(a,b){return b-a;}).forEach(function(row){ss.getSheetByName('Push_Subscriptions').deleteRow(row);});
}

/** On-demand test: only the signed-in user's own devices; throttled to one per minute. */
function sendPushTest(sessionToken) {
  return transaction_(function(ss){
    const user=requireRole_(ss,USER_ROLES,sessionToken);
    const key='csp-push-test-'+digest_(String(user.id)).slice(0,30);
    if(CacheService.getScriptCache().get(key)) throw new Error('Try another test notification after one minute.');
    CacheService.getScriptCache().put(key,'1',60);
    const note={id:newId_(),recipient_id:user.id,actor_id:user.id,type:'push_test',
      title:'SitePulse push is connected',body:'This is a test from your CSP Data Manager backend.',
      target_kind:'notification',target_id:'',created_at:new Date().toISOString(),read_at:''};
    write_(ss,'Notifications',note);
    cspPushNotification_(ss,note);
    return {ok:true};
  });
}


/** Editable navigation labels: stored in the spreadsheet, never public without a session. */
const CSP_MENU_KEYS = ['overview','tickets','reports','review','team','inventory','jira','workbook','notifications','settings'];
function getMenuLabels_(existingSs) {
  const ss = existingSs || db_();
  const entries = rows_(ss,'App_Settings').filter(function(x){return String(x.key).indexOf('menu:')===0;});
  const out = {};
  entries.forEach(function(x){
    const k=String(x.key).slice(5);
    if(CSP_MENU_KEYS.indexOf(k)>=0)out[k]=String(x.value||'').slice(0,32);
  });
  return out;
}
function saveMenuLabels(sessionToken,labels) {
  return transaction_(function(ss){
    const admin=requireRole_(ss,['admin'],sessionToken);
    if(!labels||typeof labels!=='object'||Array.isArray(labels))throw new Error('Invalid navigation labels.');
    const old=rows_(ss,'App_Settings');
    const previous=Object.fromEntries(old.filter(function(x){return String(x.key).indexOf('menu:')===0;}).map(function(x){return [String(x.key).slice(5),String(x.value||'')];}));
    const saved={};
    CSP_MENU_KEYS.forEach(function(k){
      if(!Object.prototype.hasOwnProperty.call(labels,k))return;
      const value=text_(labels[k],'Menu label',32,true);
      const key='menu:'+k;const row=old.find(function(r){return r.key===key;});
      write_(ss,'App_Settings',{key:key,value:value,updated_at:new Date().toISOString(),updated_by:admin.id,_row:row?row._row:undefined});
      saved[k]=value;
    });
    write_(ss,'Audit_Log',{id:newId_(),actor_id:admin.id,action:'menu_labels_updated',target_id:'navigation',created_at:new Date().toISOString(),before_json:JSON.stringify(previous).slice(0,44000),after_json:JSON.stringify(saved).slice(0,44000)});
    return {ok:true,menuLabels:Object.assign({},previous,saved)};
  });
}


/** Scoped read-only updates, lightweight enough for visible-tab polling. */
function getLiveUpdates(sessionToken){
  const ss=db_();const user=identity_(ss,sessionToken);
  const allRates=itemRates_(ss);
  const allItems=effectivePrices_(rows_(ss,'Master_Items').map(publicRow_),allRates);
  const items=user.role==='supervisor' ? allItems.map(function(i){return {id:i.id,type:i.type,name:i.name,rate_unit:i.rate_unit||'unit'};}) : allItems;
  const contacts=rows_(ss,'Users').filter(function(u){return u.email&&String(u.id)!==String(user.id)&&String(u.account_status||'active')==='active';})
    .map(function(u){return {id:u.id,name:u.name,role:u.role};});
  return {tickets:scopedTickets_(ss,user),reports:reportsFor_(ss,user),notifications:notificationRows_(ss,user.id),
    items:items,contacts:contacts,
    itemRates:allRates.filter(function(r){return user.role!=='supervisor'||rateDay_(r)<=Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd');}).map(publicRow_).reverse()};
}

function validBirthDate_(value){
  const date=String(value||'').trim();if(!date)return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+'T00:00:00Z').valueOf())||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>new Date().toISOString().slice(0,10))throw new Error('Enter a valid past birth date.');
  return date;
}
function validPhoto_(value){
  const photo=String(value||'');if(!photo)return '';
  if(photo.length>28000||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photo))throw new Error('Choose a smaller JPEG or PNG photo.');
  return photo;
}
function saveMyProfile(sessionToken,payload){
  return transaction_(function(ss){
    const me=identity_(ss,sessionToken);
    if(!payload||typeof payload!=='object')throw new Error('Invalid profile.');
    if(String(payload.email||'').trim().toLowerCase()!==String(me.email).toLowerCase())throw new Error('Verify your new email separately before saving it.');
    me.name=text_(payload.name,'Name',100,true);
    me.mobile_number=text_(payload.mobile_number||'','Mobile number',30,false);
    me.birth_date=validBirthDate_(payload.birth_date||'');me.photo_data=validPhoto_(payload.photo_data||'');
    write_(ss,'Users',me);
    return publicRow_(me);
  });
}
function requestProfileEmailChange(sessionToken,emailInput){
  const ss=db_();const me=identity_(ss,sessionToken);const next=loginEmail_(emailInput);
  if(next===String(me.email).toLowerCase())throw new Error('This is already your current email.');
  if(rows_(ss,'Users').some(function(u){return String(u.email).toLowerCase()===next;}))throw new Error('Email is already used by another staff member.');
  const key='profile-email:'+digest_(sessionToken).slice(0,40);
  const cache=CacheService.getScriptCache();if(cache.get(key+':cooldown'))throw new Error('Please wait one minute before requesting another code.');
  const nonce=Utilities.getUuid(),code=makeLoginCode_();
  cache.put(key,JSON.stringify({next:next,hash:digest_(nonce+':'+code),nonce:nonce,attempts:0}),600);cache.put(key+':cooldown','1',60);
  MailApp.sendEmail({to:next,subject:'Confirm your CSP SitePulse email update',body:'Your confirmation code is '+code+'\nIt expires in 10 minutes. Do not share it.',name:'CSP SitePulse'});
  return {sent:true};
}
function confirmProfileEmailChange(sessionToken,newEmail,code){
  const key='profile-email:'+digest_(sessionToken).slice(0,40);
  const cache=CacheService.getScriptCache();const stored=cache.get(key);if(!stored)throw new Error('Email verification expired; request a new code.');
  const entry=JSON.parse(stored);entry.attempts++;
  if(entry.attempts>5){cache.remove(key);throw new Error('Too many attempts.');}
  if(entry.next!==loginEmail_(newEmail)||!/^[0-9]{8}$/.test(String(code||''))||entry.hash!==digest_(entry.nonce+':'+String(code))){cache.put(key,JSON.stringify(entry),600);throw new Error('Wrong code.');}
  const changed=transaction_(function(ss){
    const me=identity_(ss,sessionToken);
    if(rows_(ss,'Users').some(function(u){return String(u.email).toLowerCase()===entry.next&&String(u.id)!==String(me.id);}))throw new Error('Email is already registered.');
    const old=me.email;me.email=entry.next;write_(ss,'Users',me);
    // Keep the current verified session valid, revoke others after an email identity change.
    const sessions=rows_(ss,'Sessions').filter(function(r){return String(r.user_id)===String(me.id);});
    sessions.sort(function(a,b){return b._row-a._row;}).forEach(function(r){if(r.token_hash===digest_(sessionToken)){r.email=entry.next;write_(ss,'Sessions',r);}else ss.getSheetByName('Sessions').deleteRow(r._row);});
    write_(ss,'Audit_Log',{id:newId_(),actor_id:me.id,action:'profile_email_changed',target_id:me.id,created_at:new Date().toISOString(),before_json:JSON.stringify({email:old}),after_json:JSON.stringify({email:entry.next})});
    return {email:entry.next};
  });
  cache.remove(key);return changed;
}

/** Uses the supplied screenshot-derived directory; ambiguous lead mappings remain unassigned. */
function seedScreenshotProfilesSheet_(ss){
  const sheet=ss.getSheetByName('CSP_Staff_Profiles');
  if(!sheet||sheet.getLastRow()>1)return;
  const entries=[];
  privateCspDirectory_().forEach(function(row){
    if(row[1])entries.push(['supervisor',String(row[3]),String(row[1]),String(row[2]),'', 'pending review','supplied roster screenshot']);
    if(row[4]&&row[6]&&!entries.some(function(e){return e[2]===row[4];}))entries.push(['lead',String(row[6]),String(row[4]),String(row[5]),'','pending review','supplied roster screenshot']);
    if(row[7]&&!entries.some(function(e){return e[2]===row[7];})){
      const first=String(row[7]).split('@')[0].split('.')[0];
      entries.push(['admin',first.charAt(0).toUpperCase()+first.slice(1),String(row[7]),String(row[8]),'','pending review','supplied roster screenshot']);
    }
  });
  if(entries.length){sheet.getRange(2,1,entries.length,TABLES.CSP_Staff_Profiles.length).setValues(entries);sheet.setFrozenRows(1);sheet.setColumnWidths(1,7,150);sheet.setColumnWidth(3,280);}
}
function importScreenshotStaffProfiles(sessionToken){
  return transaction_(function(ss){
    requireRole_(ss,['admin'],sessionToken);seedScreenshotProfilesSheet_(ss);
    const sheet=ss.getSheetByName('CSP_Staff_Profiles');
    const existing=rows_(ss,'Users');const entries=rows_(ss,'CSP_Staff_Profiles');let created=0,skipped=0;
    if(!entries.length)throw new Error('No staff profiles to import. Install the separate PRIVATE roster file in Google Apps Script, then run seedPrivateCspStaff().');
    entries.forEach(function(r){
      const email=String(r.email||'').trim().toLowerCase();
      if(!email||!String(r.name||'').trim()||existing.some(function(u){return String(u.email).toLowerCase()===email;})){skipped++;return;}
      const user={id:newId_(),role:String(r.role),name:String(r.name),email:email,manager_id:'',can_supervise:r.role==='supervisor',acting_lead_id:'',mobile_number:String(r.mobile_number||''),birth_date:'',photo_data:'',account_status:'pending'};
      write_(ss,'Users',user);existing.push(user);created++;
    });
    return {created:created,skipped:skipped,notice:'Imported staff accounts are pending. Review names, emails, leads and activate each account explicitly.'};
  });
}
