import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import assert from 'node:assert/strict';
const src=readFileSync(new URL('../backend/Code.gs',import.meta.url),'utf8');
const between=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)));
const items=[{id:'cement',name:'Cement Bags',rate_unit:'bag',current_price:50,type:'material'}];
const rates=[
 {id:'yesterday',item_id:'cement',new_rate:15,rate_unit:'bag',effective_date:'2026-11-10',source:'Vendor A',changed_at:'2026-11-10T09:00:00Z'},
 {id:'today',item_id:'cement',new_rate:10,rate_unit:'bag',effective_date:'2026-11-11',source:'Vendor B',changed_at:'2026-11-11T09:00:00Z'},
 {id:'tomorrow',item_id:'cement',new_rate:17,rate_unit:'bag',effective_date:'2026-11-12',source:'Vendor C',changed_at:'2026-11-11T10:00:00Z'}
];
const context=createContext({
 Utilities:{formatDate:()=> '2026-11-11'},
 rows_:(_ss,tab)=>tab==='Master_Items'?items:tab==='Item_Rates'?rates:[],
 itemRates_:()=>rates,
 number_:(input,label)=>{const n=Number(input);if(!Number.isFinite(n)||n<0)throw Error('Invalid '+label);return n;},
 text_:(input,label,max,required)=>{const t=String(input||'').trim();if(required&&!t)throw Error(label+' required');return t.slice(0,max);}
});
runInContext(between('function siteDate_','function deleteMasterItem(')+between('function reportLinePayload_','function dailyReportText_'),context);
const calc=(lines,prior=[])=>context.reportLinePayload_(null,{work_date:'2026-11-11',lines},prior);
assert.equal(calc([{item_id:'cement',quantity:20}])[0].locked_price,10);
const boughtYesterday=calc([{item_id:'cement',quantity:2,rate_id:'yesterday'}])[0];
assert.equal(boughtYesterday.locked_price,15);
assert.equal(boughtYesterday.rate_source,'Vendor A');
assert.throws(()=>calc([{item_id:'cement',quantity:1,rate_id:'tomorrow'}]),/Future-dated/);
const actual=calc([{item_id:'cement',quantity:3,rate_mode:'actual',actual_rate:12,rate_note:'Vendor receipt 78'}])[0];
assert.equal(actual.locked_price,12);
assert.equal(actual.rate_note,'Vendor receipt 78');
assert.throws(()=>calc([{item_id:'cement',quantity:1,rate_mode:'actual',actual_rate:12}]),/required/);
const saved=calc([{id:'old-line',item_id:'cement',quantity:4,rate_mode:'actual',actual_rate:99}], [{id:'old-line',item_id:'cement',locked_price:15,rate_unit:'bag',rate_id:'yesterday',rate_source:'Vendor A'}]);
assert.equal(saved[0].locked_price,15,'Revision must keep original price');
const voice=createContext({});runInContext(between('function cspLiteralSpeech_','function interpretWorkVoice('),voice);
const output=voice.cspLiteralSpeech_('12 masons and 50 cement bags, 100 bricks, in progress',[
 {id:'mason',name:'Masons',rate_unit:'day'},...items,{id:'brick',name:'Bricks',rate_unit:'each'}]);
assert.equal(output.lines.length,3);assert.equal(output.lines[1].quantity,50);
assert.equal(voice.cspLiteralSpeech_('12 missions and 50 breaks',items).lines.length,0);
console.log('PASS: dated rate selection, future-date rejection, actual vendor rate, locked revisions, and conservative voice extraction');
