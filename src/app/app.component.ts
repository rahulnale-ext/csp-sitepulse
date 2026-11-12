import {Component, OnInit, OnDestroy} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ApiService} from './api.service';
import {PushService} from './push.service';
import {FirestoreChatService} from './firestore-chat.service';
import {NAV,LANGUAGES,tr,TextKey} from './i18n';
import type {Bootstrap, DirectMessage, LiveUpdates, JiraDetail, Lang, Notice, Report, ReportDraft, ReportLine, Resource, Role, Section, Staff, Ticket, Workbook} from './models';
import {environment} from './environment';

type SpeechEngine = {lang:string;continuous:boolean;interimResults:boolean;onresult:((event:{results:ArrayLike<{0:{transcript:string};isFinal:boolean}>;resultIndex:number})=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};

@Component({selector:'csp-root',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./app.component.html',styleUrl:'./app.component.css'})
export class AppComponent implements OnInit,OnDestroy {
  readonly languages=LANGUAGES;
  readonly nav=NAV;
  readonly title='CSP SitePulse';
  readonly todayIso=new Date().toISOString();
  readonly todayWorkDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
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
  search='';ticketStatus='all';supervisorFilter='all';locationFilter='all';ticketDateFilter='';resourceFilter='all';
  ticketGroupFilter='all';jiraAssignmentGroup='all'; bellOpen=false; selectedPeerId='';newMessage=''; sendingMessage=false; private readInFlight=false;
  isLiveSyncing=false; private liveTimer:ReturnType<typeof setInterval>|null=null;
  reportPreview=''; reportQuestions:string[]=[];followUpAnswer=''; reportResourceFields:Record<string,string>={};
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
  viewReport:Report|null=null;
  editResource:Partial<Resource>={type:'material',name:'',current_price:0,quantity:0,rate_unit:'unit'};
  effectiveRateDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata'}).format(new Date());rateSource='Market';rateNote='';
  newRateItemId='';newRatePrice:number|null=null;newRateDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata'}).format(new Date());newRateSource='Market';newRateNote='';
  selectedRateId=''; customRate:number|null=null;customRateNote='';

  editUser:Partial<Staff>={role:'supervisor',name:'',email:'',manager_id:''};
  workbook:Workbook|null=null;
  selectedTab=''; workbookPage=1;
  cellEditor:{row:number;col:number;value:string;formula:string}|null=null;
  newColName='';renameColIndex=1;renameColTitle='';
  profileDraft:Partial<Staff>={}; newEmailCode=''; emailChangePending=false;
  labels:Partial<Record<Section,string>>={};
  private lastAutoJiraSync=0;

  constructor(public readonly api:ApiService,private readonly push:PushService,public readonly chat:FirestoreChatService) {}
  ngOnInit():void {
    if (this.api.hasSession) void this.loadBootstrap(true);
    this.liveTimer=setInterval(()=>{if(document.visibilityState==='visible'&&this.data&&this.section!=='messages'&&!this.busy&&!this.isBooting)void this.refreshLive();},8000);
    window.addEventListener('focus',this.focusHandler);
    if ('serviceWorker' in navigator) {
      const register=()=>navigator.serviceWorker.register('firebase-messaging-sw.js',{scope:'./'}).catch(()=>{});
      if(document.readyState==='complete')void register();
      else window.addEventListener('load',()=>{void register();},{once:true});
    }
  }
  ngOnDestroy():void { this.recognition?.stop();if(this.liveTimer)clearInterval(this.liveTimer);void this.chat.disconnect();window.removeEventListener('focus',this.focusHandler); }
  private focusHandler=()=>{if(this.data)void this.refreshLive();};
  private readLang():Lang { const saved=localStorage.getItem('csp.lang');return (LANGUAGES.some(x=>x.code===saved)?saved:'en-IN') as Lang; }
  setLang(next:Lang):void {this.lang=next;localStorage.setItem('csp.lang',next);document.documentElement.lang=next.slice(0,2);}
  t(key:TextKey):string{return tr(this.lang,key);}
  navLabel(section:Section):string {return this.data?.menuLabels?.[section]||this.t(section);}
  get currentLanguageLabel():string{return LANGUAGES.find(l=>l.code===this.lang)?.label||'English';}
  itemUnit(id:string):string{return this.data?.items.find(i=>i.id===id)?.rate_unit||'unit';}
  get role():Role {return this.data?.user.role||'supervisor';}
  get visibleNav(){return this.nav.filter(n=>n.roles.includes(this.role));}
  get unreadMessages():number{return (this.data?.messages||[]).filter(m=>m.recipient_id===this.data?.user.id&&!m.read_at).length;}
  get unread():number{return this.data?.notifications.filter(n=>!n.read_at).length||0;}
  readonly supervisorNames=['Raju venkatesh','Murugesh Subbappa','Ayush','Guna','Balakrishanan','Kalai','Vasant','Prakash','Thangapandi','SURESH','KARTIKEYAN','KARTIK'];
  private normalizeName(v:unknown):string{return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
  private isCspSupervisorTicket(t:Ticket):boolean {
    if(t.project_key&&String(t.project_key).toUpperCase()!=='CIVIL')return false;
    const people=[t.jira_assignee,t.engineer_name];
    try {const named=JSON.parse(String(t.jira_assignees||'[]')); if(Array.isArray(named))people.push(...named.map((x:{name?:string})=>x.name||''));}catch(_){}
    const aliases:Record<string,string>={vasanthkongarayan:'vasant',vasanth:'vasant',balakrishnan:'balakrishanan',balakrishnanerusappan:'balakrishanan',kalaijarasanpanneerselvam:'kalai',karthikeyan:'kartikeyan',karthik:'kartik'};
    const allowed=new Set(this.supervisorNames.map(x=>this.normalizeName(x)));
    return people.some(x=>{const n=this.normalizeName(x);return allowed.has(aliases[n]||n);});
  }
  get cspTickets():Ticket[]{return (this.data?.tickets||[]).filter(t=>this.isCspSupervisorTicket(t));}
  get locations():string[]{return Array.from(new Set(this.cspTickets.map(t=>String(t.location||'').trim()).filter(Boolean))).sort();}
  get ticketGroups(){const all=this.cspTickets;return [
    {id:'all',name:'All tickets',count:all.length},
    {id:'new',name:'New',count:all.filter(t=>/new|ready to assign/i.test(t.status)).length},
    {id:'r&d',name:'R&D',count:all.filter(t=>/r&d|research/i.test(t.status)).length},
    {id:'design',name:'Design_Status-Wise',count:all.filter(t=>/design/i.test(t.status)).length},
    {id:'estimation',name:'Estimation_Status-Wise',count:all.filter(t=>/estimat/i.test(t.status)).length},
    {id:'execution',name:'Execution_Status-Wise',count:all.filter(t=>/execution|in progress|site inspection/i.test(t.status)).length}
  ];}
  get matchingTickets():Ticket[] {
    const q=this.search.trim().toLowerCase();return this.cspTickets.filter(t=>{
      const s=(String(t.status||'')+' '+String(t.assignment_status||'')).toLowerCase();
      const closed=/done|closed|resolved|completed|cancelled|canceled/.test(s);
      return (this.ticketStatus==='all'||(this.ticketStatus==='open'?!closed:closed)) &&
        (this.supervisorFilter==='all'||String(t.assigned_supervisor_id)===this.supervisorFilter) &&
        (this.jiraAssignmentGroup==='all'||String(t.jira_assignment_group||'')===this.jiraAssignmentGroup) &&
        (this.locationFilter==='all'||String(t.location||'')===this.locationFilter) &&
        (!this.ticketDateFilter||String(t.created||'').slice(0,10)===this.ticketDateFilter) &&
        (this.ticketGroupFilter==='all'||this.ticketGroupFilter==='new'&&/new|ready to assign/i.test(t.status)||this.ticketGroupFilter==='r&d'&&/r&d|research/i.test(t.status)||this.ticketGroupFilter==='design'&&/design/i.test(t.status)||this.ticketGroupFilter==='estimation'&&/estimat/i.test(t.status)||this.ticketGroupFilter==='execution'&&/execution|in progress|site inspection/i.test(t.status)) &&
        (!q||[t.jira_ticket_no,t.summary,t.location,t.department,t.engineer_name,t.status].some(v=>String(v||'').toLowerCase().includes(q)));
    });
  }
  get matchingReports():Report[] {return (this.data?.reports||[]).filter(r=>this.reportFilter==='all'||r.status===this.reportFilter);}
  get pendingReports():Report[] {return (this.data?.reports||[]).filter(r=>r.status==='pending');}
  get eligibleSupervisors():Staff[]{const list=(this.data?.users||[]).filter(u=>u.role==='supervisor'||(u.role==='lead'&&String(u.can_supervise)==='true'));const me=this.data?.user;return me&&(me.role==='supervisor'||(me.role==='lead'&&String(me.can_supervise)==='true'))&&!list.some(p=>p.id===me.id)?[me,...list]:list;}
  get leads():Staff[]{return (this.data?.users||[]).filter(u=>u.role==='lead');}
  get adminUsers():Staff[]{return this.data?.users||[];}
  get visibleMessages():DirectMessage[] {return (this.data?.messages||[]).filter(m=>(m.sender_id===this.selectedPeerId&&m.recipient_id===this.data?.user.id)||(m.recipient_id===this.selectedPeerId&&m.sender_id===this.data?.user.id));}
  get currentPeerName():string {return this.data?.contacts.find(c=>c.id===this.selectedPeerId)?.name||'Select a person';}
  get rateHistory(){return (this.data?.itemRates||[]).filter(r=>this.resourceFilter==='all'||r.category===this.resourceFilter).sort((a,b)=>String(b.effective_date||b.changed_at).localeCompare(String(a.effective_date||a.changed_at)));}
  rateStatus(r:import('./models').RateChange):string{const day=String(r.effective_date||r.changed_at).slice(0,10);if(day>this.todayWorkDate)return 'Future';const newest=this.rateOptions(r.item_id)[0];return newest?.id===r.id?'Current':'Previous';}
  rateOptions(itemId:string):import('./models').RateChange[]{const today=this.reportDraft.work_date||this.todayWorkDate;return (this.data?.itemRates||[]).filter(r=>r.item_id===itemId&&String(r.effective_date||r.changed_at||'').slice(0,10)<=today).sort((a,b)=>String(b.effective_date||b.changed_at).localeCompare(String(a.effective_date||a.changed_at)));}
  rateName(r:import('./models').RateChange):string{return this.fmtMoney(r.new_rate)+' / '+(r.rate_unit||'unit')+' • '+(r.effective_date||String(r.changed_at).slice(0,10))+(r.source?' • '+r.source:'');}
  rateForLine(line:ReportLine):string{if(line.rate_id){const rate=this.data?.itemRates.find(x=>x.id===line.rate_id);if(rate)return this.rateName(rate);}return line.rate_mode==='actual'?'Actual paid: '+this.fmtMoney(line.actual_rate||0):'Auto (current approved rate)';}
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
  fmtMoney(n:unknown):string {return new Intl.NumberFormat(this.lang,{style:'currency',currency:this.data?.currency||'INR',maximumFractionDigits:2}).format(Number(n)||0);}
  fmtDate(d:unknown):string {if(!d)return '—';const date=new Date(String(d));return Number.isNaN(date.getTime())?String(d):new Intl.DateTimeFormat(this.lang,{day:'numeric',month:'short',year:'numeric'}).format(date);}
  caps(s:unknown):string{return String(s||'—').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
  trackById(_index:number,item:{id?:string}):string{return item.id||String(_index);}
  private freshReport():ReportDraft {return {ticket_id:'',work_date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata'}).format(new Date()),work_done:'',completion_status:'in progress',work_measure:0,work_measure_unit:'',lines:[]};}
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
    await this.chat.disconnect();
    try {await this.api.call('logoutSession');} catch(_){}
    this.api.clearSession();this.data=null;this.section='overview';this.loginStep='email';this.isMobileMenuOpen=false;this.bellOpen=false;this.profileDraft={};this.inform('Signed out.','info');
  }
  async loadBootstrap(initial=false):Promise<void>{
    if(this.isBooting)return;this.isBooting=true;
    try {const data=await this.api.call<Bootstrap>('getBootstrap');
      if(!data.authorized){this.api.clearSession();this.data=null;throw new Error(data.message||'Your session has expired.');}
      this.data={...data,messages:this.chat.messages};this.labels={...data.menuLabels};this.profileDraft={...data.user};
      void this.connectFirestoreChat(data.user.id);
      if(!this.selectedPeerId&&data.contacts.length)this.selectedPeerId=data.contacts[0].id;
      if(!this.visibleNav.some(n=>n.section===this.section))this.section='overview';
      if(!initial)this.inform('Your workspace is up to date.','success');
    }catch(e){if(initial){this.api.clearSession();void this.chat.disconnect();}this.inform(this.errorText(e),'error');}
    finally{this.isBooting=false;}
  }
  private errorText(e:unknown):string{return e instanceof Error?e.message:'The request could not be completed.';}
  async refreshLive():Promise<void>{
    if(this.isLiveSyncing||!this.api.hasSession||!this.data)return;this.isLiveSyncing=true;
    try{const fresh=await this.api.call<LiveUpdates>('getLiveUpdates');
      if(this.data){this.data={...this.data,tickets:fresh.tickets,reports:fresh.reports,notifications:fresh.notifications,items:fresh.items,contacts:fresh.contacts,itemRates:fresh.itemRates};}
      if(this.section==='messages')void this.markConversationRead();
    }catch(_){/* Do not display transient polling errors; explicit Refresh reports them. */}
    finally{this.isLiveSyncing=false;}
  }
  private async connectFirestoreChat(uid:string):Promise<void>{
    try {
      await this.chat.connect(uid,messages=>{
        if(!this.data||this.data.user.id!==uid)return;
        this.data={...this.data,messages};
        if(this.section==='messages' && this.selectedPeerId)void this.markConversationRead();
      },error=>this.inform(error,'error'));
    }catch(e){this.inform('Firestore messaging unavailable: '+this.errorText(e),'error');}
  }
  async refreshChats():Promise<void>{
    // Firestore onSnapshot keeps the full conversation state up to date without polling.
    if(this.section==='messages')await this.markConversationRead();
  }
  async task(operation:()=>Promise<unknown>,success='Updated successfully.'):Promise<boolean>{
    if(this.busy)return false;this.busy=true;
    try {await operation();await this.loadBootstrapQuietly();if(success)this.inform(success,'success');return true;}
    catch(e){this.inform(this.errorText(e),'error');return false;}
    finally{this.busy=false;}
  }
  private async loadBootstrapQuietly():Promise<void> {const data=await this.api.call<Bootstrap>('getBootstrap');if(!data.authorized)throw new Error(data.message||'Session expired.');this.data={...data,messages:this.chat.messages};this.labels={...data.menuLabels};if(!this.profileDraft.id)this.profileDraft={...data.user};}
  go(section:Section):void {
    if(!this.visibleNav.some(n=>n.section===section)){this.inform(this.t('noPermission'),'error');return;}
    this.section=section;this.isMobileMenuOpen=false;this.search='';
    if(section==='workbook'&&!this.workbook)void this.loadWorkbook();
    if(section==='jira'&&!this.jiraDesks.length&&this.data?.jiraReady)void this.loadJiraDesks();
    if(section==='messages'&&this.selectedPeerId){void this.markConversationRead();void this.refreshChats();}
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
    const ok=await this.task(()=>this.api.call('assignTicket',ticket.id,id),'Ticket assigned.');
    if(ok&&this.selectedTicket?.id===ticket.id)this.selectedTicket=this.data?.tickets.find(t=>t.id===ticket.id)||null;
  }
  async setLead(ticket:Ticket,leadId:string):Promise<void>{await this.task(()=>this.api.call('saveTicketLead',ticket.id,leadId),'Reviewing lead updated.');}
  async setPriority(ticket:Ticket,value:string):Promise<void>{if(!value)return;await this.task(()=>this.api.call('setTicketPriority',ticket.id,Number(value)),'Priority updated.');}
  async returnAssigned(ticket:Ticket):Promise<void>{const note=window.prompt('Reason for returning this ticket?');if(!note?.trim())return;await this.task(()=>this.api.call('returnTicket',ticket.id,note.trim()),'Ticket returned.');}
  addLine():void{if(!this.selectedItemId||!Number.isFinite(Number(this.newItemQty))||Number(this.newItemQty)<=0){this.inform('Select a resource and enter a positive quantity.','error');return;}
    if(this.customRate!==null&&(!this.customRateNote.trim()||this.customRate<0)){this.inform('For an actual purchase rate, enter a non-negative price and receipt or vendor reference.','error');return;}
    const existing=this.reportDraft.lines.find(l=>l.item_id===this.selectedItemId&&l.rate_id===(this.selectedRateId||'')&&l.rate_mode===(this.customRate!==null?'actual':'catalog')&&(this.customRate===null||l.actual_rate===this.customRate));
    if(existing)existing.quantity+=Number(this.newItemQty); else this.reportDraft.lines.push({item_id:this.selectedItemId,quantity:Number(this.newItemQty),rate_id:this.selectedRateId||'',rate_mode:this.customRate!==null?'actual':'catalog',actual_rate:this.customRate===null?undefined:Number(this.customRate),rate_note:this.customRateNote});
    this.selectedItemId='';this.selectedRateId='';this.customRate=null;this.customRateNote='';this.newItemQty=1;this.verifiedDraft=false;
  }
  selectResource(itemId:string):void{this.selectedItemId=itemId;this.selectedRateId='';this.customRate=null;this.customRateNote='';}
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
    if(!this.reportDraft.ticket_id){this.inform('Select your assigned Jira ticket first.','error');return;}
    this.busy=true;
    try{const parsed=await this.api.call<{reportText:string;questions:string[];resources:Record<string,string>;work_done:string;completion_status:string;work_measure:number;work_measure_unit:string;lines:{item_id:string;quantity:number}[];mode?:string;warning?:string}>('interpretWorkVoice',this.voiceTranscript,this.lang,this.reportDraft.ticket_id,this.reportDraft.work_date);
      this.reportDraft.work_done=parsed.work_done;this.reportDraft.work_measure=parsed.work_measure;this.reportDraft.work_measure_unit=parsed.work_measure_unit;
      this.reportDraft.completion_status=parsed.completion_status;this.reportDraft.lines=parsed.lines.map(l=>({...l,rate_id:'',rate_mode:'catalog'}));
      this.reportQuestions=parsed.questions||[];this.reportResourceFields=parsed.resources||{};this.reportPreview=parsed.reportText;
      this.verifiedDraft=false;this.inform(parsed.warning|| (this.reportQuestions.length?'Please answer the important missing questions.':'Draft generated. Check every quantity.'),'info');
    }catch(e){this.inform(this.errorText(e),'error');}
    finally{this.busy=false;}
  }
  async submitDraft():Promise<void>{
    if(!this.verifiedDraft){this.inform('Verify the report and quantities before submitting.','error');return;}
    if(!this.reportDraft.ticket_id||!this.reportDraft.work_done.trim()||this.reportQuestions.length||this.reportDraft.lines.some(l=>!Number.isFinite(Number(l.quantity))||Number(l.quantity)<=0)){
      this.inform('Choose a ticket, answer any follow-up questions, and check the work description and quantities.','error');return;}
    const draft={...this.reportDraft,daily_report_text:this.dailyReportPreview,lines:this.reportDraft.lines.map(x=>({...x,quantity:Number(x.quantity)}))};
    const success=await this.task(()=>this.revisionFor?this.api.call('reviseReport',this.revisionFor.id,draft):this.api.call('submitReport',draft),this.revisionFor?'Revision submitted.':'Report sent for approval.');
    if(success){this.reportDraft=this.freshReport();this.voiceTranscript='';this.reportPreview='';this.reportQuestions=[];this.revisionFor=null;this.verifiedDraft=false;this.go('reports');}
  }
  editRevision(report:Report):void {
    this.revisionFor=report;this.reportDraft={ticket_id:report.ticket_id,work_date:report.work_date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata'}).format(new Date()),work_done:report.work_done,completion_status:report.completion_status,work_measure:report.work_measure,work_measure_unit:report.work_measure_unit,lines:report.lines.map(l=>({id:l.id,item_id:l.item_id,quantity:l.quantity,rate_id:l.rate_id,rate_mode:l.rate_mode,actual_rate:l.locked_price,rate_note:l.rate_note}))};this.reportQuestions=[];this.reportResourceFields={};
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
    if(edits.some(e=>!e.id||!Number.isFinite(e.quantity)||e.quantity<0)||(edits.length>0&&!edits.some(e=>e.quantity>0))){this.inform('Confirm every line quantity; at least one must be positive.','error');return;}
    const ok=await this.task(()=>this.api.call('reviewReport',report.id,'approved',edits),'Report approved.');if(ok)this.closeReview();
  }
  async rejectReport():Promise<void>{if(!this.reviewFor)return;const report=this.reviewFor;
    if(!this.revisionComment.trim()){this.inform('Enter revision instructions.','error');return;}
    const ok=await this.task(()=>this.api.call('requestRevision',report.id,this.revisionComment.trim()),'Revision requested.');if(ok)this.closeReview();
  }
  editPerson(p?:Staff):void{this.editUser=p?{...p}:{role:'supervisor',name:'',email:'',manager_id:'',account_status:'pending'};}
  async savePerson():Promise<void>{const ok=await this.task(()=>this.api.call('saveUser',this.editUser),'Person saved.');if(ok)this.editPerson();}
  async removePerson(u:Staff):Promise<void>{if(!window.confirm(`Remove ${u.name}? This action cannot be undone.`))return;await this.task(()=>this.api.call('deleteUser',u.id),'Person removed.');}
  editItem(item?:Resource):void{this.editResource=item?{...item}:{type:'material',name:'',current_price:0,quantity:0,rate_unit:'unit'};}
  async saveItem():Promise<void>{const ok=await this.task(()=>this.api.call('saveMasterItem',this.editResource),'Resource saved.');if(ok)this.editItem();}
  async removeItem(item:Resource):Promise<void>{if(!window.confirm(`Remove ${item.name}?`))return;await this.task(()=>this.api.call('deleteMasterItem',item.id),'Resource removed.');}
  async seedItems():Promise<void>{await this.task(()=>this.api.call('seedLegacyCspItems'),'Default resource names added where missing.');}
  async seedRoster():Promise<void>{await this.task(()=>this.api.call('syncCspRoster'),'Supervisor roster updated. Verify emails and reporting leads.');}
  async markRead(notice:Notice):Promise<void>{if(notice.read_at)return;await this.task(()=>this.api.call('markNotificationRead',notice.id),'');}
  async enablePush():Promise<void>{this.busy=true;try{await this.push.enable((_title,_body)=>{void this.refreshLive();});this.inform('This device is ready to receive notifications.','success');}catch(e){this.inform(this.errorText(e),'error');}finally{this.busy=false;}}
  async testPush():Promise<void>{await this.task(()=>this.api.call('sendPushTest'),'Test notification requested.');}
  async saveLabels():Promise<void>{await this.task(()=>this.api.call('saveMenuLabels',this.labels),'Menu names updated for all users.');}
  async testJira():Promise<void>{this.busy=true;try{const result=await this.api.call<unknown>('testJiraConnection');this.inform('Jira connection verified. '+JSON.stringify(result),'success');}catch(e){this.inform(this.errorText(e),'error');}finally{this.busy=false;}}
  async loadJiraDesks():Promise<void>{if(!this.data?.jiraReady)return;this.busy=true;
    try{this.jiraDesks=(await this.api.call<typeof this.jiraDesks>('listJiraServiceDesks')).filter(d=>d.projectKey.toUpperCase()==='CIVIL'||/civil/i.test(d.name));
      const civil=this.jiraDesks[0];if(civil&&civil.id!==this.selectedDesk){this.selectedDesk=civil.id;void this.chooseDesk();}}
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
  answerFollowUp():void {
    if(!this.followUpAnswer.trim())return;
    this.voiceTranscript+='\nFollow-up answer: '+this.followUpAnswer.trim();
    this.followUpAnswer='';this.reportQuestions=[];this.reportPreview='';this.verifiedDraft=false;
    void this.analyzeVoice();
  }
  reportField(label:string):string{
    const lines=this.reportDraft.lines.filter(l=>this.itemName(l.item_id).toLowerCase()===label.toLowerCase());
    if(lines.length)return String(lines.reduce((total,l)=>total+Number(l.quantity),0))+' '+this.itemUnit(lines[0].item_id);
    return this.reportResourceFields[label]||'Not Used';
  }
  get dailyReportPreview():string{
    const t=this.data?.tickets.find(t=>t.id===this.reportDraft.ticket_id);
    const sections:[string,string[]][]=[['Labours',['Masons','Helpers','FC','Etc']],['Materials Used',['Cement Bags','M Sand','P Sand','Jelly/Chips','Bricks','Solid Blocks','Tiles','Other Materials']],['Equipment Used',['Tractor','Crane','JCB','Scaffolding','Other Equipment']]];
    const date=this.reportDraft.work_date?this.reportDraft.work_date.split('-').reverse().join('/') : new Date().toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata'});
    const lines=['DAILY SITE REPORT','Ticket No: '+(t?.jira_ticket_no||'Not Applicable'),'Work Date: '+date,
      'Project Location: '+(t?.location||'Not Applicable'),'Supervisor name: '+(this.data?.user.name||'Not Applicable'),
      'Work Done:',this.reportDraft.work_done||'Not Applicable',''];
    for(const [heading,fields] of sections){lines.push(heading);for(const field of fields)lines.push(field+': '+this.reportField(field));lines.push('');}
    const status=this.reportDraft.completion_status;
    lines.push('Work Completion Status',status==='completed'?'Completed':status==='partially completed'?'Partially Completed':'In Progress');
    return lines.join('\n');
  }
  toggleBell():void {this.bellOpen=!this.bellOpen;}
  async selectPeer(id:string):Promise<void>{this.selectedPeerId=id;await this.markConversationRead();void this.refreshChats();}
  private async markConversationRead():Promise<void>{
    if(!this.selectedPeerId||!this.data||this.section!=='messages'||this.readInFlight||!this.chat.connected)return;
    const peerId=this.selectedPeerId,me=this.data.user.id,stamp=new Date().toISOString();
    const unread=this.data.messages.filter(m=>m.sender_id===peerId&&m.recipient_id===me&&!m.read_at&&!m.pending);
    if(!unread.length)return;
    // Clear the unread badge optimistically; the Firestore snapshot is the final source of truth.
    const seen=new Set(unread.map(m=>m.id));
    this.data={...this.data,
      messages:this.data.messages.map(m=>seen.has(m.id)?{...m,read_at:stamp}:m),
      notifications:this.data.notifications.map(n=>n.type==='direct_message'&&n.actor_id===peerId?{...n,read_at:stamp}:n)};
    this.readInFlight=true;
    let success=false;
    try{await this.chat.markRead(peerId);success=true;
      void this.api.call('markFirestoreNotificationsRead',peerId).catch(()=>{});
    }catch(e){this.inform('Unable to mark messages as read: '+this.errorText(e),'error');}
    finally{this.readInFlight=false;
      if(success && this.section==='messages' && this.selectedPeerId===peerId &&
         this.chat.messages.some(m=>m.sender_id===peerId&&m.recipient_id===me&&!m.read_at&&!m.pending))
        void this.markConversationRead();
    }
  }
  async sendMessage():Promise<void>{
    if(this.sendingMessage||!this.data||!this.selectedPeerId||!this.newMessage.trim())return;
    const body=this.newMessage.trim(),to=this.selectedPeerId;
    if(!this.data.contacts.some(c=>c.id===to)){this.inform('Choose an active staff contact.','error');return;}
    this.newMessage='';this.sendingMessage=true;
    try{
      // Local Firestore snapshots immediately display the message, before the server acknowledges it.
      const id=await this.chat.send(to,body);
      // Background push is best-effort and does not delay the chat UI.
      void this.api.call('notifyFirestoreMessage',to,id).catch(e=>console.warn('Message push unavailable:',this.errorText(e)));
    }catch(e){this.newMessage=body;this.inform('Message not sent: '+this.errorText(e),'error');}
    finally{this.sendingMessage=false;}
  }
  async importOldChatHistory():Promise<void>{
    if(this.role!=='admin'||this.busy)return;
    if(!window.confirm('Copy old Direct_Messages spreadsheet records into Firestore? Existing spreadsheet records will not be deleted.'))return;
    this.busy=true;
    try{
      let next=0,total=0,imported=0,skipped=0;
      do{
        const result=await this.api.call<{total:number;nextOffset:number;imported:number;skipped:number}>('migrateLegacyMessagesToFirestore',next);
        total=result.total;imported+=result.imported;skipped+=result.skipped;next=result.nextOffset;
      }while(next<total);
      this.inform(`Historical message import finished: ${imported} imported, ${skipped} already present or skipped.`,'success');
    }catch(e){this.inform('Message import stopped: '+this.errorText(e),'error');}
    finally{this.busy=false;}
  }
  async addRate():Promise<void>{
    if(!this.newRateItemId||this.newRatePrice===null||Number(this.newRatePrice)<0||!this.newRateDate){this.inform('Select an item, date and non-negative rate.','error');return;}
    const ok=await this.task(()=>this.api.call('addItemRate',this.newRateItemId,this.newRatePrice,this.newRateDate,this.newRateSource,this.newRateNote),'Dated rate recorded; earlier rates remain unchanged.');
    if(ok){this.newRatePrice=null;this.newRateNote='';}
  }
  async saveProfile():Promise<void>{
    if(String(this.profileDraft.email||'').toLowerCase()!==String(this.data?.user.email||'').toLowerCase()){
      this.inform('Confirm the new email using its verification code first.','error');return;
    }
    const ok=await this.task(()=>this.api.call('saveMyProfile',this.profileDraft),'Profile saved to your spreadsheet.');
    if(ok&&this.data)this.profileDraft={...this.data.user};
  }
  async requestEmailChange():Promise<void>{
    if(!this.profileDraft.email||this.profileDraft.email===this.data?.user.email)return;
    this.emailChangePending=await this.task(()=>this.api.call('requestProfileEmailChange',this.profileDraft.email),'Verification code sent to your new email address.');
  }
  async confirmEmailChange():Promise<void>{
    const ok=await this.task(()=>this.api.call('confirmProfileEmailChange',this.profileDraft.email,this.newEmailCode),'Email verified and updated.');
    if(ok){this.emailChangePending=false;this.newEmailCode='';if(this.data)this.profileDraft={...this.data.user};}
  }
  onProfileFile(event:Event):void{
    const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;
    if(!['image/png','image/jpeg'].includes(file.type)){this.inform('Choose a JPEG or PNG picture.','error');return;}
    const reader=new FileReader();reader.onload=()=>{
      const img=new Image();img.onload=()=>{
        const canvas=document.createElement('canvas');canvas.width=112;canvas.height=112;
        const ctx=canvas.getContext('2d');if(!ctx)return;
        const size=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-size)/2,(img.height-size)/2,size,size,0,0,112,112);
        const jpeg=canvas.toDataURL('image/jpeg',0.65);
        if(jpeg.length>28000){this.inform('Image too large. Try a smaller image.','error');return;}
        this.profileDraft.photo_data=jpeg;
      };img.src=String(reader.result||'');
    };reader.readAsDataURL(file);
  }
  async importScreenshotRoster():Promise<void>{
    if(!window.confirm('Create pending staff profiles from the supplied roster? You must review all names and reporting leads before activation.'))return;
    await this.task(()=>this.api.call('importScreenshotStaffProfiles'),'Staff imported as pending. Review and activate individually.');
  }
  async renameWorkbookHeader():Promise<void>{
    if(!this.renameColTitle.trim()||!this.workbook)return;
    const ok=await this.task(()=>this.api.call('renameReportingWorkbookColumn',this.selectedTab,Number(this.renameColIndex),this.renameColTitle.trim()),'Workbook column renamed.');
    if(ok){this.renameColTitle='';await this.loadWorkbook();}
  }
  ratePrevious(itemId:string):number|string {
    const rates=(this.data?.itemRates||[]).filter(r=>r.item_id===itemId);
    const past=rates.filter(r=>String(r.effective_date||r.changed_at).slice(0,10)<=this.todayWorkDate).sort((a,b)=>String(b.effective_date||b.changed_at).localeCompare(String(a.effective_date||a.changed_at)));return past.length>1?Number(past[1].new_rate):past.length?past[0].old_rate:'—';
  }

  countForSupervisor(id:string):number{return this.cspTickets.filter(t=>t.assigned_supervisor_id===id&&(this.jiraAssignmentGroup==='all'||t.jira_assignment_group===this.jiraAssignmentGroup)).length;}
  unreadFrom(id:string):boolean{return !!this.data?.messages.some(m=>m.sender_id===id&&m.recipient_id===this.data?.user.id&&!m.read_at);}
  fmtTime(value:string):string{const d=new Date(value);return Number.isNaN(d.valueOf())?value:new Intl.DateTimeFormat(this.lang,{dateStyle:'short',timeStyle:'short'}).format(d);}
  async copyDailyReport():Promise<void>{
    try{await navigator.clipboard.writeText(this.dailyReportPreview);this.inform('Daily report copied.','success');}
    catch(_){this.inform('Clipboard unavailable; select and copy the preview text manually.','error');}
  }

}
