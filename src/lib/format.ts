import type {Ticket,Report,Resource,ReportLine,Staff} from './models';
export const formatDate=(value:unknown)=>{if(!value)return '-';const d=new Date(String(value));return Number.isNaN(d.valueOf())?String(value):new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(d);};
export const money=(x:unknown)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(x)||0);
export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const cap=(x:unknown)=>String(x||'-').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase());
export const isClosed=(t:Ticket)=>/closed|resolved|completed|done|cancelled|canceled/i.test(String(t.status||''));
/** Only verified personal Jira queues or deliberate manual SitePulse overrides count as assigned. */
export function isVerifiedAssignment(t:Ticket){
  return Boolean(t.assigned_supervisor_id) && (t.assigned_by==='jira_queue'||(Boolean(t.assigned_by)&&t.assigned_by!=='jira'));
}
export function printableReport({ticket,staff,workDate,workDone,workRows,lines,items,status}:{ticket?:Ticket;staff?:Staff;workDate:string;workDone:string;workRows:Array<{description:string;quantity:number;unit:string}>;lines:ReportLine[];items:Resource[];status:string}){
  const itemValue=(name:string)=>{
    const line=lines.find(l=>(items.find(i=>i.id===l.item_id)?.name||l.item_name||'').toLowerCase()===name.toLowerCase());
    return line?String(line.quantity)+' '+(line.rate_unit||items.find(i=>i.id===line.item_id)?.rate_unit||'unit'):'Not Used';
  };
  return ['DAILY SITE REPORT',
    'Ticket No: '+(ticket?.jira_ticket_no||'Not Applicable'),
    'Work Date: '+workDate.split('-').reverse().join('/'),
    'Project Location: '+(ticket?.location||'Not Applicable'),
    'Supervisor name: '+(staff?.name||'Not Applicable'),
    'Work Done:',workDone||'Not Applicable','',
    'Work Quantities',...workRows.filter(x=>x.description&&Number(x.quantity)>0).map(x=>`${x.description}: ${x.quantity} ${x.unit||'unit'}`),'',
    'Labours',...['Masons','Helpers','FC','Etc'].map(n=>n+': '+itemValue(n)),'',
    'Materials Used',...['Cement Bags','M Sand','P Sand','Jelly/Chips','Bricks','Solid Blocks','Tiles','Other Materials'].map(n=>n+': '+itemValue(n)),'',
    'Equipment Used',...['Tractor','Crane','JCB','Scaffolding','Other Equipment'].map(n=>n+': '+itemValue(n)),'',
    'Work Completion Status',cap(status)].join('\n');
}
export function parseDailyReport(text:string,ticket:Ticket,items:Resource[]){
  const src=text.replace(/\r/g,'').trim();
  if(!src.startsWith('DAILY SITE REPORT\n')||!src.includes('Ticket No: '+ticket.jira_ticket_no))throw new Error('Paste a full DAILY SITE REPORT for the selected ticket.');
  const work=src.match(/Work Done:\s*\n([\s\S]*?)\n\s*(?:Work Quantities|Labours)\b/);
  if(!work||!work[1].trim()||work[1].trim()==='Not Applicable')throw new Error('Enter the work description under Work Done.');
  const block=src.match(/Work Quantities\s*\n([\s\S]*?)\n\s*Labours\b/);
  const workRows=(block?block[1]:'').split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{
    const m=line.match(/^(.+?):\s*(\d+(?:\.\d+)?)\s+(.+)$/);
    if(!m||Number(m[2])<=0)throw new Error('Check work quantity: '+line);
    return {description:m[1],quantity:Number(m[2]),unit:m[3]};
  });
  const parts=[['Labours','Materials Used'],['Materials Used','Equipment Used'],['Equipment Used','Work Completion Status']];
  const lines:ReportLine[]=[];
  for(const [section,next] of parts){
    const a=src.match(new RegExp('(?:^|\\n)'+section+'\\s*\\n([\\s\\S]*?)\\n\\s*'+next));
    if(!a)throw new Error('Missing section: '+section);
    for(const line of a[1].split('\n').map(x=>x.trim()).filter(Boolean)){
      const idx=line.indexOf(':');if(idx<0)throw new Error('Invalid resource line: '+line);
      const name=line.slice(0,idx).trim();const amount=line.slice(idx+1).trim();
      if(/^(not used|not applicable)$/i.test(amount))continue;
      const m=amount.match(/^(\d+(?:\.\d+)?)(\s|$)/);
      if(!m||Number(m[1])<=0)throw new Error('Invalid quantity for '+name);
      const item=items.find(i=>i.name.toLowerCase()===name.toLowerCase());
      if(!item)throw new Error(`Resource "${name}" is not in the catalog. Ask Admin to add it before submission.`);
      lines.push({item_id:item.id,quantity:Number(m[1])});
    }
  }
  const state=(src.split(/Work Completion Status/)[1]||'').trim().split('\n')[0].toLowerCase();
  if(!['completed','partially completed','in progress','not started'].includes(state))throw new Error('Choose a valid Work Completion Status.');
  return {work_done:work[1].trim(),workRows,lines,completion_status:state};
}

/** Preserve the effective calendar date only, including Sheets UTC date serialization. */
export function effectiveISODate(value:unknown):string {
  const raw=String(value||'').trim(); if(!raw)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const d=new Date(raw); if(!Number.isFinite(d.getTime()))return raw.slice(0,10);
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
export function formatEffectiveDate(value:unknown):string {const d=effectiveISODate(value);return /^\d{4}-\d{2}-\d{2}$/.test(d)?d.slice(8,10)+'-'+d.slice(5,7)+'-'+d.slice(0,4):d||'-';}
