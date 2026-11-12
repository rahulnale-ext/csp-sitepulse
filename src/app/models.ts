export type Role = 'admin' | 'lead' | 'supervisor';
export type Section = 'overview' | 'tickets' | 'reports' | 'review' | 'team' | 'inventory' | 'jira' | 'workbook' | 'notifications' | 'messages' | 'settings';
export type Lang = 'en-IN' | 'ta-IN' | 'kn-IN' | 'te-IN' | 'bn-IN' | 'mr-IN' | 'hi-IN' | 'ml-IN';
export interface Staff {id:string;role:Role;name:string;email:string;manager_id?:string;can_supervise?:boolean|string;acting_lead_id?:string;mobile_number?:string;birth_date?:string;photo_data?:string;account_status?:'active'|'pending'|''}
export interface Ticket {
  id:string;jira_ticket_no:string;summary:string;location:string;status:string;department?:string;project_key?:string;
  sub_department?:string;engineer_name?:string;assigned_supervisor_id?:string;assignment_status?:string;
  lead_id?:string;priority_sequence?:number|string;created?:string;contact_number?:string;request_type?:string;
  sub_request_type?:string;design_needed?:string;reporter?:string;jira_assignee?:string;jira_assignees?:string;jira_assignment_group?:string;
  issue_links_json?:string;budget_details?:string;[key:string]:unknown;
}
export interface DirectMessage {id:string;sender_id:string;recipient_id:string;body:string;created_at:string;read_at?:string;pending?:boolean}
export interface RateChange {id:string;item_id:string;category:string;old_rate:number|string;new_rate:number;rate_unit:string;changed_at:string;changed_by:string;effective_date?:string;source?:string;note?:string}
export interface Contact {id:string;name:string;role:Role}
export interface LiveUpdates {tickets:Ticket[];reports:Report[];notifications:Notice[];messages:DirectMessage[];items:Resource[];contacts:Contact[];itemRates:RateChange[]}
export interface Resource {id:string;type:string;name:string;current_price?:number;quantity?:number;rate_unit?:string}
export interface ReportLine {id?:string;item_id:string;item_name?:string;type?:string;quantity:number;rate_unit?:string;locked_price?:number;line_total?:number;rate_id?:string;rate_mode?:string;actual_rate?:number;rate_date?:string;rate_source?:string;rate_note?:string}
export interface Report {id:string;ticket_id:string;supervisor_id:string;ticket_no:string;location:string;supervisor_name:string;date:string;work_date?:string;work_done:string;source_transcript?:string;source_language?:string;daily_report_text?:string;completion_status:string;status:string;revision_note:string;revision_count:number;work_measure:number;work_measure_unit:string;lines:ReportLine[];amount_of_work?:number}
export interface Notice {id:string;type:string;title:string;body:string;created_at:string;read_at?:string;target_kind?:string;target_id?:string;actor_id?:string}
export interface Bootstrap {authorized:boolean;message?:string;user:Staff;users:Staff[];tickets:Ticket[];items:Resource[];reports:Report[];notifications:Notice[];messages:DirectMessage[];contacts:Contact[];itemRates:RateChange[];leadRules:unknown[];jiraReady:boolean;reportingWorkbookReady:boolean;jiraBaseUrl:string;jiraDefaultProject:string;aiEnabled:boolean;jiraAssignmentFieldsReady:boolean;currency:string;menuLabels:Partial<Record<Section,string>>}
export interface JiraDetail {key:string;summary:string;description:string;status:string;priority:string;reporter:string;assignee:string;created:string;updated:string;links:Array<{key:string;relationship:string;summary:string;status:string;priority:string;assignee:string}>;properties:Array<{key:string;label:string;value:string}>;comments:Array<{author:string;created:string;body:string}>;budget:Array<{author:string;created:string;body:string}>}
export interface Workbook {tab:string;tabs:string[];page:number;pageSize:number;totalRows:number;totalColumns:number;firstRow:number;lastRow:number;headers:string[];headerColors:string[];rows:string[][];formulas:string[][];colors:string[][];url:string}
export interface ApiResult<T> {ok:boolean;result:T;error?:string}
export interface LineDraft {id?:string;item_id:string;quantity:number;rate_id?:string;rate_mode?:string;actual_rate?:number;rate_note?:string}
export interface ReportDraft {ticket_id:string;work_date?:string;work_done:string;completion_status:string;work_measure:number;work_measure_unit:string;lines:LineDraft[]}
