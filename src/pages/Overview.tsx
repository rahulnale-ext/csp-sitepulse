import React from 'react';
import {useNavigate} from 'react-router-dom';
import {useSite} from '../lib/site-context';
import {isVerifiedAssignment,formatDate} from '../lib/format';
export default function Overview(){
  const {data}=useSite();const go=useNavigate();if(!data)return null;
  const verified=data.tickets.filter(isVerifiedAssignment);
  const pending=data.reports.filter(r=>r.status==='pending');
  const approved=data.reports.filter(r=>r.status==='approved').length;
  const pct=data.reports.length?Math.round(approved/data.reports.length*100):0;
  const stats=[{label:'Verified assigned tickets',value:verified.length,path:'/tickets'},{label:'Pending approvals',value:pending.length,path:'/review'},{label:'Approved reports',value:approved,path:'/reports'},{label:'Approval rate',value:pct+'%',path:'/reports'}];
  return <div className="fade-in"><div className="hero-banner"><div className="hero-copy"><p className="eyebrow">CONNECTED FIELD TEAMS</p><h3>Welcome, {data.user.name.split(' ')[0]}.</h3><p>Keep site tickets, daily reports and decisions together.</p><button className="btn light" onClick={()=>go(data.user.role==='supervisor'?'/reports':'/tickets')}>Open work area</button></div><img src={import.meta.env.BASE_URL+'isha-logo.png'} alt="" aria-hidden="true"/></div>
    <div className="stats-grid">{stats.map(s=><button type="button" key={s.label} onClick={()=>go(s.path)} className="stat-card"><span className="stat-label">{s.label}</span><span className="stat-value">{s.value}</span><span className="stat-bottom">Current SitePulse records <b>+</b></span></button>)}</div>
    <div className="overview-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">MY WORK</p><h3>Highest-priority tickets</h3></div><button className="text-action" onClick={()=>go('/tickets')}>View all</button></div>
      {verified.slice().sort((a,b)=>Number(a.priority_sequence||9999)-Number(b.priority_sequence||9999)).slice(0,8).map(t=><div className="ticket-mini" key={t.id}><span className="ticket-tag">{t.jira_ticket_no}</span><div className="mini-main"><b title={t.summary}>{t.summary}</b><span>{t.location||'Location not supplied'} - {formatDate(t.created)}</span></div><span className="pill">{t.status}</span></div>)}{verified.length===0&&<p className="empty">No queue-verified tickets yet. Admin must preview the CIVIL supervisor queues before syncing.</p>}
    </section><section className="panel"><div className="panel-head"><div><p className="eyebrow">RECENT ACTIVITY</p><h3>Updates</h3></div></div>{data.notifications.slice(0,8).map(n=><div className="activity" key={n.id}><span className="activity-mark"/><div><b>{n.title}</b><p>{n.body}</p><small>{formatDate(n.created_at)}</small></div></div>)}{!data.notifications.length&&<p className="empty">No recent updates.</p>}</section></div>
  </div>;
}
