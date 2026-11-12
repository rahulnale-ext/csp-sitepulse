import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const source=readFileSync(new URL('../backend/Code.gs',import.meta.url),'utf8');
const start=source.indexOf('function cspLiteralSpeech_(');
const end=source.indexOf('function localizeRevision(',start);
assert(start>=0&&end>start);
const items=[{id:'cement',name:'Cement Bags',rate_unit:'bags'}];
const context=createContext({
 db_:()=>({}),requireRole_:()=>({id:'sup',name:'Laxman'}),
 text_:(v)=>String(v||''),
 rows_:(_ss,table)=>table==='Tickets'?[{id:'t1',jira_ticket_no:'CIVIL-161',assigned_supervisor_id:'sup',location:'IYC-Hall'}]:table==='Master_Items'?items:[],
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
 Utilities:{formatDate:()=> '2026-11-12'},siteDate_:(v)=>v,
 sitePulseGemini_:(prompt,audio)=>({
   transcript:'ಇಂದು ಇಪ್ಪತ್ತೈದು ಸಿಮೆಂಟ್ ಚೀಲ ಬಳಸಿದ್ದೇವೆ',
   workDoneEnglish:'Used 25 cement bags today.',completionStatus:'in progress',
   resources:{'Cement Bags':'25 bags'},questions:[],lines:[{item_id:'cement',quantity:25,evidence:'ಇಪ್ಪತ್ತೈದು ಸಿಮೆಂಟ್ ಚೀಲ'}]
 }),console
});
runInContext(source.slice(start,end),context);
const kannada='ಇಂದು ಇಪ್ಪತ್ತೈದು ಸಿಮೆಂಟ್ ಚೀಲ ಬಳಸಿದ್ದೇವೆ';
let r=context.interpretWorkVoice('session',kannada,'kn-IN','t1','2026-11-12');
assert.equal(r.work_done,'Used 25 cement bags today.');
assert.equal(r.source_transcript,kannada);
assert.equal(r.source_language,'kn-IN');
assert.match(r.reportText,/Work Done:\nUsed 25 cement bags today/);
assert.equal(r.lines.length,1);
assert.equal(r.lines[0].quantity,25);
const fakeAudio='YWFh'.repeat(35);
r=context.interpretWorkAudio('session',fakeAudio,'audio/webm','kn-IN','t1','2026-11-12');
assert.equal(r.source_transcript,kannada);
assert.equal(r.work_done,'Used 25 cement bags today.');
assert.throws(()=>context.interpretWorkAudio('session',fakeAudio,'application/octet-stream','kn-IN','t1','2026-11-12'),/Unsupported recording/);
context.sitePulseGemini_=()=>{throw new Error('AI offline');};
r=context.interpretWorkVoice('session',kannada,'kn-IN','t1','2026-11-12');
assert.equal(r.work_done,'');
assert.equal(r.mode,'literal');
assert.equal(r.questions.length,0);
assert(!r.reportText.includes('Work Done:\n'+kannada),'Must not copy untranslated Kannada into English report');
assert.throws(()=>context.interpretWorkAudio('session',fakeAudio,'audio/webm','kn-IN','t1','2026-11-12'),/Unable to interpret/);
console.log('PASS: Kannada evidence-based quantities, English report, audio, strict offline fallback and recording validation');
