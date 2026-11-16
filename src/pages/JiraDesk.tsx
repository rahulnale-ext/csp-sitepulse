import React,{useEffect,useState} from 'react';
import {useSite} from '../lib/site-context';
interface Desk{id:string;name:string;projectKey:string}
interface Queue{id:string;name:string;count:number}
interface Issue{key:string;summary:string;status:string;assignee?:string}
export default function JiraDesk(){
  const {data,request,mutation,busy,notify}=useSite();
  const [desks,setDesks]=useState<Desk[]>([]),[desk,setDesk]=useState(''),[queues,setQueues]=useState<Queue[]>([]),[queue,setQueue]=useState(''),[issues,setIssues]=useState<Issue[]>([]),[next,setNext]=useState<number|null>(null),[loading,setLoading]=useState(false);
  useEffect(()=>{if(data?.jiraReady)void loadDesks();},[Boolean(data?.jiraReady)]);
  if(!data)return null;
  async function loadDesks(){setLoading(true);try{
    const result=await request<Desk[]>('listJiraServiceDesks');const civil=result.filter(d=>d.projectKey.toUpperCase()==='CIVIL'||/civil/i.test(d.name));setDesks(civil);
    if(civil.length){setDesk(civil[0].id);await loadQueues(civil[0].id);}else notify('No CIVIL desk is accessible to the Jira account.','error');
  }catch(e){notify(e instanceof Error?e.message:'Unable to load Jira desks.','error');}finally{setLoading(false);}}
  async function loadQueues(id:string){try{const res=await request<Queue[]>('listJiraQueues',id);setQueues(res);setQueue('');setIssues([]);setNext(null);}catch(e){notify(e instanceof Error?e.message:'Unable to load Jira queues.','error');}}
  async function loadIssues(q:string,append=false){if(!q)return;setLoading(true);
    try{const result=await request<{issues:Issue[];next:number|null}>('listJiraQueueIssues',desk,q,append?(next||0):0);setIssues(old=>append?[...old,...result.issues]:result.issues);setNext(result.next);}catch(e){notify(e instanceof Error?e.message:'Unable to load queue.','error');}finally{setLoading(false);}}
  async function connection(){try{await request('testJiraConnection');notify('Jira connection verified.','success');}catch(e){notify(e instanceof Error?e.message:'Jira connection failed.','error');}}
  async function broadSync(){if(!window.confirm('This imports broad CIVIL history and may NOT match individual supervisor queues. Continue for reference purposes only?'))return;
    try{const r=await mutation<{fetched:number;created:number;updated:number;warning?:string}>('syncJiraTickets',[{project:'CIVIL'}],'Broad CIVIL history imported.');notify(`Fetched ${r.fetched}. This is NOT a supervisor-view sync. ${r.warning||''}`,'info');}catch(_){}}
  return <div className="fade-in"><section className="panel"><div className="panel-head"><div><p className="eyebrow">CIVIL SERVICE DESK (CIVIL)</p><h3>Jira service queues</h3></div><div className="button-row"><button className="btn ghost small" disabled={busy||loading} onClick={()=>void connection()}>Test connection</button><button className="btn ghost small" disabled={busy||loading} onClick={()=>void loadDesks()}>Refresh queues</button></div></div>
      {!data.jiraReady&&<div className="inline-warning">Jira connection is not configured in the backend Script Properties.</div>}
      <div className="form-grid inset"><label className="form-field"><span>Service desk</span><div className="service-desk-fixed">Civil Service Desk (CIVIL)</div></label><label className="form-field"><span>Queue</span><select aria-label="Jira queue" value={queue} onChange={e=>{setQueue(e.target.value);void loadIssues(e.target.value);}}><option value="">Choose queue...</option>{queues.map(q=><option key={q.id} value={q.id}>{q.name} - {q.count}</option>)}</select></label></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Ticket</th><th>Summary</th><th>Status</th><th>Assignee</th></tr></thead><tbody>{issues.map(i=><tr key={i.key}><td>{i.key}</td><td>{i.summary}</td><td>{i.status}</td><td>{i.assignee||'-'}</td></tr>)}{!issues.length&&<tr><td className="empty" colSpan={4}>{queue?'No issues in the selected queue.':'Select a CIVIL queue to see issues.'}</td></tr>}</tbody></table></div>
      {next!==null&&<div className="inset"><button className="btn secondary small" disabled={loading} onClick={()=>void loadIssues(queue,true)}>Load more</button></div>}
    </section><section className="panel warn-panel"><div className="panel-head"><h3>Broad CIVIL history (diagnostic only)</h3></div><div className="inset"><p className="tiny-muted">Importing all recently updated CIVIL tickets is NOT the same as a Jira supervisor queue. It previously inflated the Kalairasan and Vasanth counts. Use Tickets - Preview Jira queues for correct supervisor matching.</p><button className="btn ghost small" disabled={busy} onClick={()=>void broadSync()}>Import broad CIVIL history (not assignments)</button></div></section>
  </div>;
}
