import React,{useState} from 'react';
import {useSite} from '../lib/site-context';
import {cap,formatDate,money} from '../lib/format';
import type {Report} from '../lib/models';
export default function Reviews(){
  const {data,mutation,busy,notify}=useSite();
  const [selected,setSelected]=useState<Report|null>(null),[quantities,setQuantities]=useState<Record<string,number>>({}),[note,setNote]=useState('');
  if(!data)return null;
  const pending=data.reports.filter(r=>r.status==='pending');
  const choose=(r:Report)=>{setSelected(r);setQuantities(Object.fromEntries(r.lines.map(l=>[l.id||'',Number(l.quantity)])));setNote('');};
  async function approve(){if(!selected)return;const edits=selected.lines.map(l=>({id:l.id,quantity:Number(quantities[l.id||''])}));if(edits.some(e=>!Number.isFinite(e.quantity)||e.quantity<0)){notify('Enter valid review quantities.','error');return;}
    try{const result=await mutation<{workbook_synced?:boolean}>('reviewReport',[selected.id,'approved',edits],'Report approved.');if(result.workbook_synced===false)notify('Report approved, but Workbook export needs Admin > Workbook > Sync approved reports.','error');setSelected(null);}catch(_){}}
  async function requestRevision(){if(!selected||!note.trim()){notify('Enter clear instructions for the supervisor.','error');return;}
    try{await mutation('requestRevision',[selected.id,note.trim()],'Report returned to supervisor for revision.');setSelected(null);}catch(_){}}
  return <div className="fade-in"><section className="panel"><div className="panel-head"><div><p className="eyebrow">LEAD WORKFLOW</p><h3>Reports awaiting approval</h3></div><span className="pill warning">{pending.length} pending</span></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Ticket</th><th>Work date</th><th>Supervisor</th><th>Work performed</th><th>Completion</th><th>Review</th></tr></thead><tbody>{pending.map(r=><tr key={r.id}><td>{r.ticket_no}</td><td>{formatDate(r.work_date||r.date)}</td><td>{r.supervisor_name}</td><td className="single-line" title={r.work_done}>{r.work_done}</td><td>{cap(r.completion_status)}</td><td><button className="btn secondary small" onClick={()=>choose(r)}>Review report</button></td></tr>)}{!pending.length&&<tr><td className="empty" colSpan={6}>No reports waiting for approval.</td></tr>}</tbody></table></div></section>
    {selected&&<div className="modal-backdrop" onMouseDown={()=>setSelected(null)}><section className="ticket-modal panel review-modal" role="dialog" aria-modal="true" aria-label="Review site report" onMouseDown={e=>e.stopPropagation()}><div className="panel-head"><div><p className="eyebrow">REPORT APPROVAL</p><h3>{selected.ticket_no} - {selected.supervisor_name}</h3></div><button className="btn-icon" onClick={()=>setSelected(null)}>X</button></div><div className="ticket-modal-body"><pre className="history-report-text">{selected.daily_report_text||selected.work_done}</pre>
    <h4>Resource quantities (can be adjusted for approval)</h4>{selected.lines.map(l=><div className="resource-row-v6" key={l.id}><span>{l.item_name||l.item_id}</span><input type="number" min="0" step="any" value={quantities[l.id||'']??0} aria-label={'Quantity '+l.item_name} onChange={e=>setQuantities(p=>({...p,[l.id||'']:Number(e.target.value)}))}/><span>{l.rate_unit||'unit'}</span><span>{money(l.locked_price||0)}</span></div>)}
    <label className="form-field"><span>Revision instructions (if returning)</span><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="Tell the supervisor what needs correction."/></label><div className="button-row"><button className="btn ghost" disabled={busy||!note.trim()} onClick={()=>void requestRevision()}>Send back for revision</button><button className="btn primary" disabled={busy} onClick={()=>void approve()}>Approve report</button></div></div></section></div>}
  </div>;
}
