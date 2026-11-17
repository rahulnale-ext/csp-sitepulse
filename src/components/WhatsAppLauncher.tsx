import React,{useEffect,useMemo,useState} from 'react';
import {MessageCircle,Search,X,ExternalLink} from 'lucide-react';
import {useSite} from '../lib/site-context';
import type {Contact} from '../lib/models';

/** Click-to-chat links open WhatsApp; no messages or phone books are stored in SitePulse. */
export function whatsappNumber(raw:string):string {
  let value=String(raw||'').replace(/[^0-9]/g,'');
  if(value.startsWith('00'))value=value.slice(2);
  if(value.length===11&&value.startsWith('0'))value=value.slice(1);
  if(value.length===10)value='91'+value;
  return /^\d{11,15}$/.test(value)?value:'';
}
export default function WhatsAppLauncher(){
  const {data}=useSite();
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [message,setMessage]=useState('');
  const [scrolling,setScrolling]=useState(false);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const onScroll=()=>{setScrolling(true);if(timer)clearTimeout(timer);timer=setTimeout(()=>setScrolling(false),650);};
    window.addEventListener('scroll',onScroll,true);
    return()=>{window.removeEventListener('scroll',onScroll,true);if(timer)clearTimeout(timer);};
  },[]);
  useEffect(()=>{if(!data)setOpen(false);},[data]);
  const contacts=useMemo(()=>{
    if(!data)return [] as Contact[];
    const all=data.whatsappContacts||[];
    const list=all.filter(person=>{
      if(person.id===data.user.id||!whatsappNumber(person.mobile_number||''))return false;
      if(data.user.role!=='supervisor')return true;
      return person.role==='admin'||(person.role==='lead'&&(person.id===data.user.manager_id||person.id===data.user.acting_lead_id||data.whatsappContacts?.some(contact=>contact.id===person.id&&contact.role==='lead')));
    });
    return list.filter(person=>(person.name+' '+person.role).toLowerCase().includes(search.toLowerCase().trim()))
      .sort((a,b)=>a.name.localeCompare(b.name));
  },[data,search]);
  if(!data)return null;
  return <div className={'wa-launcher'+(scrolling&&!open?' wa-scrolling':'')}>
    {open&&<section className="wa-panel" role="dialog" aria-label="WhatsApp staff directory">
      <div className="wa-head"><div><strong>WhatsApp contacts</strong><small>{data.user.role==='supervisor'?'Your lead and administrators':'Approved staff directory'}</small></div><button className="btn-icon" aria-label="Close WhatsApp contacts" onClick={()=>setOpen(false)}><X size={16}/></button></div>
      <label className="wa-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a colleague" aria-label="Search WhatsApp contacts"/></label>
      <label className="wa-message"><span>Message (optional)</span><textarea rows={2} maxLength={500} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Type a message to pre-fill in WhatsApp"/></label>
      <div className="wa-list">{contacts.map(person=>{
        const phone=whatsappNumber(person.mobile_number||'');
        const url='https://wa.me/'+phone+(message.trim()?'?text='+encodeURIComponent(message.trim()):'');
        return <a className="wa-person" key={person.id} href={url} target="_blank" rel="noopener noreferrer" onClick={()=>setOpen(false)}><span className="wa-person-avatar">{person.name.slice(0,1).toUpperCase()}</span><span className="wa-person-name"><b>{person.name}</b><small>{person.role}</small></span><ExternalLink size={15}/></a>;
      })}{!contacts.length&&<p className="wa-empty">No available WhatsApp contacts. Ask Admin to check staff mobile numbers and reporting leads.</p>}</div>
      <small className="wa-foot">Opens WhatsApp. You choose when to send the message.</small>
    </section>}
    <button type="button" className="wa-trigger" aria-label="Open WhatsApp staff directory" aria-expanded={open} onClick={()=>setOpen(x=>!x)}><MessageCircle size={22} strokeWidth={2}/><span>WhatsApp</span></button>
  </div>;
}
