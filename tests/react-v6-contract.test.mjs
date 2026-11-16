import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backend=fs.readFileSync(path.join(root,'backend','Code.gs'),'utf8');
const frontend=fs.readFileSync(path.join(root,'src','pages','Tickets.tsx'),'utf8');
const app=fs.readFileSync(path.join(root,'src','App.tsx'),'utf8');
const appCss=fs.readFileSync(path.join(root,'src','app.css'),'utf8');
const models=fs.readFileSync(path.join(root,'src','lib','format.ts'),'utf8');
function backendContext(){const ctx=vm.createContext({});vm.runInContext(backend,ctx);return ctx;}
const staff=['Raju venkatesh','Murugesh Subbappa','Ayush','Guna','Balakrishanan','Kalai','Vasant','Prakash','Thangapandi','SURESH','KARTIKEYAN','KARTIK','Siva','Vighnesh','Bankim'].map((name,i)=>({id:'u'+i,name,role:'supervisor'}));
test('all supplied alternate spellings map to existing staff without renaming',()=>{
 const c=backendContext();
 for(const [jira,staffName] of [['Raju','Raju venkatesh'],['Balakrishnan','Balakrishanan'],['Kalairasan','Kalai'],['Vasanth','Vasant'],['Shiva','Siva'],['Vignesh','Vighnesh'],['Bankim','Bankim']]){
   const found=c.cspQueuePerson_(jira,staff);assert.equal(found?.name,staffName,jira);
 }
 assert.equal(c.cspQueuePerson_('Unlisted Person',staff),null);
 assert.equal(staff[0].name,'Raju venkatesh');
});
test('supervisor queues are kept separate from broad CIVIL issue assignees',()=>{
 const c=backendContext();
 c.jiraPaged_=(_settings,path)=>path.endsWith('/servicedesk')?[{id:'4',projectKey:'CIVIL'}]:[
   {id:'21',name:'Raju',issueCount:32},{id:'22',name:'Vasanth',issueCount:10},{id:'23',name:'Kalairasan',issueCount:46},{id:'24',name:'Assignee_Maintenance',issueCount:85}];
 const result=c.cspSupervisorQueuePlan_({props:{getProperty:()=>''}},staff);
 assert.equal(result.source,'queue');assert.equal(result.queues.length,3);
 assert.equal(result.queues.find(x=>x.name==='Kalairasan').count,46);
 assert.equal(result.queues.find(x=>x.name==='Vasanth').count,10);
 assert.equal(result.unmatchedQueues.length,1);
});
test('explicit Jira filter IDs work when per-person views are saved filters',()=>{
 const c=backendContext();
 const property=JSON.stringify({Vasanth:{filterId:23456,group:'maintenance'},Raju:{filterId:98765,group:'new_works'}});
 c.jiraRequest_=(_settings,url,query)=>url.startsWith('/rest/api/2/filter/')?{id:url.split('/').pop(),name:'Shared '+url.split('/').pop()}: {issues:[{key:'CIVIL-123'}],total:Number(query.jql.includes('23456')?10:32)};
 const result=c.cspSupervisorQueuePlan_({props:{getProperty:key=>key==='JIRA_SUPERVISOR_FILTERS_JSON'?property:''}},staff);
 assert.equal(result.source,'filter');assert.equal(result.queues.length,2);
 assert.equal(result.queues.find(x=>x.staff_name==='Vasant').count,10);
 assert.equal(result.queues.find(x=>x.staff_name==='Raju venkatesh').count,32);
});
test('Jira filter excludes non-CIVIL tickets before local writes',()=>{
 const c=backendContext();c.jiraRequest_=()=>({issues:[{key:'ABC-9'}],total:1});
 assert.throws(()=>c.cspQueueIssues_({},'', '12345','filter'),/non-CIVIL/);
});
test('import and sync are read-only against Jira',()=>{
 assert.match(backend,/function syncJiraSupervisorQueues/);
 assert.match(backend,/previewJiraSupervisorQueues.*syncJiraSupervisorQueues/);
 assert.match(backend,/const automatic=\['jira','jira_queue',''\]/);
 assert.match(backend,/value\.assigned_by='jira_queue'/);
 assert.doesNotMatch(backend.slice(backend.indexOf('function cspSupervisorQueuePlan_'),backend.indexOf('function setSupervisorPriorities')),/\bmethod\s*:\s*['"](?:PUT|POST|PATCH|DELETE)['"]/i);
});
test('Tickets require verified assignee and use compact full-column table',()=>{
 assert.match(models,/t\.assigned_by==='jira_queue'/);
 assert.match(frontend,/const verified=ticketRows\.filter\(isVerifiedAssignment\)/);
 assert.match(frontend,/Preview Jira queues/);
 assert.match(frontend,/Sync verified queues/);
 assert.match(frontend,/IESM_Location/);
 assert.match(frontend,/Reporter<\/th>/);
 assert.match(appCss,/\.compact-ticket-table/);
 assert.match(appCss,/text-overflow:ellipsis/);
});
test('React has notifications accessible throughout scrolling and before login',()=>{
 assert.match(appCss,/\.toast-stack\{position:fixed/);
 assert.match(app,/if\(!data\)return <><Auth\/><ToastStack\/><\/>/);
 assert.match(app,/ToastStack/);
 assert.match(app,/react-router-dom/);
});
test('React source has no Angular runtime or internal messaging page',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert.ok(pkg.dependencies.react);
 assert.ok(pkg.dependencies['react-router-dom']);
 assert.ok(pkg.dependencies['react-hook-form']);
 assert.ok(!pkg.dependencies['@angular/core']);
 assert.ok(!fs.existsSync(path.join(root,'angular.json')));
 assert.ok(!fs.existsSync(path.join(root,'src','app','app.component.ts')));
 assert.ok(!fs.existsSync(path.join(root,'src','pages','Messages.tsx')));
});
test('GitHub Pages workflow uses Node 22 and builds dist',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github','workflows','deploy.yml'),'utf8');
 assert.match(workflow,/node-version:\s*'22'/);
 assert.match(workflow,/npm install --no-audit --no-fund/);
 assert.match(workflow,/run: npm run build/);
 assert.match(workflow,/path: dist/);
 assert.match(workflow,/actions\/configure-pages@v5/);
});
