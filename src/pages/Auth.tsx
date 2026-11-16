import React,{useState} from 'react';
import {useForm} from 'react-hook-form';
import {useSite} from '../lib/site-context';
import {api,apiConfigured,session} from '../lib/api';
import {LANGUAGES,tr} from '../lib/i18n';
import type {Bootstrap} from '../lib/models';
const logo=import.meta.env.BASE_URL+'isha-logo.png';
interface AuthInputs{email:string;code:string}
export default function Auth(){
  const {notify,setBootstrap,lang,setLang}=useSite();
  const [step,setStep]=useState<'email'|'code'>('email');
  const [sending,setSending]=useState(false);
  const form=useForm<AuthInputs>({defaultValues:{email:'',code:''}});
  const submit=async(values:AuthInputs)=>{
    setSending(true);
    try{
      if(step==='email'){
        const r=await api<{message:string}>('requestLoginCode',values.email.trim());
        notify(r.message||'A sign-in code was sent to your registered email.','success');setStep('code');
      }else{
        const result=await api<{authorized:boolean;sessionToken:string}>('verifyLoginCode',values.email.trim(),values.code.trim());
        if(!result.authorized||!result.sessionToken)throw new Error('Sign-in was not completed.');
        session.save(result.sessionToken);
        try{
          const b=await api<Bootstrap>('getBootstrap');
          if(!b.authorized)throw new Error(b.message||'Account not authorized.');
          setBootstrap(b);notify('Welcome to SitePulse.','success');
        }catch(error){session.clear();throw error;}
      }
    }catch(error){notify(error instanceof Error?error.message:'Unable to sign in.','error');}
    finally{setSending(false);}
  };
  return <main className="auth-screen"><div className="auth-art" aria-hidden="true"><img src={logo}/></div><div className="auth-box">
    <div className="auth-brand"><img src={logo} alt="Isha logo"/><div><div className="eyebrow">CIVIL SERVICE PROGRAMME</div><h1>CSP <em>SitePulse</em></h1></div></div>
    <p className="intro">A calmer way to keep field work moving.</p><div className="auth-caption">SECURE STAFF ACCESS</div>
    <form onSubmit={form.handleSubmit(submit)}>
      <label className="field-label" htmlFor="login-email">{tr(lang,'email')}</label>
      <input id="login-email" type="email" autoComplete="email" maxLength={200} disabled={step==='code'} placeholder="name@example.com" {...form.register('email',{required:true})}/>
      {step==='code'&&<><label className="field-label" htmlFor="login-code">{tr(lang,'code')}</label><input id="login-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} {...form.register('code',{required:true,pattern:/^\d{8}$/})}/></>}
      <button type="submit" className="btn primary full" disabled={!apiConfigured||sending}>{sending?'Working...':step==='email'?tr(lang,'requestCode'):tr(lang,'verify')}</button>
      {step==='code'&&<button className="link-button" type="button" onClick={()=>{setStep('email');form.setValue('code','');}}>Change email address</button>}
    </form>
    <p className="auth-help">An eight-digit, one-time sign-in code is sent to your registered email. Your account must be enabled by the administrator.</p>
    {!apiConfigured&&<div className="inline-warning">The server address has not been configured. Restore your working src/app/environment.ts settings.</div>}
    <div className="auth-footer"><span>Site operations - One connected workspace</span><select aria-label="Language" value={lang} onChange={e=>setLang(e.target.value as typeof lang)}>{LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}</select></div>
  </div></main>;
}
