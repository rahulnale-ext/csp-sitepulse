import React,{useEffect,useState} from 'react';
import {useForm} from 'react-hook-form';
import {useSite} from '../lib/site-context';
import type {Role,Staff} from '../lib/models';
import {cap} from '../lib/format';
interface PersonForm {id?:string;role:Role;name:string;email:string;manager_id:string;can_supervise:boolean;acting_lead_id:string;mobile_number:string;birth_date?:string;photo_data?:string;account_status:'active'|'pending'}
const fresh=():PersonForm=>({role:'supervisor',name:'',email:'',manager_id:'',can_supervise:true,acting_lead_id:'',mobile_number:'',account_status:'pending'});
export default function People(){
  const {data,mutation,busy,notify}=useSite();const form=useForm<PersonForm>({defaultValues:fresh()});const role=form.watch('role');
  const [editing,setEditing]=useState(false),[query,setQuery]=useState('');
  if(!data)return null;
  const persons=data.users.filter(u=>[u.name,u.email,u.role].join(' ').toLowerCase().includes(query.toLowerCase()));
  const admins=data.users.filter(u=>u.role==='admin');const leads=data.users.filter(u=>u.role==='lead');
  const open=(u?:Staff)=>{
    const values:PersonForm=u?{
      id:u.id,role:u.role,name:u.name,email:u.email||'',
      manager_id:u.manager_id||'',can_supervise:String(u.can_supervise)==='true',
      acting_lead_id:u.acting_lead_id||'',mobile_number:u.mobile_number||'',
      birth_date:u.birth_date||'',photo_data:u.photo_data||'',
      account_status:u.account_status==='pending'?'pending':'active'
    }:fresh();
    form.reset(values);setEditing(true);
  };
  const save=async(v:PersonForm)=>{
    try{await mutation('saveUser',[v],v.id?'Staff record saved.':'Staff member created.');setEditing(false);}catch(_){}}
  async function remove(u:Staff){if(!window.confirm('Delete this staff record? This may be blocked if they have ticket or report history.'))return;
    try{await mutation('deleteUser',[u.id],'Staff record deleted.');}catch(_){}}
  return <div className="fade-in"><section className="panel"><div className="panel-head"><div><p className="eyebrow">STAFF ACCESS</p><h3>People and roles</h3></div><button className="btn primary small" onClick={()=>open()}>+ Add person</button></div>
    <div className="compact-filters"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find person, email, or role" aria-label="Search staff"/></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Reporting lead</th><th>Account</th><th>Actions</th></tr></thead><tbody>{persons.map(u=><tr key={u.id}><td>{u.name}</td><td>{u.email||'Pending email'}</td><td>{cap(u.role)}</td><td>{data.users.find(x=>x.id===u.manager_id)?.name||'-'}</td><td><span className={'pill '+(u.account_status==='pending'?'warning':'ok')}>{u.account_status||'active'}</span></td><td><button className="btn ghost small" onClick={()=>open(u)}>Edit</button> <button className="btn ghost small" disabled={busy} onClick={()=>void remove(u)}>Remove</button></td></tr>)}</tbody></table></div>
    <div className="inset"><p className="tiny-muted">Jira display-name aliases are used for ticket identity matching. Staff names and emails are not automatically renamed.</p></div></section>
    {editing&&<div className="modal-backdrop" onMouseDown={()=>setEditing(false)}><section className="ticket-modal panel people-modal" role="dialog" aria-modal="true" aria-label="Edit staff" onMouseDown={e=>e.stopPropagation()}><div className="panel-head"><h3>{form.getValues('id')?'Edit staff':'Add staff'}</h3><button className="btn-icon" onClick={()=>setEditing(false)}>X</button></div><form onSubmit={form.handleSubmit(save)} className="ticket-modal-body"><div className="form-grid">
      <label className="form-field"><span>Name</span><input maxLength={100} {...form.register('name',{required:true})}/></label>
      <label className="form-field"><span>Email (leave blank for inactive placeholder)</span><input type="email" {...form.register('email')}/></label>
      <label className="form-field"><span>Role</span><select {...form.register('role')}><option value="supervisor">Supervisor</option><option value="lead">Lead</option><option value="admin">Admin</option></select></label>
      <label className="form-field"><span>Reporting to</span><select {...form.register('manager_id')}><option value="">Select...</option>{(role==='supervisor'?leads:role==='lead'?admins:[]).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="form-field"><span>Mobile</span><input {...form.register('mobile_number')}/></label>
      <label className="form-field"><span>Account status</span><select {...form.register('account_status')}><option value="pending">Pending</option><option value="active">Active</option></select></label>
      {role==='lead'&&<label className="form-field"><span>Can also supervise</span><input type="checkbox" {...form.register('can_supervise')}/></label>}
      {role==='lead'&&<label className="form-field"><span>Separate approving lead (if supervising)</span><select {...form.register('acting_lead_id')}><option value="">Select...</option>{leads.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
    </div><button className="btn primary full" disabled={busy}>Save staff record</button></form></section></div>}
  </div>;
}
