import {useSyncExternalStore} from 'react';
import {API_ORIGIN, sandboxRequest} from './developer-api';

export type MerchantUser = {id:string;email:string;name:string;role?:'merchant'|'admin'};
export type MerchantSession = {token:string;user:MerchantUser};
let current:MerchantSession|null=null;
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
const snapshot=()=>current;
export const getMerchantSession=snapshot;
export const useMerchantSession=()=>useSyncExternalStore(subscribe,snapshot,()=>null);
function update(next:MerchantSession|null){current=next;for(const listener of listeners)listener()}

export async function restoreMerchantSession():Promise<MerchantSession|null>{
 try{
  const res=await fetch(API_ORIGIN+'/api/auth/me',{credentials:'include'});
  if(!res.ok)return null;
  const json=await res.json() as {user?:MerchantUser};
  if(!json.user?.id)return null;
  // Session cookie is valid; keep a marker token or fetch from storage if needed
  const stored=sessionStorage.getItem('ditsgate_token')||'cookie_session';
  const next={token:stored,user:json.user};
  update(next);
  return next;
 }catch{return null;}
}

export async function signInMerchant(email:string,password:string):Promise<MerchantSession>{
 const response=await fetch(API_ORIGIN+'/api/auth/login',{
  method:'POST',
  credentials:'include',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email:email.trim(),password}),
 }).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||'Login gagal');return j;}) as {token:string;user:MerchantUser};
 if(!response.token||!response.user?.id||!response.user.email)throw new Error('Sesi merchant tidak valid.');
 try{sessionStorage.setItem('ditsgate_token',response.token);}catch{}
 const next={token:response.token,user:response.user};update(next);return next;
}

export async function registerMerchant(name:string,email:string,password:string):Promise<MerchantSession>{
 await sandboxRequest(API_ORIGIN,'/api/auth/register','POST',undefined,{name:name.trim(),email:email.trim(),password});
 return signInMerchant(email,password);
}

export function signOutMerchant(){
 const previous=current;update(null);
 try{sessionStorage.removeItem('ditsgate_token');}catch{}
 void fetch(API_ORIGIN+'/api/auth/logout',{method:'POST',credentials:'include',headers:previous?.token?{Authorization:`Bearer ${previous.token}`}:{}}).catch(()=>{});
}
