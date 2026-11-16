import React from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter} from 'react-router-dom';
import {SiteProvider} from './lib/site-context';
import App from './App';
import './global.css';
import './legacy.css';
import './app.css';

const root=document.getElementById('root');
if(!root)throw new Error('Missing application mount');
createRoot(root).render(
  <React.StrictMode><HashRouter><SiteProvider><App/></SiteProvider></HashRouter></React.StrictMode>
);
