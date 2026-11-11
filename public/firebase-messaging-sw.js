/* Single PWA + FCM worker: one registration controls this app's scope. */
const CACHE='csp-sitepulse-shell-v2';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./isha-logo.png'])).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('./index.html')));return;}
  event.respondWith(fetch(req).then(resp=>{if(resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(req,clone));}return resp;}).catch(()=>caches.match(req)));
});
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch (_) { payload = {data:{body:event.data?.text() || ''}}; }
  const details = payload.data || payload.notification || {};
  const title = String(details.title || 'CSP SitePulse');
  const body = String(details.body || 'You have a new update.');
  const appBase = new URL('./', self.location.href);
  let destination = appBase.href;
  try { const url = new URL(details.url || './', appBase); if (url.origin === appBase.origin && url.pathname.startsWith(appBase.pathname)) destination = url.href; } catch (_) {}
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const visible=clients.filter(c=>c.visibilityState==='visible');
    // Refresh the live inbox without opening an in-app toast; show a normal device notification.
    visible.forEach(c=>c.postMessage({type:'CSP_FCM_FOREGROUND',title,body}));
    return self.registration.showNotification(title,{body,icon:new URL('isha-logo.png',appBase).href,badge:new URL('isha-logo.png',appBase).href,tag:String(details.noteId||''),data:{url:destination}});
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = event.notification.data?.url || new URL('./',self.location.href).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients => {
    const found = clients.find(c => c.url.startsWith(destination));
    if (found) return found.focus();
    return self.clients.openWindow(destination);
  }));
});
