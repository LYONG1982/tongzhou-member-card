import type {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {admin,fail,json,numberFor} from './common';
import {uuid} from './validation';
import {digest} from './crypto';
export function adminMemberRoutes(app:Hono<Env>){
 app.get('/api/sync',async c=>{const r=await c.env.DB.one<{value:string}>("SELECT value FROM settings WHERE id='sync-version'");return c.json({version:Number(r?.value||0)});});
 app.get('/api/admin/members',async c=>{
  admin(c);const q=z.object({q:z.string().max(64).default(''),gender:z.enum(['','男','女']).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(c.req.query());
  const p='COALESCE(s.profile,m.profile)',e='COALESCE(s.editor,m.editor)',where=['m.archived=0'],args:string[]=[];
  if(q.gender){where.push(`COALESCE((${p})::jsonb->>'gender',m.gender)=?`);args.push(q.gender);}
  if(q.q){where.push(`((${p})::jsonb->>'memberName' LIKE ? ESCAPE '\\' OR ('TZ-'||lpad(m.seq::text,5,'0')) LIKE ? ESCAPE '\\' OR ('TZ-'||lpad(m.seq::text,6,'0')) LIKE ? ESCAPE '\\')`);const search='%'+q.q.replace(/[\\%_]/g,'\\$&')+'%';args.push(search,search,search);}
  const from=' FROM members m LEFT JOIN snapshots s ON s.id=m.confirmed_id AND s.member_id=m.id WHERE '+where.join(' AND ');
  const total=await c.env.DB.one<{n:number}>('SELECT count(*) AS n'+from,...args);
  const rows=await c.env.DB.many<any>(`SELECT m.id,m.seq,m.version,m.status,m.updated_at,m.confirmed_id,COALESCE((${p})::jsonb->>'gender',m.gender) AS gender,(${p})::jsonb->>'memberName' AS name,(${p})::jsonb->>'birth' AS birth,(${p})::jsonb->>'height' AS height,(${p})::jsonb->>'edu' AS edu,COALESCE(s.photo_id,m.photo_id) AS photo_id,(${e})::jsonb->>'template' AS template,(${e})::jsonb->>'transform' AS transform`+from+' ORDER BY m.updated_at DESC,m.seq DESC LIMIT 20 OFFSET ?',...args,(q.page-1)*20);
  return c.json({total:total!.n,page:q.page,pageSize:20,items:rows.results.map(m=>({...m,number:numberFor(m.seq),transform:m.transform?JSON.parse(m.transform):null}))});
 });
 app.delete('/api/admin/members/:id',async c=>{
  const actor=admin(c),id=uuid.parse(c.req.param('id')),b=z.object({version:z.number().int().min(0),operationId:uuid}).strict().parse(await json(c)),hash=await digest(JSON.stringify({delete:id,...b}));
  const replay=async()=>{const op=await c.env.DB.one<any>('SELECT * FROM operations WHERE id=?',b.operationId);if(!op)return null;if(op.member_id!==id||op.actor_id!==actor.id||op.digest!==hash)fail(409,'请求标识已被不同操作使用');return JSON.parse(op.result);};
  const old=await replay();if(old)return c.json(old);
  const m=await c.env.DB.one('SELECT id FROM members WHERE id=? AND archived=0',id);if(!m)fail(404,'会员不存在或已删除');
  const result={deleted:true,version:b.version+1,operationId:b.operationId},t=Date.now();
  await c.env.DB.transactionBatch([
   c.env.DB.statement(`UPDATE members SET archived=1,deleted_at=?,deleted_by=?,version=version+1,updated_at=?,last_operation=? WHERE id=? AND version=? AND archived=0 AND NOT EXISTS(SELECT 1 FROM media WHERE member_id=members.id AND state='deleting') AND NOT EXISTS(SELECT 1 FROM operations WHERE id=?)`,t,actor.id,t,b.operationId,id,b.version,b.operationId),
   c.env.DB.statement('INSERT INTO operations(id,member_id,actor_id,digest,result,created_at) SELECT ?,?,?,?,?,? FROM members WHERE id=? AND version=? AND last_operation=? AND archived=1 ON CONFLICT(id) DO NOTHING',b.operationId,id,actor.id,hash,JSON.stringify(result),t,id,result.version,b.operationId)
  ]);const saved=await replay();if(!saved)fail(409,'会员已被更新，或图片正在整理，请刷新后再次确认删除');return c.json(saved);
 });
}
