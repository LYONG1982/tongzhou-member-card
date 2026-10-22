import type {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {uuid} from './validation';
import {digest} from './crypto';
import {fail,json,personal,numberFor,type Ctx} from './common';
const input=z.object({counterpartId:uuid,appointmentAt:z.number().int().min(0).max(8640000000000000),status:z.enum(['pending','completed','cancelled','no_show']),note:z.string().trim().max(300),operationId:uuid}).strict();
async function member(c:Ctx,id:string){uuid.parse(id);const m=await c.env.DB.one<any>('SELECT id,archived FROM members WHERE id=? AND archived=0',id);if(!m)fail(404,'会员不存在');return m;}
async function overview(c:Ctx,id:string){const db=c.env.DB;const [count,latestCompleted,latestPending]=await Promise.all([
 db.one<{n:number}>("SELECT COUNT(*) AS n FROM service_records WHERE owner_member_id=? AND status='completed'",id),
 db.one("SELECT r.*,(SELECT archived FROM members WHERE id=r.counterpart_member_id) AS counterpart_deleted FROM service_records r WHERE owner_member_id=? AND status='completed' ORDER BY appointment_at DESC,id DESC LIMIT 1",id),
 db.one("SELECT r.*,(SELECT archived FROM members WHERE id=r.counterpart_member_id) AS counterpart_deleted FROM service_records r WHERE owner_member_id=? AND status='pending' ORDER BY appointment_at DESC,id DESC LIMIT 1",id)
 ]);return {completedCount:count!.n,latestCompleted,latestPending};}
async function validate(c:Ctx,id:string,b:z.infer<typeof input>,old?:any){
 if((await member(c,id)).archived)fail(409,'归档会员不可新增或修改记录');if(id===b.counterpartId)fail(400,'约见对象不能是当前会员');
 if(b.appointmentAt>Date.now()&&['completed','no_show'].includes(b.status))fail(400,'未来约见不能标记为已完成或未到场');
 const m=await c.env.DB.one<any>("SELECT m.id,m.seq,s.profile::jsonb->>'memberName' AS name FROM members m JOIN snapshots s ON s.id=m.confirmed_id WHERE m.id=? AND m.archived=0",b.counterpartId);if(!m){if(old?.counterpart_member_id===b.counterpartId)return {id:old.counterpart_member_id,name:old.counterpart_name_snapshot,seq:Number(old.counterpart_number_snapshot.slice(3))};fail(400,'请选择有效的约见会员');}return m;
}
async function prior(c:Ctx,id:string,hash:string,owner:string){await member(c,owner);const r=await c.env.DB.one<any>('SELECT v.*,r.owner_member_id FROM service_record_revisions v JOIN service_records r ON r.id=v.record_id WHERE v.id=?',id);if(!r)return null;if(r.digest!==hash||r.actor_id!==c.get('user').id||r.owner_member_id!==owner)fail(409,'操作标识与其他请求冲突');return JSON.parse(r.after_data);}
export function serviceRoutes(app:Hono<Env>){
 app.get('/api/member-options',async c=>{const q=z.object({q:z.string().max(64).default(''),exclude:uuid}).parse(c.req.query());await member(c,q.exclude);const search='%'+q.q.replace(/[\\%_]/g,'\\$&')+'%';const rows=await c.env.DB.many<any>("SELECT m.id,m.seq,s.profile::jsonb->>'memberName' AS name FROM members m JOIN snapshots s ON s.id=m.confirmed_id WHERE m.archived=0 AND m.id<>? AND ((s.profile::jsonb->>'memberName') LIKE ? ESCAPE '\\' OR ('TZ-'||lpad(m.seq::text,5,'0')) LIKE ? ESCAPE '\\' OR ('TZ-'||lpad(m.seq::text,6,'0')) LIKE ? ESCAPE '\\') ORDER BY m.seq DESC LIMIT 20",q.exclude,search,search,search);return c.json({items:rows.results.map(r=>({id:r.id,name:r.name,number:numberFor(r.seq)}))});});
 app.get('/api/members/:id/service-overview',async c=>{const m=await member(c,c.req.param('id'));return c.json(await overview(c,m.id));});
 app.get('/api/members/:id/service-records',async c=>{const m=await member(c,c.req.param('id'));const page=z.coerce.number().int().min(1).max(100000).parse(c.req.query('page')||1);const total=await c.env.DB.one<{n:number}>('SELECT count(*) AS n FROM service_records WHERE owner_member_id=?',m.id);const rows=await c.env.DB.many('SELECT r.*,(SELECT archived FROM members WHERE id=r.counterpart_member_id) AS counterpart_deleted FROM service_records r WHERE owner_member_id=? ORDER BY appointment_at DESC,id DESC LIMIT 8 OFFSET ?',m.id,(page-1)*8);return c.json({items:rows.results,total:total!.n,page,pageSize:8});});
 app.get('/api/members/:id/service-records/:record',async c=>{await member(c,c.req.param('id'));uuid.parse(c.req.param('record'));const r=await c.env.DB.one<any>('SELECT r.*,(SELECT archived FROM members WHERE id=r.counterpart_member_id) AS counterpart_deleted FROM service_records r WHERE id=? AND owner_member_id=?',c.req.param('record'),c.req.param('id'));if(!r)fail(404,'服务记录不存在');const user=c.get('user');const history=await c.env.DB.many('SELECT v.id,v.before_data,v.after_data,v.reason,v.created_at,u.display_name AS actor_name FROM service_record_revisions v JOIN users u ON u.id=v.actor_id WHERE record_id=? ORDER BY v.created_at DESC,v.id DESC',r.id);return c.json({...r,canEdit:c.get('authKind')==='personal'&&(user.role==='admin'||r.created_by===user.id),history:history.results});});
 app.post('/api/members/:id/service-records',async c=>{
  const actor=personal(c),id=c.req.param('id'),b=input.parse(await json(c)),hash=await digest(JSON.stringify(b));const previous=await prior(c,b.operationId,hash,id);if(previous)return c.json({record:previous,overview:await overview(c,id)});
  const other=await validate(c,id,b),time=Date.now();const r={id:crypto.randomUUID(),owner_member_id:id,counterpart_member_id:other.id,counterpart_name_snapshot:other.name,counterpart_number_snapshot:numberFor(other.seq),appointment_at:b.appointmentAt,status:b.status,note:b.note,created_by:actor.id,recorder_name_snapshot:actor.displayName,updated_by:actor.id,created_at:time,updated_at:time,version:1,request_key:b.operationId,last_operation:b.operationId};
  const keys=Object.keys(r);await c.env.DB.transactionBatch([
   c.env.DB.statement(`INSERT INTO service_records(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT(request_key) DO NOTHING`,...Object.values(r)),
   c.env.DB.statement('INSERT INTO service_record_revisions(id,record_id,actor_id,digest,before_data,after_data,reason,created_at) SELECT ?,id,?,?,NULL,?,?,? FROM service_records WHERE id=? AND last_operation=? ON CONFLICT(id) DO NOTHING',b.operationId,actor.id,hash,JSON.stringify(r),'创建记录',time,r.id,b.operationId)
  ]);const saved=await prior(c,b.operationId,hash,id);if(!saved)fail(409,'记录已提交，请刷新后查看');return c.json({record:saved,overview:await overview(c,id)},201);
 });
 app.patch('/api/members/:id/service-records/:record',async c=>{
  const actor=personal(c),id=c.req.param('id'),rid=uuid.parse(c.req.param('record'));const b=input.extend({version:z.number().int().min(1),reason:z.string().trim().max(300)}).parse(await json(c));const hash=await digest(JSON.stringify({record:rid,...b}));const previous=await prior(c,b.operationId,hash,id);if(previous)return c.json({record:previous,overview:await overview(c,id)});
  const old=await c.env.DB.one<any>('SELECT * FROM service_records WHERE id=? AND owner_member_id=?',rid,id);if(!old)fail(404,'记录不存在');if(actor.role!=='admin'&&old.created_by!==actor.id)fail(403,'只能更正自己登记的记录');if(old.version!==b.version)fail(409,'记录已被更新，请重新查看后更正');if(!b.reason)fail(400,'请填写更正原因');const other=await validate(c,id,b,old);
  const r={...old,counterpart_member_id:other.id,counterpart_name_snapshot:other.name,counterpart_number_snapshot:numberFor(other.seq),appointment_at:b.appointmentAt,status:b.status,note:b.note,updated_by:actor.id,updated_at:Date.now(),version:old.version+1,last_operation:b.operationId};
  await c.env.DB.transactionBatch([
   c.env.DB.statement('UPDATE service_records SET counterpart_member_id=?,counterpart_name_snapshot=?,counterpart_number_snapshot=?,appointment_at=?,status=?,note=?,updated_by=?,updated_at=?,version=version+1,last_operation=? WHERE id=? AND version=?',r.counterpart_member_id,r.counterpart_name_snapshot,r.counterpart_number_snapshot,r.appointment_at,r.status,r.note,actor.id,r.updated_at,b.operationId,rid,b.version),
   c.env.DB.statement('INSERT INTO service_record_revisions(id,record_id,actor_id,digest,before_data,after_data,reason,created_at) SELECT ?,id,?,?,?,?,?,? FROM service_records WHERE id=? AND last_operation=? AND version=? ON CONFLICT(id) DO NOTHING',b.operationId,actor.id,hash,JSON.stringify(old),JSON.stringify(r),b.reason,r.updated_at,rid,b.operationId,r.version)
  ]);const saved=await prior(c,b.operationId,hash,id);if(!saved)fail(409,'记录已被更新，请重新查看后更正');return c.json({record:saved,overview:await overview(c,id)});
 });
}
