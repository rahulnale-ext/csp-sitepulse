import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('backend/Code.gs');
function compiledModule(path){const {outputText,diagnostics}=ts.transpileModule(read(path),{fileName:path,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});assert.equal(diagnostics?.length||0,0);const context={exports:{},Intl,Date};vm.runInNewContext(outputText,context);return context.exports;}
test('all React/TSX source parses',()=>{
  for(const folder of ['src/components','src/pages','src/lib']){
    for(const entry of fs.readdirSync(new URL('../'+folder,import.meta.url))){if(!/\.(tsx?|jsx?)$/.test(entry))continue;
      const file=folder+'/'+entry;const result=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
      assert.equal(result.diagnostics?.length||0,0,file);
    }
  }
});
test('date-only display handles Sheets UTC timestamps',()=>{
  const f=compiledModule('src/lib/format.ts');
  assert.equal(f.formatEffectiveDate('2026-11-11T18:30:00.000Z'),'12-11-2026');
  assert.equal(f.formatEffectiveDate('2026-07-31T18:30:00.000Z'),'01-08-2026');
  assert.equal(f.formatEffectiveDate('2026-11-12'),'12-11-2026');
});
test('original report without Work Quantities heading can still be pasted',()=>{
  const f=compiledModule('src/lib/format.ts');
  const text=['DAILY SITE REPORT','Ticket No: CIVIL-161','Work Date: 17/11/2026','Project Location: Site','Supervisor name: Laxman','Work Done:','Flooring completed','','Labours','Masons: Not Used','', 'Materials Used','Cement Bags: Not Used','','Equipment Used','JCB: Not Used','','Work Completion Status','In Progress'].join('\n');
  const parsed=f.parseDailyReport(text,{jira_ticket_no:'CIVIL-161'},[]);
  assert.equal(parsed.work_done,'Flooring completed');assert.equal(parsed.workRows.length,0);
});
test('Supervisors have no Overview/Tickets routes and paste-only report text',()=>{
  const app=read('src/App.tsx'),r=read('src/pages/Reports.tsx'),nav=read('src/lib/i18n.ts');
  assert.match(app,/data\.user\.role==='supervisor'\?<Navigate to="\/reports"/);
  assert.match(nav,/\{section:'tickets',icon:'🎫',roles:\['admin','lead'\]\}/);
  assert.match(r,/readOnly=\{data\.user\.role==='supervisor'\}/);
  assert.match(r,/Apply pasted report/);
  assert.doesNotMatch(r,/English for Admin and Lead/);
});
test('WhatsApp is an external click-to-chat link, not internal chat',()=>{
  const c=read('src/components/WhatsAppLauncher.tsx'),b=backend,settings=read('src/pages/Settings.tsx');
  assert.match(c,/https:\/\/wa\.me\//);
  assert.match(c,/person\.role==='admin'/);
  assert.match(b,/whatsappContacts:/);
  assert.doesNotMatch(settings,/chat\.google\.com/);
});
test('Approved reports write readable values to both workbook tabs without duplicates',()=>{
  class MockSheet {
    constructor(name,rows=[]){this.name=name;this.rows=rows.map(r=>[...r]);this.columns=40;}
    getName(){return this.name;}
    setName(name){this.name=name;return this;}
    getLastRow(){return this.rows.length;}
    getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}
    getMaxColumns(){return this.columns;}
    insertColumnsAfter(_after,n){this.columns+=n;}
    setFrozenRows(){}setColumnWidths(){}setColumnWidth(){}
    clearContents(){this.rows=[];}
    copyTo(book){const sh=new MockSheet(this.name+' copy',this.rows);book.sheets.push(sh);return sh;}
    getRange(row,col,height=1,width=1){const sh=this;
      const range={getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>sh.rows[row+i-1]?.[col+j-1]??'')),
        setValues:(values)=>{values.forEach((record,i)=>{const r=row+i-1;while(sh.rows.length<=r)sh.rows.push([]);record.forEach((v,j)=>sh.rows[r][col+j-1]=v);});return range;},
        setValue:(v)=>range.setValues([[v]]),
        setFontColor:()=>range,setBackground:()=>range,setFontWeight:()=>range,setNumberFormat:()=>range};return range;}
  }
  const formHeaders=['Timestamp','Email Address','AI Report','Supervisor Name','Civil Ticket No','Work Date',...Array.from({length:23},(_,i)=>'Col '+i)];
  const form=new MockSheet('Form Responses 1',[formHeaders,[...Array(25).fill(''),'=G2*1','=J2*1','=R2*1','=SUM(Z2:AB2)']]);
  const book={sheets:[form],getSheetByName(name){return this.sheets.find(x=>x.name===name)||null;},insertSheet(name){const tab=new MockSheet(name);this.sheets.push(tab);return tab;}};
  const env={console,Logger:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>k==='REPORTING_WORKBOOK_ID'?'workbook-id':k==='SITE_TIMEZONE'?'Asia/Kolkata':''})},Date,
    Utilities:{formatDate:(date,tz,pattern)=>{
      const d=new Date(date),p=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);
      const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return pattern==='dd-MM-yyyy'?`${v.day}-${v.month}-${v.year}`:`${v.hour}:${v.minute}:${v.second}`;
    }}
  };
  env.SpreadsheetApp={openById:id=>{assert.equal(id,'workbook-id');return book;}};
  vm.createContext(env);vm.runInContext(backend,env);
  env.rows_=(ss,table)=>({Master_Items:[{id:'m1',name:'Cement Bags',type:'material'}],Tickets:[{id:'t1',jira_ticket_no:'CIVIL-161',location:'Main Hall'}],Users:[]})[table]||[];
  env.peopleById_=()=>({});
  const report={id:'9ebac452-7350-4b87-b9d2-84c06dfffefa',status:'approved',approved_at:'2026-11-18T08:10:00Z',work_date:'2026-11-17',work_done:'Installed tiles',daily_report_text:'DAILY SITE REPORT',work_quantities_json:'[{"description":"Flooring","quantity":100,"unit":"sq.ft"}]',ticket_id:'t1',completion_status:'completed'};
  const lines=[{item_id:'m1',quantity:10,locked_price:17,rate_unit:'bag'}];
  const first=env.syncApprovedReportToWorkbook_({},report,lines,{name:'Supervisor',email:'test@example.com'},{name:'Lead'});
  assert.equal(first.created,true);assert.equal(first.archiveAdded,true);assert.equal(first.responseAdded,true);
  const approved=book.getSheetByName('Approved Reports');
  assert.equal(approved.rows.length,2);
  assert.equal(approved.rows[0][10],'Work Quantities');
  assert.equal(approved.rows[0][11],'Resources Used');
  assert.equal(approved.rows[1][10],'Flooring: 100 sq.ft');
  assert.match(approved.rows[1][11],/Cement Bags: 10 bag/);
  assert.equal(approved.rows[1][16],170);
  assert.equal(approved.rows[1][3],'17-11-2026');
  assert.match(approved.rows[1][0],/^R-[A-Z0-9]{12}$/);
  assert.equal(form.rows.length,2,'template row 2 should be filled');
  assert.equal(form.rows[1][9],10,'cement quantity in existing reporting columns');
  assert.equal(form.rows[1][5],'17-11-2026');
  assert.equal(form.rows[1][29],approved.rows[1][0]);
  assert.ok(!approved.rows[1].some(v=>typeof v==='string'&&v.startsWith('[{')));
  const repeat=env.syncApprovedReportToWorkbook_({},report,lines,{name:'Supervisor',email:'test@example.com'},{name:'Lead'});
  assert.equal(repeat.alreadyPresent,true);
  assert.equal(approved.rows.length,2);assert.equal(form.rows.length,2);
  // A partially written record is recovered in the empty response sheet, not duplicated in archive.
  form.rows[1][29]='';
  const repaired=env.syncApprovedReportToWorkbook_({},report,lines,{name:'Supervisor',email:'test@example.com'},{name:'Lead'});
  assert.equal(repaired.archiveAdded,false);assert.equal(repaired.responseAdded,true);
  assert.ok(backend.includes("'syncApprovedReportsToWorkbook'"));
});

