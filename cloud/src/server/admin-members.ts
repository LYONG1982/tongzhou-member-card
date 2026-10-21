import type {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {admin,fail,json,numberFor} from './common';
import {uuid} from './validation';
import {digest} from './crypto';
export function adminMemberRoutes(app:Hono<Env>){
 app.get('/api/sync',async c=>{const r=await c.env.DB.prepare("SELECT value FROM settings WHERE id='sync-version'").first<{value:string}>();return c.json({version:Number(r?.value||0)});});
 app.get('/api/admin/members',async c=>{
  admin(c);const q=z.object({q:z.string().max(64).default(''),gender:z.enum(['','男','女']).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(c.req.query());
  const p='COALESCE(s.profile,m.profile)',e='COALESCE(s.editor,m.editor)',where=['m.archived=0'],args:string[]=[];
  if(q.gender){where.push(`COALESCE(json_extract(${p},'$.gender'),m.gender)=?`);args.push(q.gender);}
  if(q.q){where.push(`(json_extract(${p},'$.memberName') LIKE ? ESCAPE '\\' OR ('TZ-'||printf('%05d',m.seq)) LIKE ? ESCAPE '\\' OR ('TZ-'||printf('%06d',m.seq)) LIKE ? ESCAPE '\\')`);const search='%'+q.q.replace(/[\\%_]/g,'\\$&')+'%';args.push(search,search,search);}
  const from=' FROM members m LEFT JOIN snapshots s ON s.id=m.confirmed_id AND s.member_id=m.id WHERE '+where.join(' AND ');
  const total=await c.env.DB.prepare('SELECT count(*) AS n'+from).bind(...args).first<{n:number}>();
  const rows=await c.env.DB.prepare(`SELECT m.id,m.seq,m.version,m.status,m.updated_at,m.confirmed_id,COALESCE(json_extract(${p},'$.gender'),m.gender) AS gender,json_extract(${p},'$.memberName') AS name,json_extract(${p},'$.birth') AS birth,json_extract(${p},'$.height') AS height,json_extract(${p},'$.edu') AS edu,COALESCE(s.photo_id,m.photo_id) AS photo_id,json_extract(${e},'$.template') AS template,json_extract(${e},'$.transform') AS transform`+from+' ORDER BY m.updated_at DESC,m.seq DESC LIMIT 20 OFFSET ?').bind(...args,(q.page-1)*20).all<any>();
  return c.json({total:total!.n,page:q.page,pageSize:20,items:rows.results.map(m=>({...m,number:numberFor(m.seq),transform:m.transform?JSON.parse(m.transform):null}))});
 });
 app.delete('/api/admin/members/:id',async c=>{
  const actor=admin(c),id=uuid.parse(c.req.param('id')),b=z.object({version:z.number().int().min(0),operationId:uuid}).strict().parse(await json(c)),hash=await digest(JSON.stringify({delete:id,...b}));
  const replay=async()=>{const op=await c.env.DB.prepare('SELECT * FROM operations WHERE id=?').bind(b.operationId).first<any>();if(!op)return null;if(op.member_id!==id||op.actor_id!==actor.id||op.digest!==hash)fail(409,'请求标识已被不同操作使用');return JSON.parse(op.result);};
  const old=await replay();if(old)return c.json(old);
  const m=await c.env.DB.prepare('SELECT id FROM members WHERE id=? AND archived=0').bind(id).first();if(!m)fail(404,'会员不存在或已删除');
  const result={deleted:true,version:b.version+1,operationId:b.operationId},t=Date.now();
  await c.env.DB.batch([
   c.env.DB.prepare(`UPDATE members SET archived=1,deleted_at=?,deleted_by=?,version=version+1,updated_at=?,last_operation=? WHERE id=? AND version=? AND archived=0 AND NOT EXISTS(SELECT 1 FROM media WHERE member_id=members.id AND state='deleting') AND NOT EXISTS(SELECT 1 FROM operations WHERE id=?)`).bind(t,actor.id,t,b.operationId,id,b.version,b.operationId),
   c.env.DB.prepare('INSERT INTO operations(id,member_id,actor_id,digest,result,created_at) SELECT ?,?,?,?,?,? FROM members WHERE id=? AND version=? AND last_operation=? AND archived=1 ON CONFLICT(id) DO NOTHING').bind(b.operationId,id,actor.id,hash,JSON.stringify(result),t,id,result.version,b.operationId)
  ]);const saved=await replay();if(!saved)fail(409,'会员已被更新，或图片正在整理，请刷新后再次确认删除');return c.json(saved);
 });
}
