import React,{useEffect,useMemo,useState} from 'react';
import {useFieldArray,useForm,useWatch} from 'react-hook-form';
import {useSite} from '../lib/site-context';
import {formatDate,isClosed,isVerifiedAssignment,money,parseDailyReport,printableReport,today,effectiveISODate} from '../lib/format';
import type {Report,ReportLine,Resource} from '../lib/models';
interface WorkRow {description:string;quantity:number;unit:string}
interface ItemRow {id?:string;item_id:string;quantity:number;rate_id?:string;rate_mode?:string;actual_rate?:number;rate_note?:string}
interface FormData {ticket_id:string;work_date:string;completion_status:string;work_done:string;workRows:WorkRow[];lines:ItemRow[]}
const defaults=():FormData=>({ticket_id:'',work_date:today(),completion_status:'in progress',work_done:'',workRows:[],lines:[]});
export default function Reports(){
  const {data,busy,mutation,notify}=useSite();
  const form=useForm<FormData>({defaultValues:defaults()});
  const work=useFieldArray({control:form.control,name:'workRows'});
  const resources=useFieldArray({control:form.control,name:'lines'});
  const vals=useWatch({control:form.control});
  const [text,setText]=useState(''),[appliedDigest,setAppliedDigest]=useState(''),[selectedItem,setSelectedItem]=useState(''),[itemQty,setItemQty]=useState(1),[selectedRate,setSelectedRate]=useState(''),[actualRate,setActualRate]=useState(''),[rateNote,setRateNote]=useState(''),[verified,setVerified]=useState(false),[revision,setRevision]=useState<Report|null>(null),[history,setHistory]=useState('all');
  if(!data)return null;
  const canReport=data.user.role==='supervisor'||data.user.role==='lead'&&String(data.user.can_supervise)==='true';
  const eligible=data.tickets.filter(t=>t.assigned_supervisor_id===data.user.id&&!isClosed(t)&&t.assignment_status!=='returned'&&t.assignment_status!=='completed'&&isVerifiedAssignment(t));
  const selectedTicket=data.tickets.find(t=>t.id===vals.ticket_id);
  const availableRates=data.itemRates.filter(r=>r.item_id===selectedItem && effectiveISODate(r.effective_date||r.changed_at)<=String(vals.work_date||today())).sort((a,b)=>effectiveISODate(b.effective_date||b.changed_at).localeCompare(effectiveISODate(a.effective_date||a.changed_at)));
  const isApplied=Boolean(appliedDigest && appliedDigest===JSON.stringify({text,ticket:vals.ticket_id}) && text.trim());
  const historyReports=data.reports.filter(r=>history==='all'||r.status===history);
  const resById=(id:string)=>data.items.find(i=>i.id===id);
  function applyText(){if(!selectedTicket){notify('Choose a ticket.','error');return;}
    try{const decoded=parseDailyReport(text,selectedTicket,data.items);
      const prior=form.getValues('lines');
      form.setValue('work_done',decoded.work_done);
      form.setValue('completion_status',decoded.completion_status);
      work.replace(decoded.workRows);
      resources.replace(decoded.lines.map(l=>({...prior.find(x=>x.item_id===l.item_id),item_id:l.item_id,quantity:l.quantity,rate_mode:prior.find(x=>x.item_id===l.item_id)?.rate_mode||'catalog'})));
      const current=form.getValues();setAppliedDigest(JSON.stringify({text,ticket:current.ticket_id}));setVerified(false);
      notify('Report text applied. Verify quantities and rates before submitting.','success');
    }catch(error){notify(error instanceof Error?error.message:'Invalid report format.','error');}
  }
  function addLine(){if(!selectedItem||!(Number(itemQty)>0)){notify('Choose an item and a positive quantity.','error');return;}
    if(actualRate!==''&&(!rateNote.trim()||Number(actualRate)<0)){notify('For an actual rate, enter a valid price and vendor/receipt reference.','error');return;}
    resources.append({item_id:selectedItem,quantity:Number(itemQty),rate_id:selectedRate||undefined,rate_mode:actualRate!==''?'actual':'catalog',actual_rate:actualRate!==''?Number(actualRate):undefined,rate_note:rateNote});
    setSelectedItem('');setItemQty(1);setSelectedRate('');setActualRate('');setRateNote('');setVerified(false);
  }
  async function submit(){if(!isApplied){notify('Select a ticket, paste a DAILY SITE REPORT and click Apply pasted report.','error');return;}
    if(!verified){notify('Tick the verification box before submitting.','error');return;}
    const v=form.getValues();if(!selectedTicket||!v.work_done.trim()||v.workRows.some(x=>!x.description.trim()||!(Number(x.quantity)>0)||!x.unit.trim())){notify('Verify the ticket, work description and quantities.','error');return;}
    const canonical=printableReport({ticket:selectedTicket,staff:data.user,workDate:v.work_date,workDone:v.work_done,workRows:v.workRows,lines:v.lines.map(l=>({...l,quantity:Number(l.quantity)})),items:data.items,status:v.completion_status});
    const payload={ticket_id:v.ticket_id,work_date:v.work_date,work_done:v.work_done,completion_status:v.completion_status,work_measure:0,work_measure_unit:'',source_transcript:'',source_language:'',work_quantities:v.workRows,lines:v.lines.map(l=>({...l,quantity:Number(l.quantity)})),daily_report_text:canonical};
    try{if(revision)await mutation('reviseReport',[revision.id,payload],'Revised report submitted for approval.');else await mutation('submitReport',[payload],'Daily report submitted for approval.');
      form.reset(defaults());setText('');setAppliedDigest('');setVerified(false);setRevision(null);
    }catch(_){}}
  function editRevision(r:Report){setRevision(r);
    let w:WorkRow[]=[];try{w=JSON.parse(r.work_quantities_json||'[]') as WorkRow[];}catch(_){w=[];}
    form.reset({ticket_id:r.ticket_id,work_date:r.work_date||today(),work_done:r.work_done,completion_status:r.completion_status,workRows:w,lines:r.lines.map(l=>({id:l.id,item_id:l.item_id,quantity:l.quantity,rate_id:l.rate_id,rate_mode:l.rate_mode,actual_rate:l.locked_price,rate_note:l.rate_note}))});
    setText(r.daily_report_text||'');setAppliedDigest('');setVerified(false);window.scrollTo({top:0,behavior:'smooth'});
  }
  return <div className="fade-in reports-page">
    {canReport&&<section className="panel form-panel"><div className="panel-head"><div><p className="eyebrow">DAILY SITE UPDATE - MANUAL REPORT</p><h3>{revision?'Revise existing report':'Create report'}</h3></div>{revision&&<button className="btn ghost small" onClick={()=>{setRevision(null);form.reset(defaults());setText('');setAppliedDigest('');}}>Cancel revision</button>}</div>
      {revision&&<div className="revision-alert"><b>Lead requested revisions:</b> {revision.revision_note}</div>}
      <div className="report-meta-row">
        <label className="form-field report-ticket"><span>Assigned ticket</span><select {...form.register('ticket_id',{required:true})} disabled={Boolean(revision)}><option value="">Choose ticket...</option>{eligible.map(t=><option key={t.id} value={t.id}>{t.jira_ticket_no} - {t.summary}</option>)}{revision&&!eligible.find(t=>t.id===revision.ticket_id)&&<option value={revision.ticket_id}>{revision.ticket_no}</option>}</select></label>
        <label className="form-field"><span>Work date</span><input type="date" max={today()} {...form.register('work_date',{required:true})}/></label>
        <label className="form-field"><span>Completion status</span><select {...form.register('completion_status')}><option value="in progress">In Progress</option><option value="partially completed">Partially Completed</option><option value="completed">Completed</option><option value="not started">Not Started</option></select></label>
      </div>
      <div className="paste-report-block"><div className="resource-head"><h4>DAILY SITE REPORT</h4><div className="button-row"><button type="button" className="btn ghost small" onClick={()=>{if(!navigator.clipboard?.readText){notify('Use Ctrl+V or long-press Paste in the box.','error');return;}void navigator.clipboard.readText().then(value=>{setText(value);setAppliedDigest('');setVerified(false);}).catch(()=>notify('Clipboard access unavailable. Focus the box and press Paste (Ctrl+V).','error'));}}>Paste report</button><button type="button" className="btn secondary small" onClick={applyText} disabled={!text.trim()}>Apply pasted report</button></div></div>
        <textarea className="manual-report-editor" aria-label="Paste-only DAILY SITE REPORT" rows={10} readOnly={data.user.role==='supervisor'} value={text} onPaste={e=>{if(data.user.role==='supervisor'){e.preventDefault();setText(e.clipboardData.getData('text/plain'));setAppliedDigest('');setVerified(false);}}} onChange={e=>{if(data.user.role!=='supervisor'){setText(e.target.value);setAppliedDigest('');setVerified(false);}}} placeholder="Paste a complete DAILY SITE REPORT here. Editing is disabled for supervisors."/>
        {isApplied&&<span className="confirmed">Report received. Verify structured quantities below.</span>}
      </div>
      <div className="work-quantities-section"><div className="resource-head"><h4>Work Quantities</h4></div>
        <div className="form-field"><span className="sr-only">Work quantities</span>{work.fields.map((row,index)=><div key={row.id} className="quantity-row"><input placeholder="Activity, e.g. flooring" {...form.register(`workRows.${index}.description` as const,{required:true})}/><input type="number" min="0.01" step="any" aria-label="Work quantity" {...form.register(`workRows.${index}.quantity` as const,{valueAsNumber:true,min:0.01})}/><input placeholder="sq.ft / cu.ft / m" {...form.register(`workRows.${index}.unit` as const,{required:true})}/><button type="button" className="btn ghost small" onClick={()=>{work.remove(index);setVerified(false);}}>Remove</button></div>)}<button type="button" className="btn secondary small" onClick={()=>{work.append({description:'',quantity:1,unit:'sq.ft'});setVerified(false);}}>+ Add work quantity</button></div>
      </div>
      <div className="resource-head"><h4>Materials, labour and equipment</h4></div>
      <div className="line-editor"><select aria-label="Resource" value={selectedItem} onChange={e=>{setSelectedItem(e.target.value);setSelectedRate('');setActualRate('');}}><option value="">Select a resource...</option>{data.items.map(i=><option key={i.id} value={i.id}>{i.name} ({i.rate_unit||'unit'})</option>)}</select><input type="number" aria-label="Resource quantity" min="0.01" step="any" value={itemQty} onChange={e=>setItemQty(Number(e.target.value))}/><button className="btn secondary small" onClick={addLine} type="button">+ Add resource</button></div>
      {selectedItem&&<div className="rate-choice"><label className="form-field"><span>Recorded rate (optional)</span><select value={selectedRate} onChange={e=>{setSelectedRate(e.target.value);setActualRate('');}}><option value="">Current approved rate</option>{availableRates.map(r=><option key={r.id} value={r.id}>{money(r.new_rate)} / {r.rate_unit} - {r.effective_date||r.changed_at?.slice(0,10)}</option>)}</select></label><label className="form-field"><span>Actual paid rate (optional)</span><input type="number" value={actualRate} onChange={e=>{setActualRate(e.target.value);setSelectedRate('');}} min="0" step="any"/></label><label className="form-field"><span>Vendor / receipt reference</span><input value={rateNote} onChange={e=>setRateNote(e.target.value)} maxLength={250}/></label></div>}
      <div className="lines-list">{resources.fields.map((l,index)=><div className="resource-row-v6" key={l.id}><span>{resById(l.item_id)?.name||'Unknown'}</span><input aria-label={'Quantity '+(resById(l.item_id)?.name||'resource')} type="number" step="any" min="0.01" {...form.register(`lines.${index}.quantity` as const,{valueAsNumber:true,min:0.01})}/><small>{resById(l.item_id)?.rate_unit||'unit'}</small><button type="button" className="btn ghost small" onClick={()=>{resources.remove(index);setVerified(false);}}>Remove</button></div>)}{!resources.fields.length&&<p className="empty compact-empty">No resources added.</p>}</div>
      <div className="form-footer"><label className="verify-label"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> I have verified the report, work quantities and resource quantities</label><button type="button" className="btn primary" disabled={busy||!isApplied||!verified} onClick={()=>void submit()}>Submit for approval</button></div>
    </section>}
    <section className="panel reports-history"><div className="panel-head"><div><p className="eyebrow">FIELD REPORTS</p><h3>Report history</h3></div><select value={history} onChange={e=>setHistory(e.target.value)} aria-label="Report status"><option value="all">All statuses</option><option value="pending">Pending</option><option value="revision_requested">Revision requested</option><option value="approved">Approved</option></select></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Ticket</th><th>Work date</th><th>Supervisor</th><th>Work Done</th><th>Status</th><th>Action</th></tr></thead><tbody>{historyReports.map(r=><tr key={r.id}><td>{r.ticket_no}</td><td>{formatDate(r.work_date||r.date)}</td><td>{r.supervisor_name}</td><td className="single-line" title={r.work_done}>{r.work_done}</td><td><span className="pill">{r.status}</span></td><td>{r.status==='revision_requested'&&r.supervisor_id===data.user.id?<button className="btn secondary small" onClick={()=>editRevision(r)}>Revise</button>:<details><summary>View report</summary><pre className="history-report-text">{r.daily_report_text||r.work_done}</pre></details>}</td></tr>)}{!historyReports.length&&<tr><td colSpan={6} className="empty">No reports found.</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
