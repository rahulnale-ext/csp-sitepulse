import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {environment} from './environment';
import type {ApiResult} from './models';

@Injectable({providedIn:'root'})
export class ApiService {
  private readonly url = environment.apiUrl;
  private token = sessionStorage.getItem('csp.session') || '';
  constructor(private readonly http:HttpClient) {}
  get hasSession():boolean {return !!this.token;}
  setSession(token:string):void { this.token=token; sessionStorage.setItem('csp.session',token); }
  clearSession():void { this.token=''; sessionStorage.removeItem('csp.session'); }
  async call<T>(method:string,...args:unknown[]):Promise<T> {
    if (this.url.includes('YOUR-CLOUDFLARE-WORKER')) throw new Error('Your app API endpoint has not been configured. Ask the administrator to complete setup.');
    const res=await firstValueFrom(this.http.post<ApiResult<T>>(this.url,{method,args,sessionToken:this.token}));
    if (!res || !res.ok) throw new Error(res?.error || 'Unable to complete request.');
    return res.result;
  }
}
