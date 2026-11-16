import {environment} from '../app/environment';

const TOKEN_KEY='csp.session';
export const apiConfigured=Boolean(environment.apiUrl && /^https:\/\//.test(environment.apiUrl) && !environment.apiUrl.includes('YOUR-'));
export const apiEndpoint=environment.apiUrl;

export const session={
  read:()=>sessionStorage.getItem(TOKEN_KEY)||'',
  save:(token:string)=>sessionStorage.setItem(TOKEN_KEY,token),
  clear:()=>sessionStorage.removeItem(TOKEN_KEY)
};

export async function api<T=unknown>(method:string,...args:unknown[]):Promise<T>{
  if(!apiConfigured)throw new Error('Server address not configured. Restore src/app/environment.ts from your working installation.');
  const controller=new AbortController();
  const timeoutMs=method==='syncJiraSupervisorQueues'?150000:method==='previewJiraSupervisorQueues'?75000:45000;
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(apiEndpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({method,args,sessionToken:session.read()}),signal:controller.signal
    });
    if(!response.ok)throw new Error('Server HTTP '+response.status+'. Check the Cloudflare Worker and Apps Script deployment.');
    const data=await response.json() as {ok:boolean;result:T;error?:string};
    if(!data.ok)throw new Error(data.error||'Unable to complete request.');
    return data.result;
  }catch(error){
    if(error instanceof DOMException&&error.name==='AbortError')throw new Error('The server request timed out. Check Apps Script Executions and Jira connectivity.');
    throw error;
  }finally{clearTimeout(timeout);}
}
export const firebaseConfig=environment.firebase;
export const vapidPublicKey=environment.vapidPublicKey;
