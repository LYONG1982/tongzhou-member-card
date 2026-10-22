import type {Hono} from 'hono';
import {setCookie,deleteCookie} from 'hono/cookie';
import {z} from 'zod';
import type {Env} from './types';
import {hashPassword,verifyPassword,digest,token} from './crypto';
import {loginInput,newPassword,uuid} from './validation';
import {admin,fail,json,type Ctx} from './common';
import {isIP} from 'node:net';
const profile=z.object({username:loginInput.shape.username,displayName:z.string().trim().min(1).max(40)}).strict();
const account=profile.extend({password:newPassword}).strict();
export const publicRole=(role:string)=>role==='admin'?'admin':'employee';
function clientIp(c:Ctx){
 const remote=c.env.REMOTE_IP||'unknown';
 const trusted=(c.env.TRUSTED_PROXY_IPS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(!trusted.includes(remote)||!c.env.CLIENT_IP_HEADER)return remote;
 const supplied=c.req.header(c.env.CLIENT_IP_HEADER)?.trim();
 return supplied&&isIP(supplied)?supplied:remote;
}
async function limit(c:Ctx){const key='personal-login:'+clientIp(c);const t=Date.now();const r=await c.env.DB.one<{count:number}>('INSERT INTO limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN limits.expires_at<? THEN 1 ELSE limits.count+1 END,expires_at=CASE WHEN limits.expires_at<? THEN excluded.expires_at ELSE limits.expires_at END RETURNING count',key,t+900000,t,t);if(r!.count>30)fail(429,'操作过于频繁，请稍后重试');}
async function session(c:Ctx,id:string){const raw=token();await c.env.DB.exec('INSERT INTO sessions(hash,user_id,expires_at) VALUES (?,?,?)',await digest(raw),id,Date.now()+8*3600000);setCookie(c,'tz_personal',raw,{path:'/',httpOnly:true,sameSite:'Strict',secure:c.env.ENVIRONMENT!=='local',maxAge:8*3600});deleteCookie(c,'tz_session',{path:'/'});}
const audit=(c:Ctx,actor:string,action:string,target:string)=>c.env.DB.statement('INSERT INTO audit(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)',crypto.randomUUID(),actor,action,target,Date.now());
async function initialized(c:Ctx){return !!await c.env.DB.one("SELECT id FROM users WHERE password_hash IS NOT NULL UNION ALL SELECT id FROM settings WHERE id='personal-account-initialized' LIMIT 1");}
export function publicAccounts(app:Hono<Env>){
 app.get('/api/accounts/setup-status',async c=>c.json({needsSetup:!!c.env.BOOTSTRAP_TOKEN_HASH&&!await initialized(c)}));
 app.post('/api/accounts/setup',async c=>{
  const b=account.extend({bootstrapToken:z.string().min(1).max(128)}).strict().parse(await json(c));await limit(c);
  if(await initialized(c))fail(409,'账号已初始化，请登录或联系管理员');
  if(!c.env.BOOTSTRAP_TOKEN_HASH||!verifyPassword(b.bootstrapToken,c.env.BOOTSTRAP_TOKEN_HASH))fail(401,'初始化凭证无效');
  const id=crypto.randomUUID();try{await c.env.DB.transactionBatch([
   c.env.DB.statement("INSERT INTO settings(id,value) VALUES ('personal-account-initialized','1')"),
   c.env.DB.statement("INSERT INTO users(id,username,display_name,password_hash,role,active,created_at) VALUES (?,?,?,?,'admin',1,?)",id,b.username,b.displayName,hashPassword(b.password),Date.now()),audit(c,id,'account.bootstrap',id)
  ]);}catch{fail(409,'初始化状态已变化，请刷新后登录');}
  await session(c,id);return c.json({ok:true},201);
 });
 app.post('/api/accounts/login',async c=>{
  const b=loginInput.strict().parse(await json(c));await limit(c);
  const u=await c.env.DB.one<any>('SELECT * FROM users WHERE username=? AND password_hash IS NOT NULL',b.username);
  if(!u||!verifyPassword(b.password,u.password_hash))fail(401,'账号或密码不正确');
  if(!u.active)fail(401,'账号已停用，请联系管理员');
  await session(c,u.id);return c.json({ok:true});
 });
}
export function privateAccounts(app:Hono<Env>){
 app.get('/api/admin/users',async c=>{admin(c);const rows=await c.env.DB.many<any>('SELECT id,username,display_name,role,active,created_at FROM users WHERE password_hash IS NOT NULL ORDER BY created_at,id');return c.json({items:rows.results.map(u=>({...u,role:publicRole(u.role)}))});});
 app.post('/api/admin/users',async c=>{
  const actor=admin(c),b=account.parse(await json(c)),id=crypto.randomUUID();
  try{await c.env.DB.transactionBatch([c.env.DB.statement("INSERT INTO users(id,username,display_name,password_hash,role,active,created_at) VALUES (?,?,?,?,'teacher',1,?)",id,b.username,b.displayName,hashPassword(b.password),Date.now()),audit(c,actor.id,'account.create',id)]);}catch(e){if((e as {code?:string}).code==='23505')fail(409,'账号已存在');throw e;}return c.json({id},201);
 });
 app.patch('/api/admin/users/:id',async c=>{
  const actor=admin(c),id=uuid.parse(c.req.param('id'));
  const b=z.union([profile.extend({expected:profile}).strict(),z.object({active:z.boolean()}).strict(),z.object({password:newPassword}).strict()]).parse(await json(c));
  const u=await c.env.DB.one<any>('SELECT id,role,active FROM users WHERE id=? AND password_hash IS NOT NULL',id);if(!u)fail(404,'账号不存在');
  if(id===actor.id)fail(409,'当前账号不支持在此修改，请联系另一位管理员');
  let sql:string,values:(number|string)[],action:string;
  if('username' in b){sql='UPDATE users SET username=?,display_name=? WHERE id=? AND username=? AND display_name=?';values=[b.username,b.displayName,id,b.expected.username,b.expected.displayName];action='account.profile';}
  else if('password' in b){sql='UPDATE users SET password_hash=? WHERE id=?';values=[hashPassword(b.password),id];action='account.password';}
  else{sql="UPDATE users SET active=? WHERE id=? AND active<>? AND NOT (?=0 AND role='admin' AND (SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND password_hash IS NOT NULL)<=1)";values=[+b.active,id,+b.active,+b.active];action=b.active?'account.enable':'account.disable';if(u.active===+b.active)return c.json({ok:true});}
  try{await c.env.DB.transaction(async tx=>{
   // Serialize account changes so two concurrent requests cannot disable the last administrators.
   await tx.query('SELECT pg_advisory_xact_lock(84351923)');
   const result=await tx.exec(sql,...values);
   if(!result.meta.changes)fail(409,'账号已被更新，或需要保留最后一位管理员，请刷新后重试');
   await tx.exec('INSERT INTO audit(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)',crypto.randomUUID(),actor.id,action,id,Date.now());
   if(!('username' in b))await tx.exec('DELETE FROM sessions WHERE user_id=?',id);
  });}catch(e){if((e as {code?:string}).code==='23505')fail(409,'账号已存在');throw e;}return c.json({ok:true});
 });
}
