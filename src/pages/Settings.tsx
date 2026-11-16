import React,{useEffect,useState} from 'react';
import {useForm} from 'react-hook-form';
import {useNavigate} from 'react-router-dom';
import {useSite} from '../lib/site-context';
import {LANGUAGES,NAV,tr} from '../lib/i18n';
import type {Section,Staff} from '../lib/models';
export default function Settings(){
  const {data,mutation,request,busy,notify,signOut,lang,setLang}=useSite();const navigate=useNavigate();
  const [emailCode,setEmailCode]=useState(''),[emailPending,setEmailPending]=useState(false),[labels,setLabels]=useState<Partial<Record<Section,string>>>({}),[phone,setPhone]=useState('');
  const form=useForm<Partial<Staff>>({defaultValues:{}});
  useEffect(()=>{if(data){form.reset({...data.user});setLabels({...data.menuLabels});}},[data?.user.id]);
  if(!data)return null;
  const phoneDigits=phone.replace(/\D/g,'');const whatsappDigits=phoneDigits.length===10?'91'+phoneDigits:phoneDigits;
  const whatsapp=whatsappDigits.length>=11&&whatsappDigits.length<=15?'https://wa.me/'+whatsappDigits:'';
  async function saveProfile(values:Partial<Staff>){if((values.email||'').toLowerCase()!==data?.user.email.toLowerCase()){notify('Verify the new email address before saving other changes.','error');return;}
    try{await mutation('saveMyProfile',[values],'Profile saved to the operations spreadsheet.');}catch(_){}}
  async function requestNewEmail(){const next=form.getValues('email');if(!next||next===data?.user.email)return;
    try{await mutation('requestProfileEmailChange',[next],'Verification code sent to the new email.');setEmailPending(true);}catch(_){}}
  async function confirmNewEmail(){const next=form.getValues('email');try{await mutation('confirmProfileEmailChange',[next,emailCode],'Email address verified and updated.');setEmailPending(false);setEmailCode('');}catch(_){}}
  async function saveLabels(){try{await mutation('saveMenuLabels',[labels],'Menu labels updated.');}catch(_){}}
  async function logout(){await signOut();navigate('/overview');}
  function choosePicture(file:File|undefined){if(!file)return;if(!['image/png','image/jpeg'].includes(file.type)){notify('Choose a JPEG or PNG picture.','error');return;}
    const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=112;canvas.height=112;const ctx=canvas.getContext('2d');if(!ctx)return;const size=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-size)/2,(img.height-size)/2,size,size,0,0,112,112);const jpeg=canvas.toDataURL('image/jpeg',0.65);if(jpeg.length>28000){notify('Image is too large.','error');return;}form.setValue('photo_data',jpeg);};img.src=String(reader.result||'');};reader.readAsDataURL(file);
  }
  return <div className="settings-grid fade-in"><section className="panel edit-form"><p className="eyebrow">YOUR PROFILE</p><h3>Personal details</h3><form onSubmit={form.handleSubmit(saveProfile)}>
    <div className="profile-photo-row"><span className="profile-large-photo empty-avatar">{data.user.photo_data?<img src={data.user.photo_data} alt="Profile"/>:data.user.name.slice(0,1)}</span><label className="btn ghost small">Change photo<input className="sr-input" type="file" accept="image/jpeg,image/png" onChange={e=>choosePicture(e.target.files?.[0])}/></label></div>
    <label className="form-field"><span>Name</span><input maxLength={100} {...form.register('name',{required:true})}/></label>
    <label className="form-field"><span>Mobile / WhatsApp number</span><input type="tel" maxLength={30} {...form.register('mobile_number')}/></label>
    <label className="form-field"><span>Birth date (optional)</span><input type="date" {...form.register('birth_date')}/></label>
    <label className="form-field"><span>Registered email</span><input type="email" {...form.register('email')}/></label>
    {form.watch('email')!==data.user.email&&<><button type="button" className="btn secondary small" onClick={()=>void requestNewEmail()}>Send verification to new email</button>{emailPending&&<div className="button-row"><input aria-label="Email verification code" placeholder="8-digit code" value={emailCode} onChange={e=>setEmailCode(e.target.value)} maxLength={8}/><button className="btn primary small" type="button" disabled={emailCode.length!==8} onClick={()=>void confirmNewEmail()}>Verify</button></div>}</>}
    <div className="account-row"><span>Role</span><b>{data.user.role}</b></div>
    <div className="account-row"><span>Language</span><select value={lang} onChange={e=>setLang(e.target.value as typeof lang)}>{LANGUAGES.map(l=><option value={l.code} key={l.code}>{l.label}</option>)}</select></div>
    <button type="submit" disabled={busy} className="btn primary full">Save profile</button>
  </form><button type="button" className="btn ghost full logout" onClick={()=>void logout()}>Sign out</button></section>
  <section className="panel edit-form"><p className="eyebrow">FREE EXTERNAL COMMUNICATION</p><h3>Open a chat app</h3><p className="settings-help">Messages remain outside SitePulse. No Firestore database or internal chat is needed.</p>
    <a className="btn secondary full" target="_blank" rel="noopener noreferrer" href="https://chat.google.com/">Open Google Chat</a>
    <label className="form-field"><span>WhatsApp number (include country code)</span><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+91 98765 43210"/></label>
    {whatsapp?<a className="btn secondary full" href={whatsapp} target="_blank" rel="noopener noreferrer">Open WhatsApp chat</a>:<p className="tiny-muted">Enter a full number to open an external WhatsApp conversation.</p>}
  </section>
  {data.user.role==='admin'&&<section className="panel edit-form"><p className="eyebrow">WORKSPACE PREFERENCES</p><h3>Rename menu labels</h3><p className="settings-help">Changes will appear for all staff after their next refresh.</p><div className="labels-grid">{NAV.map(n=><label key={n.section} className="form-field"><span>{tr(lang,n.section)}</span><input maxLength={32} value={labels[n.section]||''} placeholder={tr(lang,n.section)} onChange={e=>setLabels(p=>({...p,[n.section]:e.target.value}))}/></label>)}</div><button className="btn primary" disabled={busy} onClick={()=>void saveLabels()}>Save menu names</button></section>}
  </div>;
}
