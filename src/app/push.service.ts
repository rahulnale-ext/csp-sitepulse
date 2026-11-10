import {Injectable} from '@angular/core';
import {environment} from './environment';
import {ApiService} from './api.service';

@Injectable({providedIn:'root'})
export class PushService {
  private fcmToken='';
  constructor(private api:ApiService){}
  get configured():boolean {return !environment.firebase.apiKey.startsWith('YOUR_') && !environment.vapidPublicKey.startsWith('YOUR_');}
  async enable(notifyUser:(title:string,body:string)=>void):Promise<void> {
    if (!this.configured) throw new Error('Notifications are not configured yet.');
    if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('This browser cannot receive push notifications.');
    const permission=await Notification.requestPermission();
    if (permission!=='granted') throw new Error('Notification permission was not granted.');
    const [{initializeApp,getApps},{getMessaging,getToken,onMessage,isSupported}]=await Promise.all([import('firebase/app'),import('firebase/messaging')]);
    if (!(await isSupported())) throw new Error('This browser does not support push notifications.');
    const app=getApps().length?getApps()[0]:initializeApp(environment.firebase);
    const sw=await navigator.serviceWorker.register('firebase-messaging-sw.js',{scope:'./'});
    const messaging=getMessaging(app);
    const token=await getToken(messaging,{vapidKey:environment.vapidPublicKey,serviceWorkerRegistration:sw});
    if (!token) throw new Error('Unable to obtain a device notification token.');
    await this.api.call('registerPushToken',token,navigator.userAgent.slice(0,95));
    this.fcmToken=token;
    onMessage(messaging,m=>notifyUser(m.data?.['title']||m.notification?.title||'CSP SitePulse',m.data?.['body']||m.notification?.body||'New update'));
    navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='CSP_FCM_FOREGROUND')notifyUser(event.data.title,event.data.body);});
  }
  async disable():Promise<void> {
    if (this.fcmToken) await this.api.call('unregisterPushToken',this.fcmToken);
    this.fcmToken='';
  }
}
