import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,CheckCircle2,ChevronDown,Filter,RefreshCcw,Search,ShieldCheck,SlidersHorizontal,X} from 'lucide-react';
import {useSite} from '../lib/site-context';
import {cap,formatDate,isClosed,isVerifiedAssignment} from '../lib/format';
import type {JiraDetail,Staff,Ticket} from '../lib/models';
import JiraDesk from './JiraDesk';

interface Queue {id:string;name:string;staff_id:string;staff_name:string;count:number;group:string}
interface QueuePreview {queues:Queue[];unmatchedQueues:{name:string;count:number}[];allQueueCount:number;note:string}
interface QueueSync {queues:number;created:number;updated:number;linked:number;clearedOld:number;manualPreserved:number;conflicts:string[];counts:{supervisor:string;queue:string;expected:number;queueId:string}[];note:string}
const PAGE_SIZE=60;
function sortPriority(a:Ticket,b:Ticket){return Number(a.priority_sequence||999999)-Number(b.priority_sequence||999999)||a.jira_ticket_no.localeCompare(b.jira_ticket_no);}
export default function Tickets(){
  const {data,notify,request,mutation,busy}=useSite();
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[person,setPerson]=useState('all'),[group,setGroup]=useState('all'),[location,setLocation]=useState('all'),[date,setDate]=useState(''),[page,setPage]=useState(1);
  const [priorityPerson,setPriorityPerson]=useState(''),[priorities,setPriorities]=useState<Record<string,number>>({}),[priorityExpanded,setPriorityExpanded]=useState(false);
  const [preview,setPreview]=useState<QueuePreview|null>(null),[lastSync,setLastSync]=useState<QueueSync|null>(null),[previewBusy,setPreviewBusy]=useState(false);
  const [selected,setSelected]=useState<Ticket|null>(null),[detail,setDetail]=useState<JiraDetail|null>(null),[detailBusy,setDetailBusy]=useState(false);
  const [manualPerson,setManualPerson]=useState('');
  const [showJiraDesk,setShowJiraDesk]=useState(false);
  if(!data)return null;
  const isAdmin=data.user.role==='admin';
  const supervisors=data.users.filter(u=>u.role==='supervisor'||(u.role==='lead'&&String(u.can_supervise)==='true'));
  const ticketRows=data.tickets.filter(t=>!t.project_key||String(t.project_key).toUpperCase()==='CIVIL');
  const verified=ticketRows.filter(isVerifiedAssignment);
  const base=verified;
  const countsBySupervisor=Object.fromEntries(supervisors.map(u=>[u.id,verified.filter(t=>t.assigned_supervisor_id===u.id).length]));
  const locations=Array.from(new Set(verified.map(t=>String(t.location||'').trim()).filter(Boolean))).sort();
  const rows=base.filter(t=>{
    if(person!=='all'&&t.assigned_supervisor_id!==person)return false;
    if(group!=='all'&&t.jira_assignment_group!==group)return false;
    if(status==='open'&&isClosed(t)||status==='closed'&&!isClosed(t))return false;
    if(location!=='all'&&t.location!==location)return false;
    if(date&&String(t.created||'').slice(0,10)!==date)return false;
    if(search.trim()&&!([t.jira_ticket_no,t.summary,t.location,t.jira_assignee,t.status,t.reporter].join(' ').toLowerCase().includes(search.toLowerCase())))return false;
    return true;
  }).sort(sortPriority);
  const totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  const visibleRows=rows.slice((Math.min(page,totalPages)-1)*PAGE_SIZE,Math.min(page,totalPages)*PAGE_SIZE);
  const updatePage=()=>setPage(1);
  const priorityRows=verified.filter(t=>t.assigned_supervisor_id===priorityPerson).sort(sortPriority);
  function changePriorityPerson(id:string){setPriorityPerson(id);setPriorities(Object.fromEntries(verified.filter(t=>t.assigned_supervisor_id===id).sort(sortPriority).map((t,i)=>[t.id,Number(t.priority_sequence)||i+1])));}
  async function savePriorities(){const entries=priorityRows.map(t=>({id:t.id,priority:Number(priorities[t.id])}));
    if(entries.some(x=>!Number.isInteger(x.priority)||x.priority<1)||new Set(entries.map(x=>x.priority)).size!==entries.length){notify('Enter distinct whole-number priorities, starting at 1.','error');return;}
    try{await mutation('setSupervisorPriorities',[priorityPerson,entries],'Supervisor ticket priorities saved.');}catch(_){ }
  }
  async function previewQueues(){setPreviewBusy(true);try{
    const result=await request<QueuePreview>('previewJiraSupervisorQueues');setPreview(result);setLastSync(null);
    if(!result.queues.length)notify('No person-named Jira queues were found. Nothing changed. Ask the Jira administrator for saved-filter IDs if these are custom views.','error');
    else notify(`Found ${result.queues.length} person-named CIVIL queues. Review their counts before syncing.`,'info');
  }catch(e){notify(e instanceof Error?e.message:'Unable to load Jira queue preview.','error');}finally{setPreviewBusy(false);}}
  async function syncQueues(){if(!preview?.queues.length)return;
    if(!window.confirm('Match the previewed CIVIL supervisor queues inside SitePulse? Existing manual overrides will be retained. Jira itself will not be edited.'))return;
    try{const result=await mutation<QueueSync>('syncJiraSupervisorQueues',[], 'Jira supervisor queue sync completed.');
      setLastSync(result);notify(`Matched ${result.linked} queue tickets; cleared ${result.clearedOld} stale automatic links; preserved ${result.manualPreserved} manual overrides.`,'success');
    }catch(_){}}
  async function openTicket(t:Ticket){setSelected(t);setManualPerson(t.assigned_supervisor_id||'');setDetail(null);
    if(!isAdmin)return;setDetailBusy(true);
    try{const result=await request<{detail:JiraDetail}>('fetchJiraTicketByKey',t.jira_ticket_no);setDetail(result.detail);}catch(_){/* SitePulse data still opens if Jira details are unavailable. */}finally{setDetailBusy(false);}
  }
  async function assignManual(){if(!selected||!manualPerson){notify('Select a supervisor.','error');return;}
    if(!window.confirm('Create a manual SitePulse assignment override? Jira itself will not change.'))return;
    try{await mutation('assignTicket',[selected.id,manualPerson],'Manual SitePulse assignment saved.');setSelected(null);}catch(_){}}
  return <div className="fade-in tickets-page">
    {isAdmin&&<div className="jira-inside-tickets"><div className="ticket-jira-toggle"><button type="button" className="btn secondary small" onClick={()=>setShowJiraDesk(v=>!v)} aria-expanded={showJiraDesk}>{showJiraDesk?'Hide Jira Desk':'Jira Desk · CIVIL queues'}</button></div>{showJiraDesk&&<JiraDesk/>}</div>}
    {isAdmin&&<section className="queue-sync-strip panel">
      <div className="queue-sync-text"><ShieldCheck size={17}/><div><strong>Jira supervisor queue matching</strong><small>Only tickets confirmed by CIVIL supervisor queues or approved saved filters are counted as Jira-assigned. Unverified tickets are not counted as confirmed supervisor assignments.</small></div></div>
      <div className="button-row"><button type="button" className="btn ghost small" onClick={()=>void previewQueues()} disabled={previewBusy||busy}>{previewBusy?'Checking...':'Preview Jira queues'}</button><button type="button" className="btn primary small" onClick={()=>void syncQueues()} disabled={!preview?.queues.length||previewBusy||busy}>Sync verified queues</button></div>
    </section>}
    {isAdmin&&preview&&<section className="panel queue-preview"><div className="panel-head"><div><p className="eyebrow">LIVE JIRA ASSIGNEE VIEWS - PREVIEW ONLY</p><h3>{preview.queues.length} matching views found</h3></div><button className="btn-icon" onClick={()=>setPreview(null)} aria-label="Close queue preview"><X size={17}/></button></div>
      <p className="tiny-muted inset">{preview.note}</p>
      <div className="queue-chips">{preview.queues.map(q=><span className="queue-chip" key={q.id}><b>{q.staff_name}</b><span>{q.name}</span><strong>{q.count}</strong></span>)}
      {!preview.queues.length&&<p className="inline-warning">Jira has not exposed the individual supervisor queues through its API. Ask the Jira administrator for numeric saved-filter IDs; matching all CIVIL tickets would create inaccurate totals.</p>}</div>
      {preview.unmatchedQueues.length>0&&<details className="queue-unmatched"><summary>{preview.unmatchedQueues.length} Jira queues did not match approved SitePulse staff (left unchanged)</summary><p>{preview.unmatchedQueues.map(q=>q.name+' ('+q.count+')').join(', ')}</p></details>}
    </section>}
    {isAdmin&&lastSync&&<div className="sync-report panel"><CheckCircle2 size={17}/><div><b>Local queue sync finished:</b> {lastSync.linked} linked; {lastSync.clearedOld} old automatic assignments cleared; {lastSync.manualPreserved} manual overrides kept. {lastSync.conflicts.length} conflicting ticket(s) not automatically assigned. <small>Jira itself was not changed.</small></div></div>}
    <div className="tickets-layout">
      <aside className="panel ticket-facets"><div className="facet-title">Jira views <small>Local scope</small></div>
        <button className={'facet-item '+(person==='all'?'selected':'')} onClick={()=>{setPerson('all');updatePage();}}>Queue-verified <span className="facet-count">{verified.length}</span></button>
        <div className="facet-title with-border">Verified assignees</div>
        {supervisors.map(u=><button key={u.id} className={'facet-item indented '+(person===u.id?'selected':'')} onClick={()=>{setPerson(person===u.id?'all':u.id);updatePage();}}>{u.name}<span className="facet-count">{countsBySupervisor[u.id]||0}</span></button>)}
      </aside>
      <div className="tickets-table-region">
        {isAdmin&&<section className="panel priority-panel"><div className="priority-header"><div><b>Supervisor ticket priorities</b><small>Rank SitePulse tickets for each supervisor; Jira priorities will not change.</small></div><button className="btn ghost small" type="button" onClick={()=>setPriorityExpanded(x=>!x)}>{priorityExpanded?'Hide':'Edit priorities'} <ChevronDown size={13}/></button></div>
          {priorityExpanded&&<><select value={priorityPerson} onChange={e=>changePriorityPerson(e.target.value)} aria-label="Supervisor to prioritize"><option value="">Choose supervisor...</option>{supervisors.map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select>
            <div className="priority-list">{priorityRows.map(t=><div className="priority-entry" key={t.id}><input type="number" min="1" max="9999" value={priorities[t.id]||''} onChange={e=>setPriorities(p=>({...p,[t.id]:Number(e.target.value)}))} aria-label={'Priority for '+t.jira_ticket_no}/><b>{t.jira_ticket_no}</b><span title={t.summary}>{t.summary}</span></div>)}
              {priorityPerson&&priorityRows.length===0&&<p className="empty compact-empty">No queue-verified tickets for this supervisor.</p>}</div>
            <button className="btn primary small" disabled={!priorityRows.length||busy} onClick={()=>void savePriorities()}>Save all priorities</button>
          </>}
        </section>}
        <div className="panel compact-filters">
          <label className="search-field"><Search size={14}/><input value={search} onChange={e=>{setSearch(e.target.value);updatePage();}} placeholder="Search tickets, summary, location" aria-label="Search tickets"/></label>
          <select aria-label="Status" value={status} onChange={e=>{setStatus(e.target.value);updatePage();}}><option value="all">All statuses</option><option value="open">Open</option><option value="closed">Closed</option></select>
          <select aria-label="Supervisor" value={person} onChange={e=>{setPerson(e.target.value);updatePage();}}><option value="all">All supervisors</option>{supervisors.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select aria-label="Jira group" value={group} onChange={e=>{setGroup(e.target.value);updatePage();}}><option value="all">All Jira groups</option><option value="maintenance">Maintenance</option><option value="new_works">New Works</option><option value="new_projects">New Projects</option><option value="verified_queue">Other verified queues</option></select>
          <select aria-label="IESM Location" value={location} onChange={e=>{setLocation(e.target.value);updatePage();}}><option value="all">All locations</option>{locations.map(x=><option key={x} value={x}>{x}</option>)}</select>
          <input aria-label="Created date" type="date" value={date} onChange={e=>{setDate(e.target.value);updatePage();}}/>
          <button type="button" className="btn ghost small reset-filter" onClick={()=>{setSearch('');setStatus('all');setPerson('all');setGroup('all');setLocation('all');setDate('');setPage(1);}}><X size={12}/>Reset</button>
          <b className="toolbar-count">{rows.length} tickets</b>
        </div>
        <div className="panel compact-table-wrap"><div className="compact-scroll"><table className="compact-ticket-table"><colgroup><col style={{width:'7%'}}/><col style={{width:'3%'}}/><col style={{width:'6.5%'}}/><col style={{width:'19%'}}/><col style={{width:'8%'}}/><col style={{width:'12%'}}/><col style={{width:'8%'}}/><col style={{width:'9%'}}/><col style={{width:'9%'}}/><col style={{width:'5%'}}/><col style={{width:'7%'}}/><col style={{width:'6.5%'}}/></colgroup><thead><tr><th>Key</th><th title="SitePulse Priority">P</th><th>Created</th><th>Summary</th><th>Status</th><th>IESM_Location</th><th>Contact</th><th>Request Type</th><th>Sub-Request</th><th>Design</th><th>Assignee</th><th>Reporter</th></tr></thead>
            <tbody>{visibleRows.map(t=><tr key={t.id} title={t.summary} onClick={()=>void openTicket(t)}><td><button className="jira-link" type="button">{t.jira_ticket_no}</button></td><td>{t.priority_sequence||'-'}</td><td>{formatDate(t.created)}</td><td className="single-line strong" title={t.summary}>{t.summary}</td><td><span className="jira-status" title={t.status}>{t.status||'-'}</span></td><td className="single-line" title={t.location||'Not provided'}>{t.location||'-'}</td><td>{t.contact_number||'-'}</td><td className="single-line" title={t.request_type||''}>{t.request_type||'-'}</td><td className="single-line" title={t.sub_request_type||''}>{t.sub_request_type||'-'}</td><td>{t.design_needed||'-'}</td><td className="single-line" title={t.jira_assignee||''}>{t.jira_assignee||supervisors.find(u=>u.id===t.assigned_supervisor_id)?.name||'-'}</td><td className="single-line" title={t.reporter||''}>{t.reporter||'-'}</td></tr>)}
              {!visibleRows.length&&<tr><td colSpan={12} className="empty">No tickets in this verified scope. Preview Jira queues or reset filters. Unverified historical CIVIL issues are not automatically assigned.</td></tr>}
            </tbody></table></div><div className="table-page"><small>Page {Math.min(page,totalPages)} of {totalPages}. Click a row for all fields.</small><div className="button-row"><button className="btn ghost small" disabled={page<=1} onClick={()=>setPage(x=>x-1)}>Previous</button><button className="btn ghost small" disabled={page>=totalPages} onClick={()=>setPage(x=>x+1)}>Next</button></div></div></div>
      </div>
    </div>
    {selected&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setSelected(null)}><section role="dialog" aria-modal="true" aria-label={'Ticket '+selected.jira_ticket_no} className="ticket-modal panel" onMouseDown={e=>e.stopPropagation()}><div className="panel-head"><div><p className="eyebrow">JIRA / {selected.project_key||'CIVIL'}</p><h3>{selected.jira_ticket_no}</h3></div><button className="btn-icon" aria-label="Close ticket" onClick={()=>setSelected(null)}><X size={18}/></button></div>
      <div className="ticket-modal-body"><h4>{selected.summary}</h4><div className="detail-grid">{([['Status',selected.status],['Priority',selected.priority_sequence],['Created',formatDate(selected.created)],['IESM_Location',selected.location],['Contact number',selected.contact_number],['Request type',selected.request_type],['Sub-request',selected.sub_request_type],['Design needed',selected.design_needed],['Jira assignee',selected.jira_assignee],['Reporter',selected.reporter],['Source',selected.assigned_by]] as const).map(([key,value])=><div key={key}><small>{key}</small><b>{String(value||'-')}</b></div>)}</div>
        {detailBusy&&<p className="tiny-muted">Loading extended Jira details...</p>}
        {detail&&<><h4>Jira details</h4><div className="detail-grid">{detail.properties?.map((p,i)=><div key={i}><small>{p.label}</small><b>{p.value||'-'}</b></div>)}</div></>}
        {isAdmin&&<div className="manual-override"><b>Manual SitePulse override</b><p className="tiny-muted">Use only if Jira queue mapping is unavailable. This will not edit Jira.</p><select aria-label="Override supervisor" value={manualPerson} onChange={e=>setManualPerson(e.target.value)}><option value="">Select supervisor...</option>{supervisors.map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select><button className="btn secondary small" disabled={busy||!manualPerson} onClick={()=>void assignManual()}>Save local override</button></div>}
      </div></section></div>}
  </div>;
}
