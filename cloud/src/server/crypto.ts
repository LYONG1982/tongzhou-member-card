import { pbkdf2Sync, scryptSync, timingSafeEqual } from 'node:crypto';
const ITERATIONS = 600000;
export const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
export async function digest(value: string | ArrayBuffer) {
  const out = await crypto.subtle.digest('SHA-256', typeof value==='string'?new TextEncoder().encode(value):value);
  return Array.from(new Uint8Array(out),v=>v.toString(16).padStart(2,'0')).join('');
}
// OWASP scrypt profile: 16 MiB, N=2^14, r=8, p=5. No reduced work factor.
const SCRYPT={N:16384,r:8,p:5,maxmem:32*1024*1024};
export function hashPassword(password: string) {
 const salt=token();const hash=scryptSync(password,salt,32,SCRYPT).toString('hex');
 return `scrypt$16384$8$5$${salt}$${hash}`;
}
export function verifyPassword(password:string,stored:string) {
 const parts=stored.split('$');let value:Buffer,hash:string;
 if(parts[0]==='scrypt'&&parts[1]==='16384'&&parts[2]==='8'&&parts[3]==='5'&&parts.length===6){
  value=scryptSync(password,parts[4],32,SCRYPT);hash=parts[5];
 }else if(parts[0]==='pbkdf2-sha256'&&Number(parts[1])===ITERATIONS&&parts.length===4){
  // Compatibility for local development accounts created before the runtime check.
  value=pbkdf2Sync(password,parts[2],ITERATIONS,32,'sha256');hash=parts[3];
 }else return false;
 const expected=Buffer.from(hash,'hex');return expected.length===value.length&&timingSafeEqual(value,expected);
}
