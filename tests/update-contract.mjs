import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const read=path=>readFileSync(resolve(root,path),'utf8');
const backend=read('backend/Code.gs');
const ui=read('src/app/app.component.html');
const app=read('src/app/app.component.ts');
const sw=read('public/firebase-messaging-sw.js');
const workflow=read('.github/workflows/deploy.yml');
const checks=[
  ['private roster excluded from public backend',()=>{
    assert(!backend.includes('CSP_DIRECTORY_SEED'));
    assert(!/raju\.venkatesh|murugesh\.subbappa|vasanth\.kongarayan|vignesh\.mani@sadhguru\.org/i.test(backend));
    assert(backend.includes('CSP_PRIVATE_STAFF_JSON'));
  }],
  ['role-limited rate register',()=>{
    assert(backend.includes("itemRates: role==='supervisor'?[]"));
    assert(ui.includes('Old rate')&&ui.includes('New rate'));
  }],
  ['message security and notifications',()=>{
    assert(backend.includes('function sendDirectMessage(sessionToken,recipientId,body)'));
    assert(backend.includes("'direct_message','Message from '"));
    assert(ui.includes('class="messages-layout panel"'));
    assert(!ui.includes('class="toast"'));
  }],
  ['live updates and device push',()=>{
    assert(backend.includes('function getLiveUpdates(sessionToken)'));
    assert(app.includes('},12000)'));
    assert(sw.includes("self.addEventListener('push'"));
    assert(ui.includes('class="bell-popover"'));
  }],
  ['Jira display and filtering',()=>{
    for(const name of ['IESM_Location','Contact Number','Request Type','Sub-Request Type','Design Needed','Assignee','Reporter'])assert(ui.includes(name));
    assert(app.includes('this.supervisorFilter')&&app.includes('this.locationFilter')&&app.includes('this.ticketDateFilter'));
    assert(backend.includes('function resolvedSupervisor')||backend.includes('const resolvedSupervisor='));
  }],
  ['exact report sections',()=>{
    for(const label of ['DAILY SITE REPORT','Labours','Materials Used','Equipment Used','Work Completion Status','Masons','Helpers','FC','JCB','Solid Blocks','Jelly/Chips'])assert(app.includes(label));
    assert(backend.includes('completion_status:completion,')&&!backend.includes("completion_status:completion==='partially completed'?'in progress':completion"));
    assert(ui.includes('verifiedDraft'));
  }],
  ['profiles and workbook headers',()=>{
    for(const fn of ['saveMyProfile','requestProfileEmailChange','confirmProfileEmailChange','renameReportingWorkbookColumn','importScreenshotStaffProfiles'])assert(backend.includes('function '+fn+'('));
    assert(ui.includes('Change photo')&&ui.includes('Rename column')&&ui.includes('Import provided staff'));
  }],
  ['github workflow avoids missing lockfile',()=>{
    assert(workflow.includes('npm install --no-audit --no-fund'));
    assert(!workflow.includes('cache: npm'));
    assert(workflow.includes('actions/deploy-pages@v4'));
  }]
];
for(const [label,check] of checks){check();console.log('PASS:',label);}
