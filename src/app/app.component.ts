import {Component, OnInit, OnDestroy} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ApiService} from './api.service';
import {PushService} from './push.service';
import {NAV,LANGUAGES,tr,TextKey} from './i18n';
import type {Bootstrap, JiraDetail, Lang, Notice, Report, ReportDraft, ReportLine, Resource, Role, Section, Staff, Ticket, Workbook} from './models';
import {environment} from './environment';

type SpeechEngine = {lang:string;continuous:boolean;interimResults:boolean;onresult:((event:{results:ArrayLike<{0:{transcript:string};isFinal:boolean}>;resultIndex:number})=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};

@Component({selector:'csp-root',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./app.component.html',styleUrl:'./app.component.css'})
export class AppComponent implements OnInit,OnDestroy {
  readonly languages=LANGUAGES;
  readonly nav=NAV;
  readonly title='CSP SitePulse';
  readonly todayIso=new Date().toISOString();
  lang:Lang = this.readLang();
  isCompact = localStorage.getItem('csp.sidebar')==='true';
  isMobileMenuOpen=false;
  section:Section='overview';
  data:Bootstrap|null=null;
  isBooting=false;
  busy=false;
  isLoginBusy=false;
  loginStep:'email'|'code'='email';
  email='';code='';
  message=''; messageKind:'success'|'error'|'info'='info';
  search='';ticketStatus='all';supervisorFilter='all';resourceFilter='all';
  selectedTicket:Ticket|null=null;
  jiraDetail:JiraDetail|null=null;
  jiraProject='CIVIL';
  jiraDesks:Array<{id:string;name:string;projectKey:string}>=[];
  jiraQueues:Array<{id:string;name:string;count:number}>=[];
  jiraQueueIssues:Array<{key:string;summary:string;status:string}>=[];
  selectedDesk='';selectedQueue='';queueNext:number|null=null;
  assignmentIds:Record<string,string>={};
  detailLoading=false;
  reportFilter='all';
  reportDraft:ReportDraft=this.freshReport();
  selectedItemId='';newItemQty=1;
  voiceTranscript='';recognizing=false;
  private recognition:SpeechEngine|null=null;
  verifiedDraft=false;
  revisionFor:Report|null=null;
  translatedRevision='';
  revisionComment=''; reviewFor:Report|null=null;
  reviewEdits:Record<string,number>={};
  editResource:Partial<Resource>={type:'material',name:'',current_price:0,quantity:0,rate_unit:'unit'};
  editUser:Partial<Staff>={role:'supervisor',name:'',email:'',manager_id:''};
  workbook:Workbook|null=null;
  selectedTab=''; workbookPage=1;
  cellEditor:{row:number;col:number;value:string;formula:string}|null=null;
  newColName='';
  labels:Partial<Record<Section,string>>={};
  private lastAutoJiraSync=0;

  constructor(public readonly api:ApiService,private readonly push:PushService) {}
  ngOnInit():void {
    if (this.api.hasSession) void this.loadBootstrap(true);
    if ('serviceWorker' in navigator) {
      const register=()=>navigator.serviceWorker.register('firebase-messaging-sw.js',{scope:'./'}).catch(()=>{});
      if(document.readyState==='complete')void register();
      else window.addEventListener('load',()=>{void register();},{once:true});
    }
  }
  ngOnDestroy():void { this.recognition?.stop(); }
  private readLang():Lang { const saved=localStorage.getItem('csp.lang');return (LANGUAGES.some(x=>x.code===saved)?saved:'en-IN') as Lang; }
  setLang(next:Lang):void {this.lang=next;localStorage.setItem('csp.lang',next);document.documentElement.lang=next.slice(0,2);}
  t(key:TextKey):string{return tr(this.lang,key);}
  navLabel(section:Section):string {return this.data?.menuLabels?.[section]||this.t(section);}
  get currentLanguageLabel():string{return LANGUAGES.find(l=>l.code===this.lang)?.label||'English';}
  itemUnit(id:string):string{return this.data?.items.find(i=>i.id===id)?.rate_unit||'unit';}
  get role():Role {return this.data?.user.role||'supervisor';}
  get visibleNav(){return this.nav.filter(n=>n.roles.includes(this.role));}
  get unread():number{return this.data?.notifications.filter(n=>!n.read_at).length||0;}
  get matchingTickets():Ticket[] {
    const q=this.search.trim().toLowerCase();return (this.data?.tickets||[]).filter(t=>{
      const s=(String(t.status||'')+' '+String(t.assignment_status||'')).toLowerCase();
      const closed=/done|closed|resolved|completed|cancelled|canceled/.test(s);
      return (this.ticketStatus==='all'||(this.ticketStatus==='open'?!closed:closed)) &&
        (this.supervisorFilter==='all'||String(t.assigned_supervisor_id)===this.supervisorFilter) &&
        (!q||[t.jira_ticket_no,t.summary,t.location,t.department,t.engineer_name,t.status].some(v=>String(v||'').toLowerCase().includes(q)));
    });
  }
  get matchingReports():Report[] {return (this.data?.reports||[]).filter(r=>this.reportFilter==='all'||r.status===this.reportFilter);}
  get pendingReports():Report[] {return (this.data?.reports||[]).filter(r=>r.status==='pending');}
  get eligibleSupervisors():Staff[]{return (this.data?.users||[]).filter(u=>u.role==='supervisor'||(u.role==='lead'&&String(u.can_supervise)==='true'));}
  get leads():Staff[]{return (this.data?.users||[]).filter(u=>u.role==='lead');}
  get adminUsers():Staff[]{return this.data?.users||[];}
  get resourceList():Resource[] {return (this.data?.items||[]).filter(i=>this.resourceFilter==='all'||i.type===this.resourceFilter);}
  get myOpenTickets():Ticket[] {return (this.data?.tickets||[]).filter(t=>t.assigned_supervisor_id===this.data?.user.id&&t.assignment_status!=='returned'&&t.assignment_status!=='completed'&&!/closed|resolved|done|cancelled|completed/i.test(t.status));}
  get assignedCount():number {return (this.data?.tickets||[]).filter(t=>!!t.assigned_supervisor_id).length;}
  get approvedCount():number{return (this.data?.reports||[]).filter(r=>r.status==='approved').length;}
  get completionPercent():number {const reports=this.data?.reports||[];return reports.length?Math.round(this.approvedCount*100/reports.length):0;}
  get reportLineTotal():number{return this.reportDraft.lines.reduce((sum,l)=>sum+Number(l.quantity||0),0);}
  get canReport():boolean{return this.role==='supervisor'||(this.role==='lead'&&String(this.data?.user.can_supervise)==='true');}
  get apiConfigured():boolean{return !environment.apiUrl.includes('YOUR-CLOUDFLARE-WORKER');}
  get revisionRequests():Report[] {return (this.data?.reports||[]).filter(r=>r.status==='revision_requested' && r.supervisor_id===this.data?.user.id);}
  userName(id?:string):string{return this.data?.users?.find(u=>u.id===id)?.name || (id?'Not assigned':'Unassigned');}
  itemName(id:string):string{return this.data?.items.find(i=>i.id===id)?.name||'Unknown';}
  fmtMoney(n:unknown):string {return new Intl.NumberFormat(this.lang,{style:'currency',currency:this.data?.currency||'INR',maximumFractionDigits:0}).format(Number(n)||0);}
  fmtDate(d:unknown):string {if(!d)return '—';const date=new Date(String(d));return Number.isNaN(date.getTime())?String(d):new Intl.DateTimeFormat(this.lang,{day:'numeric',month:'short',year:'numeric'}).format(date);}
  caps(s:unknown):string{return String(s||'—').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
  trackById(_index:number,item:{id?:string}):string{return item.id||String(_index);}
  private freshReport():ReportDraft {return {ticket_id:'',work_done:'',completion_status:'in progress',work_measure:0,work_measure_unit:'',lines:[]};}
  inform(message:string,kind:'success'|'error'|'info'='info'):void{this.message=message;this.messageKind=kind;}
  dismiss():void {this.message='';}
  async startLogin():Promise<void> {
    this.isLoginBusy=true;
    try {const res=await this.api.call<{message:string}>('requestLoginCode',this.email.trim());this.inform(res.message||'Check your email for the code.','success');this.loginStep='code';}
    catch(e){this.inform(this.errorText(e),'error');}
    finally{this.isLoginBusy=false;}
  }
  async confirmLogin():Promise<void>{
    this.isLoginBusy=true;
    try {const res=await this.api.call<{sessionToken:string;authorized:boolean}>('verifyLoginCode',this.email.trim(),this.code.trim());
      if(!res.authorized||!res.sessionToken)throw new Error('Sign-in was not completed.');
      this.api.setSession(res.sessionToken); await this.loadBootstrap(false);this.code='';
    } catch(e){this.inform(this.errorText(e),'error');}
    finally{this.isLoginBusy=false;}
  }
  async logout():Promise<void>{
    try {await this.api.call('logoutSession');} catch(_){}
    this.api.clearSession();this.data=null;this.section='overview';this.loginStep='email';this.isMobileMenuOpen=false;this.inform('Signed out.','info');
  }
  async loadBootstrap(initial=false):Promise<void>{
    if(this.isBooting)return;this.isBooting=true;
    try {const data=await this.api.call<Bootstrap>('getBootstrap');
      if(!data.authorized){this.api.clearSession();this.data=null;throw new Error(data.message||'Your session has expired.');}
      this.data=data;this.labels={...data.menuLabels};
      if(!this.visibleNav.some(n=>n.section===this.section))this.section='overview';
      if(!initial)this.inform('Your workspace is up to date.','success');
    }catch(e){if(initial)this.api.clearSession();this.inform(this.errorText(e),'error');}
    finally{this.isBooting=false;}
  }
  private errorText(e:unknown):string{return e instanceof Error?e.message:'The request could not be completed.';}
  async task(operation:()=>Promise<unknown>,success='Updated successfully.'):Promise<boolean>{
    if(this.busy)return false;this.busy=true;
    try {await operation();await this.loadBootstrapQuietly();if(success)this.inform(success,'success');return true;}
    catch(e){this.inform(this.errorText(e),'error');return false;}
    finally{this.busy=false;}
  }
  private async loadBootstrapQuietly():Promise<void> {const data=await this.api.call<Bootstrap>('getBootstrap');if(!data.authorized)throw new Error(data.message||'Session expired.');this.data=data;this.labels={...data.menuLabels};}
  go(section:Section):void {
    if(!this.visibleNav.some(n=>n.section===section)){this.inform(this.t('noPermission'),'error');return;}
    this.section=section;this.isMobileMenuOpen=false;this.search='';
    if(section==='workbook'&&!this.workbook)void this.loadWorkbook();
    if(section==='jira'&&!this.jiraDesks.length&&this.data?.jiraReady)void this.loadJiraDesks();
  }
  toggleSidebar():void {this.isCompact=!this.isCompact;localStorage.setItem('csp.sidebar',String(this.isCompact));}
  async onSupervisorChange():Promise<void>{
    if(this.role!=='admin'||this.supervisorFilter==='all'||!this.data?.jiraReady)return;
    if(Date.now()-this.lastAutoJiraSync<180000)return;
    this.lastAutoJiraSync=Date.now();await this.syncJira(true);
  }
  async syncJira(auto=false):Promise<void> {
    await this.task(async()=>{const result=await this.api.call<{fetched:number;created:number;updated:number;warning?:string}>('syncJiraTickets',{project:'CIVIL'});
      this.inform(`${auto?'Automatic':'Manual'} sync: ${result.fetched} fetched, ${result.created} new, ${result.updated} updated.${result.warning?' '+result.warning:''}`,'success');
    },'');
  }
  async openTicket(ticket:Ticket):Promise<void> {
    this.selectedTicket=ticket;this.jiraDetail=null;
    if(this.role!=='admin'||!this.data?.jiraReady)return;
    this.detailLoading=true;
    try {const result=await this.api.call<{detail:JiraDetail}>('fetchJiraTicketByKey',ticket.jira_ticket_no);this.jiraDetail=result.detail;}
    catch(e){this.inform(this.errorText(e),'error');}
    finally{this.detailLoading=false;}
  }
  closeTicket():void {this.selectedTicket=null;this.jiraDetail=null;}
  async assign(ticket:Ticket):Promise<void>{const id=this.assignmentIds[ticket.id]||ticket.assigned_supervisor_id||'';
    if(!id){this.inform('Choose a supervisor.','error');return;}
    await this.task(()=>this.api.call('assignTicket',ticket.id,id),'Ticket assigned.');
  }
  async setLead(ticket:Ticket,leadId:string):Promise<void>{await this.task(()=>this.api.call('saveTicketLead',ticket.id,leadId),'Reviewing lead updated.');}
  async setPriority(ticket:Ticket,value:string):Promise<void>{if(!value)return;await this.task(()=>this.api.call('setTicketPriority',ticket.id,Number(value)),'Priority updated.');}
  async returnAssigned(ticket:Ticket):Promise<void>{const note=window.prompt('Reason for returning this ticket?');if(!note?.trim())return;await this.task(()=>this.api.call('returnTicket',ticket.id,note.trim()),'Ticket returned.');}
  addLine():void{if(!this.selectedItemId||!Number.isFinite(Number(this.newItemQty))||Number(this.newItemQty)<=0){this.inform('Select a resource and enter a positive quantity.','error');return;}
    const existing=this.reportDraft.lines.find(l=>l.item_id===this.selectedItemId);
    if(existing)existing.quantity+=Number(this.newItemQty); else this.reportDraft.lines.push({item_id:this.selectedItemId,quantity:Number(this.newItemQty)});
    this.selectedItemId='';this.newItemQty=1;this.verifiedDraft=false;
  }
  removeLine(index:number):void {this.reportDraft.lines.splice(index,1);this.verifiedDraft=false;}
  startVoice():void {
    const ctor=(window as unknown as {SpeechRecognition?:new()=>SpeechEngine;webkitSpeechRecognition?:new()=>SpeechEngine}).SpeechRecognition ||
      (window as unknown as {webkitSpeechRecognition?:new()=>SpeechEngine}).webkitSpeechRecognition;
    if(!ctor){this.inform('Speech recognition is unavailable in this browser. Type the transcript, or try a supported browser.','error');return;}
    try{const rec=new ctor();rec.lang=this.lang;rec.continuous=true;rec.interimResults=false;
      rec.onresult=e=>{let content='';for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)content+=e.results[i][0].transcript+' ';this.voiceTranscript=(this.voiceTranscript+' '+content).trim();};
      rec.onerror=e=>{this.recognizing=false;this.inform('Voice capture: '+e.error,'error');};
      rec.onend=()=>{this.recognizing=false;};this.recognition=rec;rec.start();this.recognizing=true;
    }catch(e){this.inform(this.errorText(e),'error');}
  }
  stopVoice():void {this.recognition?.stop();this.recognizing=false;}
  async analyzeVoice():Promise<void>{if(!this.voiceTranscript.trim()){this.inform('Speak or type a transcript before generating the report.','error');return;}
    this.busy=true;
    try{const parsed=await this.api.call<{work_done:string;work_measure:number;work_measure_unit:string;lines:{item_id:string;quantity:number}[]}>('interpretWorkVoice',this.voiceTranscript,this.lang);
      this.reportDraft.work_done=parsed.work_done;this.reportDraft.work_measure=parsed.work_measure;this.reportDraft.work_measure_unit=parsed.work_measure_unit;
      this.reportDraft.lines=parsed.lines;this.verifiedDraft=false;this.inform('Draft generated. Review every detail before submitting.','success');
    }catch(e){this.inform(this.errorText(e),'error');}
    finally{this.busy=false;}
  }
  async submitDraft():Promise<void>{
    if(!this.verifiedDraft){this.inform('Verify the report and quantities before submitting.','error');return;}
    if(!this.reportDraft.ticket_id||!this.reportDraft.work_done.trim()||!this.reportDraft.lines.length||this.reportDraft.lines.some(l=>!Number.isFinite(Number(l.quantity))||Number(l.quantity)<=0)){
      this.inform('Choose a ticket, describe the work and add valid resource quantities.','error');return;}
    const draft={...this.reportDraft,lines:this.reportDraft.lines.map(x=>({...x,quantity:Number(x.quantity)}))};
    const success=await this.task(()=>this.revisionFor?this.api.call('reviseReport',this.revisionFor.id,draft):this.api.call('submitReport',draft),this.revisionFor?'Revision submitted.':'Report sent for approval.');
    if(success){this.reportDraft=this.freshReport();this.voiceTranscript='';this.revisionFor=null;this.verifiedDraft=false;this.go('reports');}
  }
  editRevision(report:Report):void {
    this.revisionFor=report;this.reportDraft={ticket_id:report.ticket_id,work_done:report.work_done,completion_status:report.completion_status,work_measure:report.work_measure,work_measure_unit:report.work_measure_unit,lines:report.lines.map(l=>({item_id:l.item_id,quantity:l.quantity}))};
    this.translatedRevision='';this.verifiedDraft=false;this.go('reports');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  async translateRevision():Promise<void>{if(!this.revisionFor?.revision_note)return;
    if(this.lang==='en-IN'){this.translatedRevision=this.revisionFor.revision_note;return;}
    this.busy=true;try{const r=await this.api.call<{translation:string}>('localizeRevision',this.revisionFor.revision_note,this.lang);this.translatedRevision=r.translation;}
    catch(e){this.inform(this.errorText(e),'error');}finally{this.busy=false;}
  }
  openReview(report:Report):void {this.reviewFor=report;this.reviewEdits=Object.fromEntries(report.lines.map(l=>[l.id||'',Number(l.quantity)]));this.revisionComment='';}
  closeReview():void {this.reviewFor=null;this.revisionComment='';}
  async approveReport():Promise<void>{if(!this.reviewFor)return;const report=this.reviewFor;
    const edits=report.lines.map(l=>({id:l.id,quantity:Number(this.reviewEdits[l.id||''])}));
    if(edits.some(e=>!e.id||!Number.isFinite(e.quantity)||e.quantity<0)||!edits.some(e=>e.quantity>0)){this.inform('Confirm every line quantity; at least one must be positive.','error');return;}
    const ok=await this.task(()=>this.api.call('reviewReport',report.id,'approved',edits),'Report approved.');if(ok)this.closeReview();
  }
  async rejectReport():Promise<void>{if(!this.reviewFor)return;const report=this.reviewFor;
    if(!this.revisionComment.trim()){this.inform('Enter revision instructions.','error');return;}
    const ok=await this.task(()=>this.api.call('requestRevision',report.id,this.revisionComment.trim()),'Revision requested.');if(ok)this.closeReview();
  }
  editPerson(p?:Staff):void{this.editUser=p?{...p}:{role:'supervisor',name:'',email:'',manager_id:''};}
  async savePerson():Promise<void>{const ok=await this.task(()=>this.api.call('saveUser',this.editUser),'Person saved.');if(ok)this.editPerson();}
  async removePerson(u:Staff):Promise<void>{if(!window.confirm(`Remove ${u.name}? This action cannot be undone.`))return;await this.task(()=>this.api.call('deleteUser',u.id),'Person removed.');}
  editItem(item?:Resource):void{this.editResource=item?{...item}:{type:'material',name:'',current_price:0,quantity:0,rate_unit:'unit'};}
  async saveItem():Promise<void>{const ok=await this.task(()=>this.api.call('saveMasterItem',this.editResource),'Resource saved.');if(ok)this.editItem();}
  async removeItem(item:Resource):Promise<void>{if(!window.confirm(`Remove ${item.name}?`))return;await this.task(()=>this.api.call('deleteMasterItem',item.id),'Resource removed.');}
  async seedItems():Promise<void>{await this.task(()=>this.api.call('seedLegacyCspItems'),'Default resource names added where missing.');}
  async seedRoster():Promise<void>{await this.task(()=>this.api.call('syncCspRoster'),'Supervisor roster updated. Verify emails and reporting leads.');}
  async markRead(notice:Notice):Promise<void>{if(notice.read_at)return;await this.task(()=>this.api.call('markNotificationRead',notice.id),'');}
  async enablePush():Promise<void>{this.busy=true;try{await this.push.enable((title,body)=>{this.inform(`${title}: ${body}`,'info');void this.loadBootstrapQuietly();});this.inform('This device is ready to receive notifications.','success');}catch(e){this.inform(this.errorText(e),'error');}finally{this.busy=false;}}
  async testPush():Promise<void>{await this.task(()=>this.api.call('sendPushTest'),'Test notification requested.');}
  async saveLabels():Promise<void>{await this.task(()=>this.api.call('saveMenuLabels',this.labels),'Menu names updated for all users.');}
  async testJira():Promise<void>{this.busy=true;try{const result=await this.api.call<unknown>('testJiraConnection');this.inform('Jira connection verified. '+JSON.stringify(result),'success');}catch(e){this.inform(this.errorText(e),'error');}finally{this.busy=false;}}
  async loadJiraDesks():Promise<void>{if(!this.data?.jiraReady)return;this.busy=true;
    try{this.jiraDesks=await this.api.call<typeof this.jiraDesks>('listJiraServiceDesks');}
    catch(e){this.inform(this.errorText(e),'error');}
    finally{this.busy=false;}
  }
  async chooseDesk():Promise<void>{this.jiraQueues=[];this.jiraQueueIssues=[];this.selectedQueue='';if(!this.selectedDesk)return;
    this.busy=true;try{this.jiraQueues=await this.api.call<typeof this.jiraQueues>('listJiraQueues',this.selectedDesk);}catch(e){this.inform(this.errorText(e),'error');}finally{this.busy=false;}
  }
  async chooseQueue(append=false):Promise<void>{if(!this.selectedQueue)return;this.busy=true;
    try{const res=await this.api.call<{issues:Array<{key:string;summary:string;status:string}>;next:number|null}>('listJiraQueueIssues',this.selectedDesk,this.selectedQueue,append?(this.queueNext||0):0);
      this.jiraQueueIssues=append?this.jiraQueueIssues.concat(res.issues):res.issues;this.queueNext=res.next;
    }catch(e){this.inform(this.errorText(e),'error');}
    finally{this.busy=false;}
  }
  async openJiraIssue(key:string):Promise<void>{const local=this.data?.tickets.find(t=>t.jira_ticket_no===key);
    if(local){await this.openTicket(local);return;}
    this.detailLoading=true;
    try{const res=await this.api.call<{ticket:Ticket;detail:JiraDetail}>('fetchJiraTicketByKey',key);this.selectedTicket=res.ticket;this.jiraDetail=res.detail;await this.loadBootstrapQuietly();}
    catch(e){this.inform(this.errorText(e),'error');}finally{this.detailLoading=false;}
  }
  async loadWorkbook():Promise<void>{if(this.role!=='admin')return;this.busy=true;
    try{this.workbook=await this.api.call<Workbook>('getReportingWorkbook',this.selectedTab||'',this.workbookPage,35);this.selectedTab=this.workbook.tab;}
    catch(e){this.inform(this.errorText(e),'error');}
    finally{this.busy=false;}
  }
  async selectTab(tab:string):Promise<void>{this.selectedTab=tab;this.workbookPage=1;this.cellEditor=null;await this.loadWorkbook();}
  async changePage(n:number):Promise<void>{if(n<1)return;this.workbookPage=n;await this.loadWorkbook();}
  beginEditCell(index:number,col:number):void{
    if(!this.workbook||index===0&&this.workbook.firstRow===1)return;
    const row=this.workbook.firstRow+index;
    this.cellEditor={row,col:col+1,value:this.workbook.rows[index]?.[col]||'',formula:this.workbook.formulas[index]?.[col]||''};
  }
  async saveCell():Promise<void>{if(!this.cellEditor||!this.workbook)return;
    if(this.cellEditor.formula&&!window.confirm('This cell contains a formula. Replace it with the entered value?'))return;
    const {row,col,value}=this.cellEditor;
    const ok=await this.task(()=>this.api.call('editReportingWorkbookCell',this.selectedTab,row,col,value),'Cell saved.');
    if(ok){this.cellEditor=null;await this.loadWorkbook();}
  }
  async insertRow():Promise<void>{if(!this.workbook)return;const after=Math.max(1,this.workbook.lastRow);
    const ok=await this.task(()=>this.api.call('insertReportingWorkbookRow',this.selectedTab,after),'Row inserted.');if(ok)await this.loadWorkbook();
  }
  async insertColumn():Promise<void>{if(!this.workbook||!this.newColName.trim())return;
    const totalColumns=this.workbook.totalColumns;const heading=this.newColName.trim();
    const ok=await this.task(()=>this.api.call('insertReportingWorkbookColumn',this.selectedTab,totalColumns,heading),'Column added.');if(ok){this.newColName='';await this.loadWorkbook();}
  }
}
