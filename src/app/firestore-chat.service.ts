import {Injectable, NgZone} from '@angular/core';
import type {FirebaseApp} from 'firebase/app';
import type {Auth} from 'firebase/auth';
import type {Firestore, Unsubscribe, Timestamp} from 'firebase/firestore';
import {environment} from './environment';
import {ApiService} from './api.service';
import type {DirectMessage} from './models';

type FirestoreChatToken = {token:string;uid:string;projectId:string};

type StoredMessage = {
  senderId:string; recipientId:string; body:string;
  createdAt?:Timestamp | null; readAt?:Timestamp | null;
};

/**
 * Realtime one-to-one chat. No privileged credentials or Google Sheets message writes
 * are ever performed by the browser. Cloud Firestore rules enforce membership.
 *
 * Existing messages in Direct_Messages can be migrated by an admin using the
 * separately authenticated backend migration method.
 */
@Injectable({providedIn:'root'})
export class FirestoreChatService {
  private app:FirebaseApp|null=null;
  private auth:Auth|null=null;
  private firestoreApi:typeof import('firebase/firestore')|null=null;
  private authApi:typeof import('firebase/auth')|null=null;
  private db:Firestore|null=null;
  private unsubscribe:Unsubscribe|null=null;
  private listenerGeneration=0;
  private currentUid='';
  private cached:DirectMessage[]=[];
  private onChange:((messages:DirectMessage[])=>void)|null=null;
  private onError:((error:string)=>void)|null=null;

  constructor(private readonly api:ApiService,private readonly zone:NgZone) {}

  get configured():boolean {
    const c=environment.firebase;
    return Boolean(c.apiKey && c.projectId && c.appId &&
      !c.apiKey.startsWith('YOUR_') && !c.projectId.startsWith('YOUR-') &&
      !c.appId.startsWith('YOUR_'));
  }
  get connected():boolean {return !!this.unsubscribe && !!this.currentUid;}
  get messages():DirectMessage[] {return this.cached;}

  async connect(uid:string, onChange:(messages:DirectMessage[])=>void, onError:(message:string)=>void):Promise<void> {
    if(!this.configured) throw new Error('Firebase settings are missing in environment.ts. Firestore chat is not available.');
    if(!uid) throw new Error('The current staff account has no ID.');
    if(this.connected && this.currentUid===uid) {
      this.onChange=onChange;this.onError=onError;
      onChange(this.cached);
      return;
    }
    const generation=++this.listenerGeneration;
    this.stopListener();
    this.cached=[];
    this.onChange=onChange;
    this.onError=onError;
    const credential=await this.api.call<FirestoreChatToken>('getFirestoreChatToken');
    if(generation!==this.listenerGeneration) return;
    if(credential.uid!==uid || credential.projectId!==environment.firebase.projectId)
      throw new Error('Firebase identity or project mismatch. Check your Firebase settings.');
    // Import heavy Firebase modules after login to keep the initial Angular bundle compact.
    const [firebaseApp,firebaseAuth,firebaseStore]=await Promise.all([
      import('firebase/app'),import('firebase/auth'),import('firebase/firestore')
    ]);
    if(generation!==this.listenerGeneration)return;
    this.authApi=firebaseAuth;this.firestoreApi=firebaseStore;
    this.app=firebaseApp.getApps().find(a=>a.name==='[DEFAULT]') || firebaseApp.initializeApp(environment.firebase);
    this.auth=firebaseAuth.getAuth(this.app);
    await firebaseAuth.setPersistence(this.auth,firebaseAuth.inMemoryPersistence);
    if(generation!==this.listenerGeneration) return;
    // A fresh server-issued custom token establishes the identity after the Apps Script OTP check.
    await firebaseAuth.signInWithCustomToken(this.auth,credential.token);
    if(generation!==this.listenerGeneration){
      if(this.auth.currentUser?.uid===uid)await firebaseAuth.signOut(this.auth);
      return;
    }
    if(this.auth.currentUser?.uid!==uid) throw new Error('Firebase signed in with the wrong user.');
    this.db=firebaseStore.getFirestore(this.app);
    this.currentUid=uid;
    const chats=firebaseStore.query(firebaseStore.collection(this.db,'sitepulseMessages'),
      firebaseStore.where('participantIds','array-contains',uid));
    this.unsubscribe=firebaseStore.onSnapshot(chats,snapshot=>{
      if(generation!==this.listenerGeneration)return;
      const messages=snapshot.docs.map(entry=>{
        const m=entry.data() as StoredMessage;
        const created=m.createdAt?.toDate?.()?.toISOString() || new Date().toISOString();
        const read=m.readAt?.toDate?.()?.toISOString() || '';
        return {
          id:entry.id,
          sender_id:m.senderId,
          recipient_id:m.recipientId,
          body:m.body,
          created_at:created,
          read_at:read,
          pending:entry.metadata.hasPendingWrites
        } satisfies DirectMessage;
      });
      messages.sort((a,b)=>a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      this.cached=messages;
      this.zone.run(()=>this.onChange?.(messages));
    },e=>{
      this.stopListener();
      this.currentUid='';
      this.zone.run(()=>this.onError?.('Firestore messages could not be loaded: '+e.message));
    });
  }

  async send(recipientId:string,body:string):Promise<string> {
    if(!this.db || !this.connected || !this.firestoreApi) throw new Error('Firestore chat is not connected. Sign in again.');
    const text=body.trim();
    if(!text||text.length>1500)throw new Error('Enter a message of at most 1,500 characters.');
    if(!recipientId||recipientId===this.currentUid)throw new Error('Choose a different recipient.');
    const api=this.firestoreApi;
    const ref=api.doc(api.collection(this.db,'sitepulseMessages'));
    await api.setDoc(ref,{
      senderId:this.currentUid, recipientId, participantIds:[this.currentUid,recipientId].sort(),
      body:text, createdAt:api.serverTimestamp(), readAt:null
    });
    return ref.id;
  }

  /** Marks only messages addressed to this user as read (and never other users' messages). */
  async markRead(peerId:string):Promise<number> {
    if(!this.db || !this.connected || !this.firestoreApi || !peerId)return 0;
    const unread=this.cached.filter(m=>m.sender_id===peerId&&m.recipient_id===this.currentUid&&!m.read_at&&!m.pending);
    if(!unread.length)return 0;
    const api=this.firestoreApi;
    const batch=api.writeBatch(this.db);
    for(const msg of unread.slice(0,200)) batch.update(api.doc(this.db,'sitepulseMessages',msg.id),{readAt:api.serverTimestamp()});
    await batch.commit();
    return Math.min(unread.length,200);
  }

  /** Stops all listeners and clears the session; never retain another person's messages. */
  async disconnect():Promise<void> {
    ++this.listenerGeneration;
    this.stopListener();
    this.cached=[];
    this.currentUid='';
    this.onChange=null;
    this.onError=null;
    if(this.auth?.currentUser&&this.authApi)await this.authApi.signOut(this.auth);
  }

  private stopListener():void {
    this.unsubscribe?.();
    this.unsubscribe=null;
  }
}
