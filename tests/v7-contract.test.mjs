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
test('Workbook export writes approved entries exactly once',()=>{
  const env={console,Logger:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>k==='REPORTING_WORKBOOK_ID'?'workbook-id':''})},Date};
  const rows=[];
  let sheet;
  const mockTab=()=>({
    getLastRow:()=>rows.length,
    getRange:(r,c,n,m)=>({
      setValues:(values)=>{for(let i=0;i<values.length;i++)rows[r+i-1]=values[i];return {setBackground(){return this},setFontColor(){return this},setFontWeight(){return this}}},
      getValues:()=>rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+m)),
      setBackground(){return this},setFontColor(){return this},setFontWeight(){return this}
    }),
    setFrozenRows(){},setColumnWidths(){},setColumnWidth(){}
  });
  const book={getSheetByName:()=>sheet,insertSheet:()=>{sheet=mockTab();return sheet;}};
  env.SpreadsheetApp={openById:id=>{assert.equal(id,'workbook-id');return book;}};
  vm.createContext(env);vm.runInContext(backend,env);
  env.rows_=(ss,table)=>({Master_Items:[{id:'m1',name:'Cement Bags',type:'material'}],Tickets:[{id:'t1',jira_ticket_no:'CIVIL-161',location:'Main Hall'}],Users:[]})[table]||[];
  env.peopleById_=()=>({});
  const report={id:'r1',status:'approved',work_date:'2026-11-17',work_done:'Installed tiles',daily_report_text:'DAILY SITE REPORT',work_quantities_json:'[]',ticket_id:'t1'};
  const lines=[{item_id:'m1',quantity:10,locked_price:17,rate_unit:'bag'}];
  const first=env.syncApprovedReportToWorkbook_({},report,lines,{name:'Supervisor',email:'test@example.com'},{name:'Lead'});
  assert.equal(first.created,true);assert.equal(rows.length,2);assert.equal(rows[1][15],170);
  const second=env.syncApprovedReportToWorkbook_({},report,lines,{name:'Supervisor',email:'test@example.com'},{name:'Lead'});
  assert.equal(second.alreadyPresent,true);assert.equal(rows.length,2);
  assert.ok(backend.includes("'syncApprovedReportsToWorkbook'"));
});
