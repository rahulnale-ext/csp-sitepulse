import React from 'react';
import {Navigate,Route,Routes} from 'react-router-dom';
import {useSite} from './lib/site-context';
import Auth from './pages/Auth';
import Layout,{ToastStack} from './components/Layout';
import Tickets from './pages/Tickets';
import Reports from './pages/Reports';
import Reviews from './pages/Reviews';
import People from './pages/People';
import Materials from './pages/Materials';
import WorkbookPage from './pages/Workbook';
import Settings from './pages/Settings';

export default function App(){
  const {data,loading}=useSite();
  if(loading)return <><main className="auth-screen"><p>Opening CSP SitePulse...</p></main><ToastStack/></>;
  if(!data)return <><Auth/><ToastStack/></>;
  return <><Routes><Route element={<Layout/>}>
    <Route index element={<Navigate to={data.user.role==='supervisor'?'/reports':'/tickets'} replace/>}/>
    <Route path="overview" element={<Navigate to={data.user.role==='supervisor'?'/reports':'/tickets'} replace/>}/>
    <Route path="tickets" element={data.user.role==='supervisor'?<Navigate to="/reports" replace/>:<Tickets/>}/>
    <Route path="reports" element={<Reports/>}/>
    <Route path="review" element={data.user.role==='lead'?<Reviews/>:<Navigate to={data.user.role==='supervisor'?'/reports':'/tickets'} replace/>}/>
    <Route path="people" element={data.user.role==='admin'?<People/>:<Navigate to={data.user.role==='supervisor'?'/reports':'/tickets'} replace/>}/>
    <Route path="materials" element={data.user.role==='admin'||data.user.role==='lead'?<Materials/>:<Navigate to={data.user.role==='supervisor'?'/reports':'/tickets'} replace/>}/>
    <Route path="jira" element={<Navigate to={data.user.role==='supervisor'?'/reports':'/tickets'} replace/>}/>
    <Route path="workbook" element={data.user.role==='admin'?<WorkbookPage/>:<Navigate to={data.user.role==='supervisor'?'/reports':'/tickets'} replace/>}/>
    <Route path="settings" element={<Settings/>}/>
    <Route path="*" element={<Navigate to={data.user.role==='supervisor'?'/reports':'/tickets'} replace/>}/>
  </Route></Routes><ToastStack/></>;
}
