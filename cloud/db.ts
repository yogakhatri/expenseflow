export interface Env { DB: D1Database; ASSETS: Fetcher; AUTH_PASSWORD_VERIFIER?: string; AUTH_PASSWORD_PEPPER?: string; SESSION_SECRET?: string }
export const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
export const bad=(message:string,status=400)=>json({error:message},status)
export const norm=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ')
export async function sha256(s:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function fingerprint(x:any){return sha256(`${x.transaction_date}|${x.amount_paise}|${norm(x.description||'')}|${x.payment_method_id}|${x.account_id||0}`)}
export function validDate(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))}
