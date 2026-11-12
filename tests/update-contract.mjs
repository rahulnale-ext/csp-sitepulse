import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const read=file=>readFileSync(resolve(import.meta.dirname,'..',file),'utf8');
const backend=read('backend/Code.gs'),ts=read('src/app/app.component.ts'),html=read('src/app/app.component.html');
const workflow=read('.github/workflows/deploy.yml'),sw=read('public/firebase-messaging-sw.js');
const chat=read('src/app/firestore-chat.service.ts'),rules=read('firestore.rules');
const checks=[
 ['Private roster excluded from GitHub',()=>assert(!/raju\.venkatesh|murugesh\.subbappa|vasanth\.kongarayan|vignesh\.mani@sadhguru\.org/i.test(backend))],
 ['Dated, append-only rates and locked report prices',()=>{for(const term of ['function addItemRate(','effective_date','rate_source','locked_price','approvedRateOn_'])assert(backend.includes(term));assert(html.includes('Past · current · future rates'));}],
 ['Realtime messages replace Google Sheets polling',()=>{
   assert(html.includes('{{unreadMessages}}'));
   assert(!ts.includes('chatTimer=setInterval'));
   assert(chat.includes('onSnapshot(chats'));
   assert(chat.includes("where('participantIds','array-contains',uid)"));
   assert(chat.includes('serverTimestamp()'));
   assert(backend.includes('getFirestoreChatToken'));
   assert(backend.includes('migrateLegacyMessagesToFirestore'));
   assert(rules.includes('request.auth.uid in resource.data.participantIds'));
   assert(rules.includes('request.auth.token.csp_chat == true'));
 }],
 ['Jira CIVIL filtered and grouped',()=>{for(const term of ['jiraResolveLocationField_','jira_assignment_group',"const project = 'CIVIL'"])assert(backend.includes(term));assert(!backend.includes("|| f.summary || 'Not specified'"));assert(html.includes('Civil Service Desk (CIVIL)'));}],
 ['Voice report and fallback',()=>{assert(backend.includes('function cspLiteralSpeech_'));assert(backend.includes('sitePulseGemini_'));assert(ts.includes('parsed.lines.map'));assert(html.includes('DAILY SITE REPORT'));}],
 ['Readable collapsed navigation',()=>{assert(html.includes('nav-glyph'));assert(html.includes('navLabel(n.section)'));}],
 ['GitHub deploy is lockfile-independent',()=>{assert(workflow.includes('npm install --no-audit --no-fund'));assert(!workflow.includes('cache: npm'));assert(sw.includes("self.addEventListener('push'"));}]
];
for(const [label,check] of checks){check();console.log('PASS:',label);}
