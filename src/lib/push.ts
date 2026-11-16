import {api,firebaseConfig,vapidPublicKey} from './api';
let registeredToken='';
export async function enablePush(onMessage:(title:string,body:string)=>void){
  if(!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('YOUR_') || vapidPublicKey.startsWith('YOUR_'))throw new Error('Firebase push settings are not configured.');
  if(!('serviceWorker'in navigator)||!('Notification'in window))throw new Error('Push notifications are not supported in this browser.');
  if(await Notification.requestPermission()!=='granted')throw new Error('Notification permission not granted.');
  const [{initializeApp,getApps},{getMessaging,getToken,isSupported,onMessage:observe}]=await Promise.all([import('firebase/app'),import('firebase/messaging')]);
  if(!await isSupported())throw new Error('Firebase messaging is not supported in this browser.');
  const app=getApps().length?getApps()[0]:initializeApp(firebaseConfig);
  const sw=await navigator.serviceWorker.register(import.meta.env.BASE_URL+'firebase-messaging-sw.js');
  const messaging=getMessaging(app);
  const token=await getToken(messaging,{vapidKey:vapidPublicKey,serviceWorkerRegistration:sw});
  if(!token)throw new Error('Unable to obtain a device notification token.');
  await api('registerPushToken',token,navigator.userAgent.slice(0,95));
  registeredToken=token;
  observe(messaging,m=>onMessage(m.data?.title||m.notification?.title||'CSP SitePulse',m.data?.body||m.notification?.body||'New update'));
}
export async function disablePush(){if(registeredToken){await api('unregisterPushToken',registeredToken);registeredToken='';}}
