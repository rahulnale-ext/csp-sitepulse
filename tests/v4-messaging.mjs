import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../backend/Code.gs',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const uid='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222';
const project='test-firestore-proj';
const account={client_email:'fake@test-firestore-proj.iam.gserviceaccount.com',private_key:privateKey,project_id:project};
const now=Date.now(),expires=now+3*24*60*60*1000;
const legacy=[{id:'legacy-00001',sender_id:uid,recipient_id:peer,body:'Archive message',created_at:'2026-11-10T12:00:00.000Z',read_at:''}];
let responseBody=null,notificationCount=0;
const mocked={
  PropertiesService:{getScriptProperties:()=>({getProperty:(key)=>({FCM_SERVICE_ACCOUNT_JSON:JSON.stringify(account),FCM_PROJECT_ID:project})[key]})},
  Utilities:{
    newBlob:(s)=>({getBytes:()=>Array.from(Buffer.from(s,'utf8'))}),
    base64EncodeWebSafe:(x)=>Buffer.from(x).toString('base64url'),
    computeRsaSha256Signature:(unsigned,key)=>Array.from(sign('RSA-SHA256',Buffer.from(unsigned),key))
  },
  identity_:()=>({id:uid,name:'Test Sender'}),db_:()=>({}),
  digest_:(s)=>'hash-'+s,
  rows_:(_ss,tab)=>tab==='Sessions'?[{token_hash:'hash-testtoken',expires_at:new Date(expires).toISOString()}]:tab==='Direct_Messages'?legacy:tab==='Users'?[{id:peer,email:'peer@example.invalid',account_status:'active'}]:[],
  requireRole_:(_ss,roles)=>{if(roles[0]!=='admin')throw Error('not admin');},
  CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
  UrlFetchApp:{fetch:(url,opts)=>{
    if(url.includes('oauth2.googleapis.com'))return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({access_token:'oauth-token',expires_in:3600})};
    if(url.includes('documents:batchWrite')){responseBody=JSON.parse(opts.payload);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({status:[{code:0}]})};}
    if(url.includes('/sitepulseMessages/'))return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({fields:{senderId:{stringValue:uid},recipientId:{stringValue:peer},body:{stringValue:'Test notification'}}})};
    throw Error('unexpected url: '+url);
  }},
  transaction_:(fn)=>fn({}),notify_:()=>{notificationCount++;}
};
const ctx=createContext(mocked);
runInContext(between('function cspChatServiceAccount_','function messagesFor_'),ctx);
const credential=ctx.getFirestoreChatToken('testtoken');
const [header,payload,signature]=credential.token.split('.');
const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
assert.equal(parsed.uid,uid);
assert.equal(parsed.aud,'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
assert.equal(parsed.claims.csp_chat,true);
assert.equal(parsed.claims.csp_until_ms,expires);
assert.ok(verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(signature,'base64url')));
assert.equal(credential.projectId,project);
const migration=ctx.migrateLegacyMessagesToFirestore('testtoken',0);
assert.equal(migration.imported,1);
assert.equal(migration.total,1);
assert.equal(responseBody.writes[0].update.fields.senderId.stringValue,uid);
assert.equal(responseBody.writes[0].update.fields.recipientId.stringValue,peer);
assert.equal(responseBody.writes[0].currentDocument.exists,false);
ctx.notifyFirestoreMessage('testtoken',peer,'abcdefgh123456');
assert.equal(notificationCount,1);
assert.throws(()=>ctx.notifyFirestoreMessage('testtoken',uid,'abcdefgh123456'),/Recipient is not an active/);
console.log('PASS: Firebase custom JWT is correctly signed, message migration keeps IDs, push verifies sender/recipient.');