test('Jira Desk appears under Tickets, nested queues use dropdowns, no Overview navigation',()=>{
 const tickets=read('src/pages/Tickets.tsx');const jira=read('src/pages/JiraDesk.tsx');const nav=read('src/lib/i18n.ts');
 assert.match(tickets,/import JiraDesk from/);assert.match(tickets,/showJiraDesk&&<JiraDesk\/>/);
 assert.match(jira,/Jira queue group/);assert.match(jira,/Jira sub-queue/);
 assert.doesNotMatch(jira,/jira-queue-tabs/);
 assert.doesNotMatch(nav,/\{section:'overview'/);
 assert.doesNotMatch(nav,/\{section:'jira'/);
});

test('Workbook and UI avoid raw machine-formatted values',()=>{
 assert.doesNotMatch(backend.match(/const CSP_APPROVED_HEADERS=\[[^\]]+\]/)?.[0]||'',/JSON/);
 assert.match(backend,/syncResponseRow_/);
 assert.match(backend,/report\.approved_at=new Date\(\)\.toISOString\(\)/);
 assert.match(read('src/pages/Workbook.tsx'),/readableWorkbookValue/);
 assert.match(read('src/lib/site-context.tsx'),/could not be completed/);
});

test('Legacy JSON export headings convert to readable text with preserved source backup',()=>{
  class Sheet{
    constructor(name,rows=[]){this.name=name;this.rows=rows.map(r=>[...r]);this.columns=20;this.hidden=false;}
    getName(){return this.name;}setName(n){this.name=n;return this;}hideSheet(){this.hidden=true;return this;}
    getLastRow(){return this.rows.length;}getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}
    getMaxColumns(){return this.columns;}insertColumnsAfter(_i,n){this.columns+=n;}clearContents(){this.rows=[];}
    setFrozenRows(){}setColumnWidths(){}setColumnWidth(){}
    copyTo(book){const copy=new Sheet(this.name+' copy',this.rows);book.sheets.push(copy);return copy;}
    getRange(r,c,h=1,w=1){const range={getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>this.rows[r+i-1]?.[c+j-1]??'')),
      setValues:values=>{values.forEach((row,i)=>{while(this.rows.length<r+i)this.rows.push([]);row.forEach((value,j)=>{this.rows[r+i-1][c+j-1]=value;});});return range;},
      setBackground:()=>range,setFontColor:()=>range,setFontWeight:()=>range};return range;}
  }
  const legacyHeads=['Report ID','Approved At','Work Date','Ticket','Supervisor','Supervisor Email','Project Location','Work Done','DAILY SITE REPORT','Work Quantities JSON','Resource Lines JSON','Labour Total (INR)','Materials Total (INR)','Equipment Total (INR)','Other Total (INR)','Grand Total (INR)','Approved By','Approval Status'];
  const sample=['99ddcbee-3cca-4d31-a1dd-9fee52dd1293','2026-11-17T07:30:00.000Z','2026-11-16','CIVIL-200','Person','person@example.com','Hall','Flooring','DAILY SITE REPORT','[{"description":"Flooring","quantity":4,"unit":"sq.ft"}]','[{"name":"Masons","quantity":2,"unit":"day","lockedPrice":950}]',1900,0,0,0,1900,'Lead','Approved'];
  const old=new Sheet('Approved Reports',[legacyHeads,sample]);
  const book={sheets:[old],getSheetByName(n){return this.sheets.find(s=>s.name===n)||null;}};
  const env={PropertiesService:{getScriptProperties:()=>({getProperty:()=>''})},Utilities:{formatDate:()=>''}};
  vm.createContext(env);vm.runInContext(backend,env);
  const converted=env.approvedArchive_(book);
  assert.equal(converted.rows[0][10],'Work Quantities');
  assert.equal(converted.rows[1][10],'Flooring: 4 sq.ft');
  assert.match(converted.rows[1][11],/Masons: 2 day/);
  assert.equal(converted.rows[1][1],'','the old export timestamp is not treated as the approval timestamp');
  assert.equal(converted.rows[1][3],'16-11-2026');
  assert.equal(book.getSheetByName('Approved Reports - original')?.hidden,true);
  assert.equal(book.getSheetByName('Approved Reports - original')?.rows[1][9],sample[9]);
});
