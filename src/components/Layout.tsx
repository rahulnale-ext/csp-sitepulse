import React,{useEffect,useMemo,useRef,useState} from 'react';
import {NavLink,Outlet,useLocation,useNavigate} from 'react-router-dom';
import {Bell,BookOpen,CheckCircle2,ChevronLeft,ChevronRight,ClipboardList,FolderKanban,HardHat,Home,LayoutGrid,LogOut,Menu,RefreshCcw,Settings2,Users,Warehouse,X,AlertCircle,Info,Check,ExternalLink} from 'lucide-react';
import {useSite} from '../lib/site-context';
import {LANGUAGES,NAV,tr} from '../lib/i18n';
import type {Section,Notice} from '../lib/models';
import {api} from '../lib/api';
import {enablePush} from '../lib/push';

const icons:Record<string,React.ComponentType<{size?:number;strokeWidth?:number}>>={overview:Home,tickets:ClipboardList,reports:BookOpen,review:CheckCircle2,team:Users,inventory:HardHat,jira:FolderKanban,workbook:LayoutGrid,settings:Settings2};
const routes:Record<string,string>={overview:'/overview',tickets:'/tickets',reports:'/reports',review:'/review',team:'/people',inventory:'/materials',jira:'/jira',workbook:'/workbook',settings:'/settings'};
const logo=import.meta.env.BASE_URL+'isha-logo.png';

export function ToastStack(){
  const {toasts,dismiss}=useSite();
  return <div className="toast-stack" aria-live="polite" aria-atomic="false">
    {toasts.map(item=><div key={item.id} className={'toast-item '+item.type} role={item.type==='error'?'alert':'status'}>
      {item.type==='success'?<Check size={18}/>:item.type==='error'?<AlertCircle size={18}/>:<Info size={18}/>}
      <div>{item.message}</div><button aria-label="Dismiss message" onClick={()=>dismiss(item.id)}><X size={16}/></button>
    </div>)}
  </div>;
}
export default function Layout(){
  const {data,lang,setLang,refresh,notify,mutation,busy,signOut}=useSite();
  const [compact,setCompact]=useState(localStorage.getItem('csp.sidebar')==='true');
  const [mobile,setMobile]=useState(false);
  const [bellOpen,setBellOpen]=useState(false);
  const bellRef=useRef<HTMLDivElement>(null);
  const navigate=useNavigate();
  const location=useLocation();
  const section=(Object.entries(routes).find(([,path])=>path===location.pathname)?.[0]||'overview') as Section;
  const unread=(data?.notifications||[]).filter(x=>!x.read_at).length;
  const title=useMemo(()=>data?.menuLabels?.[section]||tr(lang,section),[data?.menuLabels,lang,section]);
  useEffect(()=>{setMobile(false);setBellOpen(false);},[location.pathname]);
  useEffect(()=>{function outside(e:MouseEvent){if(bellRef.current&&!bellRef.current.contains(e.target as Node))setBellOpen(false);}document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
  const markRead=async(n:Notice)=>{try{await mutation('markNotificationRead',[n.id],'',old=>({...old,notifications:old.notifications.map(x=>x.id===n.id?{...x,read_at:new Date().toISOString()}:x)}));}catch(_){}};
  if(!data)return null;
  const menu=NAV.filter(n=>n.roles.includes(data.user.role));
  return <div className={'app-root '+(compact?'sidebar-compact':'')}>
    <div className="workspace">
      {mobile&&<button className="mobile-shade" aria-label="Close menu" onClick={()=>setMobile(false)}/>}
      <aside className={'sidebar '+(mobile?'mobile-open':'')}>
        <button type="button" className="brand-lockup" onClick={()=>navigate('/overview')} aria-label="CSP home">
          <img src={logo} alt="Isha"/><span className="brand-text"><b>CSP <em>SitePulse</em></b><small>FIELD OPERATIONS</small></span>
        </button>
        <div className="menu-label">{tr(lang,'navigation')}</div>
        <nav className="main-nav" aria-label="Main navigation">
          {menu.map(n=>{const Icon=icons[n.section]||BookOpen;const label=data.menuLabels?.[n.section]||tr(lang,n.section);
            return <NavLink key={n.section} to={routes[n.section]} title={label} aria-label={label} className={({isActive})=>'nav-item'+(isActive?' active':'')}><span className="nav-glyph"><Icon size={19} strokeWidth={1.8}/></span><span className="nav-name">{label}</span></NavLink>;
          })}
        </nav>
        <div className="sidebar-bottom"><button className="collapse-toggle" type="button" onClick={()=>{setCompact(x=>{localStorage.setItem('csp.sidebar',String(!x));return !x;});}} aria-label={compact?'Expand menu':'Collapse menu'}>{compact?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}<span>Collapse menu</span></button></div>
      </aside>
      <div className="main-area">
        <header className="topbar"><div className="topbar-start">
          <button type="button" className="btn-icon mobile-burger" aria-label="Toggle navigation" onClick={()=>setMobile(x=>!x)}><Menu size={19}/></button>
          <div className="breadcrumb">CSP <span>/</span> <strong>{title}</strong></div>
        </div><div className="topbar-end">
          <select className="language-select" aria-label="Language" value={lang} onChange={e=>setLang(e.target.value as typeof lang)}>{LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}</select>
          <div className="bell-wrap" ref={bellRef}>
            <button type="button" className="btn-icon bell" aria-label="Notifications" aria-expanded={bellOpen} onClick={()=>setBellOpen(x=>!x)}><Bell size={20}/>{unread>0&&<span className="bell-dot"/>}</button>
            {bellOpen&&<div className="bell-popover" role="dialog" aria-label="Recent notifications"><div className="popover-head"><b>Notifications {unread>0?'('+unread+')':''}</b><button className="plain" onClick={()=>setBellOpen(false)} aria-label="Close"><X size={15}/></button></div>
              <div className="popover-scroll">{data.notifications.slice(0,10).map(n=><div className={'popover-notice '+(!n.read_at?'unread':'')} key={n.id}><b>{n.title}</b><p>{n.body}</p><small>{n.created_at?.slice(0,16)}</small>{!n.read_at&&<button className="small-action" onClick={()=>void markRead(n)}>Mark read</button>}</div>)}{!data.notifications.length&&<p className="empty compact-empty">No notifications</p>}</div>
              <div className="popover-actions"><button className="btn ghost small" disabled={busy} onClick={()=>void enablePush((t,b)=>{notify(t+': '+b,'info');void refresh();}).then(()=>notify('Device notifications enabled.','success')).catch(e=>notify(e.message,'error'))}>Enable device alerts</button><button className="btn ghost small" disabled={busy} onClick={()=>void mutation('sendPushTest',[],'Test notification requested').catch(()=>{})}>Test</button></div>
            </div>}
          </div>
          <button className="profile" type="button" onClick={()=>navigate('/settings')} title="Account settings"><span className="avatar">{data.user.name?.slice(0,1).toUpperCase()}</span><span className="profile-meta"><b>{data.user.name}</b><small>{data.user.role}</small></span></button>
        </div></header>
        <div className="page-wrap">
          <div className="page-head"><div><p className="eyebrow">CSP OPERATIONS <span className="bullet">-</span> {new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</p><h2>{title}</h2></div><div className="head-actions"><button type="button" className="btn ghost small" onClick={()=>void refresh(true)}><RefreshCcw size={14}/> Refresh</button></div></div>
          <Outlet/>
        </div>
      </div>
    </div>
  </div>;
}
