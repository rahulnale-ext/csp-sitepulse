import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import type {Bootstrap,LiveUpdates,Lang} from './models';
import {LANGUAGES} from './i18n';
import {api,session} from './api';

type ToastType='error'|'success'|'info';
export interface Toast {id:number;message:string;type:ToastType;created:number}
interface SiteState {
  data:Bootstrap|null;
  loading:boolean;busy:boolean;
  toasts:Toast[];
  lang:Lang;
  notify:(message:string,type?:ToastType)=>void;
  dismiss:(id:number)=>void;
  setLang:(lang:Lang)=>void;
  refresh:(loud?:boolean)=>Promise<void>;
  refreshQuietly:()=>Promise<void>;
  request:<T>(method:string,...args:unknown[])=>Promise<T>;
  mutation:<T>(method:string,args:unknown[],success:string,optimistic?:(prev:Bootstrap)=>Bootstrap)=>Promise<T>;
  setBootstrap:(b:Bootstrap|null)=>void;
  signOut:()=>Promise<void>;
}
const Ctx=createContext<SiteState|null>(null);
export function useSite(){const ctx=useContext(Ctx);if(!ctx)throw new Error('SiteProvider missing');return ctx;}

export function SiteProvider({children}:{children:React.ReactNode}){
  const [data,setBootstrap]=useState<Bootstrap|null>(null);
  const [loading,setLoading]=useState(Boolean(session.read()));
  const [busy,setBusy]=useState(false);
  const [toasts,setToasts]=useState<Toast[]>([]);
  const [lang,setLanguage]=useState<Lang>(()=>{
    const saved=localStorage.getItem('csp.lang');
    return (LANGUAGES.some(x=>x.code===saved)?saved:'en-IN') as Lang;
  });
  const polling=useRef(false),mounted=useRef(true),toastNum=useRef(0);
  const notify=useCallback((message:string,type:ToastType='info')=>{
    const id=++toastNum.current;
    setToasts(s=>[...s.slice(-3),{id,message,type,created:Date.now()}]);
  },[]);
  const dismiss=useCallback((id:number)=>setToasts(s=>s.filter(x=>x.id!==id)),[]);
  const setLang=useCallback((next:Lang)=>{setLanguage(next);localStorage.setItem('csp.lang',next);document.documentElement.lang=next.slice(0,2);},[]);
  const request=useCallback(<T,>(method:string,...args:unknown[])=>api<T>(method,...args),[]);
  const refresh=useCallback(async(loud=false)=>{
    if(!session.read())return;
    try{
      const next=await api<Bootstrap>('getBootstrap');
      if(!next.authorized){session.clear();setBootstrap(null);throw new Error(next.message||'Session expired.');}
      if(mounted.current)setBootstrap(next);
      if(loud)notify('Workspace refreshed.','success');
    }catch(error){if(loud)notify(error instanceof Error?error.message:'Unable to refresh','error');}
    finally{setLoading(false);}
  },[notify]);
  const refreshQuietly=useCallback(async()=>{
    const next=await api<Bootstrap>('getBootstrap');
    if(!next.authorized)throw new Error(next.message||'Session expired.');
    if(mounted.current)setBootstrap(next);
  },[]);
  const mutation=useCallback(async<T,>(method:string,args:unknown[],success:string,optimistic?:(prev:Bootstrap)=>Bootstrap)=>{
    if(busy)throw new Error('Another action is in progress.');
    setBusy(true);
    const previous=data;
    if(previous&&optimistic)setBootstrap(optimistic(previous));
    try{
      const value=await api<T>(method,...args);
      if(success)notify(success,'success');
      try{await refreshQuietly();}catch(_){/* Retain optimistic update; next refresh will retry. */}
      return value;
    }catch(error){if(previous&&optimistic)setBootstrap(previous);
      notify(error instanceof Error?error.message:'Request failed','error');throw error;
    }finally{setBusy(false);}
  },[busy,data,notify,refreshQuietly]);
  const signOut=useCallback(async()=>{
    try{await api('logoutSession');}catch(_){/* Local signout always clears the session. */}
    session.clear();setBootstrap(null);notify('Signed out.','info');
  },[notify]);
  useEffect(()=>{mounted.current=true;if(session.read())void refresh();else setLoading(false);return()=>{mounted.current=false;};},[refresh]);
  useEffect(()=>{if('serviceWorker' in navigator&&location.protocol==='https:'){void navigator.serviceWorker.register(import.meta.env.BASE_URL+'firebase-messaging-sw.js').catch(()=>{});}},[]);
  useEffect(()=>{
    const timer=setInterval(()=>setToasts(s=>s.filter(t=>Date.now()-t.created<(t.type==='error'?14000:7500))),800);
    return()=>clearInterval(timer);
  },[]);
  useEffect(()=>{
    if(!data)return;
    const tick=async()=>{
      if(polling.current||document.visibilityState!=='visible'||!session.read())return;
      polling.current=true;
      try{const next=await api<LiveUpdates>('getLiveUpdates');if(mounted.current){setBootstrap(old=>old?{...old,tickets:next.tickets,reports:next.reports,notifications:next.notifications,items:next.items,contacts:next.contacts,itemRates:next.itemRates}:old);}}
      catch(_){/* Avoid repeated toast interruptions on unstable connections. */}
      finally{polling.current=false;}
    };
    const id=setInterval(tick,15000);
    window.addEventListener('focus',tick);
    return()=>{clearInterval(id);window.removeEventListener('focus',tick);};
  },[Boolean(data)]);
  return <Ctx.Provider value={{data,loading,busy,toasts,lang,notify,dismiss,setLang,refresh,refreshQuietly,request,mutation,setBootstrap,signOut}}>{children}</Ctx.Provider>;
}
