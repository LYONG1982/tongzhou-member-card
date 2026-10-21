import {Hono} from 'hono';
import {getCookie,deleteCookie} from 'hono/cookie';
import {bodyLimit} from 'hono/body-limit';
import {HTTPException} from 'hono/http-exception';
import {z,ZodError} from 'zod';
import {cleanup} from './cleanup';
import {publicAccounts,privateAccounts,publicRole} from './accounts';
import {serviceRoutes} from './service-records';
import {photoSourceRoutes} from './photo-sources';
import {adminMemberRoutes} from './admin-members';
import {numberFor} from './common';
import type {Env,User} from './types';
import {digest} from './crypto';
import {uuid,gender,draftInput,confirmInput,imageInfo} from './validation';
const app=new Hono<Env>();
const now=()=>Date.now();
function fail(status:400|401|403|404|409|410|413|429|503,message:string):never {throw new HTTPException(status,{message});}
const cookieName='tz_session';
app.use('*',async(c,next)=>{
 c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');c.header('X-Frame-Options','DENY');
 c.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if(c.req.path.startsWith('/api/')){c.header('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(c.req.method)&&c.req.header('Origin')!==new URL(c.req.url).origin)fail(403,'请求来源无效，请刷新页面后重试');}
 await next();
});
app.use('/api/*',bodyLimit({maxSize:20*1024*1024,onError:c=>c.json({error:'文件超过 20MB'},413)}));
async function json(c:any){if(!c.req.header('content-type')?.startsWith('application/json'))fail(400,'请求格式无效');return c.req.json();}
async function rate(c:any,bucket:string,key:string,max:number,seconds=900){
 const k=bucket+':'+await digest(key);const expiry=now()+seconds*1000;
 const row=await c.env.DB.prepare(`INSERT INTO limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count`).bind(k,expiry,now(),now()).first();
 if(Number(row?.count)>max){c.header('Retry-After',String(seconds));fail(429,'操作过于频繁，请稍后重试');}
}
app.get('/api/status',c=>c.json({configured:true,version:'2.2.0'}));
app.post('/api/login',c=>c.json({error:'共享访问码已停用，请使用个人账号登录'},410));
publicAccounts(app);
app.use('/api/*',async(c,next)=>{
 const personalRaw=getCookie(c,'tz_personal');
 if(personalRaw){
  const h=await digest(personalRaw);const u=await c.env.DB.prepare('SELECT u.id,u.username,u.display_name AS displayName,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.active=1 AND u.password_hash IS NOT NULL').bind(h,now()).first<User>();
  if(!u)fail(401,'个人登录已过期或账号已停用，请重新登录');
  c.set('user',{...u,role:publicRole(u.role)});c.set('sessionHash',h);c.set('authKind','personal');await next();return;
 }
 fail(401,'请使用个人账号登录');
});
app.get('/api/me',c=>c.json({ok:true,user:c.get('user'),authKind:c.get('authKind')}));
privateAccounts(app);
adminMemberRoutes(app);
serviceRoutes(app);
photoSourceRoutes(app);
app.post('/api/logout',async c=>{await c.env.DB.batch([c.env.DB.prepare('DELETE FROM access_sessions WHERE hash=?').bind(c.get('sessionHash')),c.env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(c.get('sessionHash'))]);deleteCookie(c,cookieName,{path:'/'});deleteCookie(c,'tz_personal',{path:'/'});return c.json({ok:true});});
async function member(c:any,id:string){uuid.parse(id);const m=await c.env.DB.prepare('SELECT m.*,u.display_name AS owner_name FROM members m JOIN users u ON u.id=m.owner_id WHERE m.id=? AND m.archived=0').bind(id).first();if(!m)fail(404,'会员记录不存在');return m;}
function writable(_c:any,m:any){if(m.archived)fail(409,'此历史记录暂不可修改');}
function cleanMember(m:any){return {id:m.id,number:numberFor(m.seq),ownerId:m.owner_id,ownerName:m.owner_name,gender:m.gender,profile:JSON.parse(m.profile),editor:JSON.parse(m.editor),photoId:m.photo_id,version:m.version,status:m.status,archived:!!m.archived,confirmedId:m.confirmed_id,createdAt:m.created_at,updatedAt:m.updated_at};}
async function priorOperation(c:any,id:string,memberId:string,hash:string){const op=await c.env.DB.prepare('SELECT * FROM operations WHERE id=?').bind(id).first();if(!op)return null;if(op.member_id!==memberId||op.actor_id!==c.get('user').id||op.digest!==hash)fail(409,'请求标识已被不同操作使用');return JSON.parse(op.result);}
async function requireMedia(c:any,id:string,memberId:string,kind:string){const found=await c.env.DB.prepare("SELECT id FROM media WHERE id=? AND member_id=? AND kind=? AND state='ready'").bind(id,memberId,kind).first();if(!found)fail(400,'图片未上传完成，或与当前会员不匹配');}
app.post('/api/members',async c=>{
 const b=z.object({requestKey:uuid,gender}).parse(await json(c));const user=c.get('user');
 const existing=await c.env.DB.prepare('SELECT id FROM members WHERE owner_id=? AND request_key=?').bind(user.id,b.requestKey).first<{id:string}>();
 if(existing)return c.json(cleanMember(await member(c,existing.id)));
 await rate(c,'create',user.id,100,3600);
 if(await c.env.DB.prepare('SELECT seq FROM members WHERE seq>=999999 LIMIT 1').first())fail(409,'六位编号已用完，请联系管理员');
 const id=crypto.randomUUID();
 await c.env.DB.prepare("INSERT INTO members(id,owner_id,request_key,gender,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM members WHERE owner_id=? AND request_key=?) AND COALESCE((SELECT seq FROM sqlite_sequence WHERE name='members'),0)<999999 ON CONFLICT(owner_id,request_key) DO NOTHING").bind(id,user.id,b.requestKey,b.gender,now(),now(),user.id,b.requestKey).run();
 const row=await c.env.DB.prepare('SELECT id FROM members WHERE owner_id=? AND request_key=?').bind(user.id,b.requestKey).first<{id:string}>();if(!row)fail(409,'六位编号已用完，请联系管理员');return c.json(cleanMember(await member(c,row.id)),201);
});
app.get('/api/members',async c=>{
 const q=z.object({q:z.string().max(64).default(''),gender:z.enum(['','男','女']).default(''),marital:z.enum(['','unmarried','divorced']).default(''),decade:z.enum(['','1970','1980','1990','2000']).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(v=>v===16||v===24,'每页数量仅支持16或24').default(24)}).strict().parse(c.req.query());
 const conditions=['m.archived=0'],args:(string|number)[]=[];
 if(q.gender){conditions.push("json_extract(s.profile,'$.gender')=?");args.push(q.gender);}
 if(q.marital==='unmarried')conditions.push("json_extract(s.profile,'$.marital')='未婚'");
 if(q.marital==='divorced')conditions.push("json_extract(s.profile,'$.marital') IN ('离异','离异未育','短婚未育','离异有孩（不随身）','离异有孩')");
 if(q.decade){conditions.push("CAST(json_extract(s.profile,'$.birth') AS INTEGER) BETWEEN ? AND ?");args.push(Number(q.decade),Number(q.decade)+9);}
 if(q.q){conditions.push("(json_extract(s.profile,'$.memberName') LIKE ? ESCAPE '\\' OR ('TZ-' || printf('%05d',m.seq)) LIKE ? ESCAPE '\\' OR ('TZ-' || printf('%06d',m.seq)) LIKE ? ESCAPE '\\')");const search='%'+q.q.replace(/[\\%_]/g,'\\$&')+'%';args.push(search,search,search);}
 const from=' FROM members m JOIN snapshots s ON s.id=m.confirmed_id AND s.member_id=m.id WHERE '+conditions.join(' AND ');
 const total=await c.env.DB.prepare('SELECT count(*) AS n'+from).bind(...args).first<{n:number}>();
 const rows=await c.env.DB.prepare("SELECT m.id,m.seq,json_extract(s.profile,'$.memberName') AS name,json_extract(s.profile,'$.birth') AS birth,json_extract(s.profile,'$.gender') AS gender,json_extract(s.profile,'$.height') AS height,json_extract(s.profile,'$.edu') AS edu,json_extract(s.profile,'$.marital') AS marital,json_extract(s.profile,'$.ethnic') AS ethnic,s.created_at AS updated_at,s.thumb_id,s.card_id,s.photo_id,json_extract(s.editor,'$.template') AS template,json_extract(s.editor,'$.transform') AS transform"+from+' ORDER BY s.created_at DESC,m.seq DESC LIMIT ? OFFSET ?').bind(...args,q.pageSize,(q.page-1)*q.pageSize).all<any>();
 return c.json({total:total!.n,page:q.page,pageSize:q.pageSize,items:rows.results.map(m=>({...m,transform:m.transform?JSON.parse(m.transform):null,number:numberFor(m.seq)}))});
});
app.get('/api/members/:id',async c=>{
 const m=await member(c,c.req.param('id'));let confirmed=null;
 if(m.confirmed_id){const s=await c.env.DB.prepare('SELECT * FROM snapshots WHERE id=? AND member_id=?').bind(m.confirmed_id,m.id).first<any>();if(s)confirmed={id:s.id,profile:JSON.parse(s.profile),editor:JSON.parse(s.editor),photoId:s.photo_id,cardId:s.card_id,thumbId:s.thumb_id,createdAt:s.created_at};}
 if(c.req.query('edit')==='1')return c.json({...cleanMember(m),confirmed});
 if(!confirmed)fail(404,'此会员尚未保存卡片');
 return c.json({id:m.id,number:numberFor(m.seq),version:m.version,profile:confirmed.profile,editor:confirmed.editor,photoId:confirmed.photoId,confirmed,updatedAt:confirmed.createdAt});
});
app.put('/api/members/:id/gender',async c=>{
 const m=await member(c,c.req.param('id'));writable(c,m);const b=z.object({gender,version:z.number().int().min(0)}).parse(await json(c));
 if(m.status!=='draft')fail(409,'请在编辑表单中修改性别并重新生成');
 if(m.gender===b.gender)return c.json(cleanMember(m));
 const results=await c.env.DB.batch([c.env.DB.prepare('UPDATE members SET gender=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(b.gender,now(),m.id,b.version),c.env.DB.prepare('INSERT INTO audit(id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),c.get('user').id,'member.gender',m.id,now())]);if(!results[0].meta.changes)fail(409,'记录已更新，请重新打开');return c.json(cleanMember(await member(c,m.id)));
});
app.put('/api/members/:id/media/:mediaId',async c=>{
 const m=await member(c,c.req.param('id'));writable(c,m);const id=uuid.parse(c.req.param('mediaId')),kind=z.enum(['photo','card','thumb']).parse(c.req.query('kind'));
 await rate(c,'upload',c.get('user').id,200,3600);
 const type=c.req.header('Content-Type')||'',bytes=await c.req.arrayBuffer();if(bytes.byteLength>20*1024*1024)fail(413,'图片超过 20MB');
 let info;try{info=imageInfo(bytes,type);}catch(e){fail(400,(e as Error).message);}
 if(kind==='card'&&(type!=='image/png'||info!.width!==1440||info!.height!==1080))fail(400,'成品必须为 1440×1080 PNG');
 if(kind==='thumb'&&(info!.width!==480||info!.height!==360))fail(400,'缩略图必须为 480×360');
 const hash=await digest(bytes),key=`members/${m.id}/${id}/${kind}`;
 await c.env.DB.prepare("INSERT INTO media(id,member_id,kind,object_key,digest,content_type,size,width,height,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(id,m.id,kind,key,hash,type,bytes.byteLength,info!.width,info!.height,now()).run();
 const row=await c.env.DB.prepare('SELECT * FROM media WHERE id=?').bind(id).first<any>();
 if(row.member_id!==m.id||row.kind!==kind||row.digest!==hash)fail(409,'图片请求冲突，请重新生成');if(row.state==='deleting')fail(410,'临时图片已过期，请重新上传');
 if(row.state!=='ready'){
 const lease=await c.env.DB.prepare("UPDATE media SET created_at=? WHERE id=? AND state='pending'").bind(now(),id).run();
 if(!lease.meta.changes)fail(409,'图片状态已变化，请重试');
 await c.env.MEDIA.put(key,bytes,{httpMetadata:{contentType:type},customMetadata:{sha256:hash}});
 const r=await c.env.DB.prepare("UPDATE media SET state='ready' WHERE id=? AND state='pending'").bind(id).run();if(!r.meta.changes&&!await c.env.DB.prepare("SELECT id FROM media WHERE id=? AND state='ready'").bind(id).first())fail(409,'上传状态改变，请重试');
 }
 await member(c,m.id);return c.json({id,size:bytes.byteLength,...info});
});
app.put('/api/members/:id/draft',async c=>{
 const m=await member(c,c.req.param('id'));writable(c,m);const b=draftInput.parse(await json(c)),hash=await digest(JSON.stringify(b));const old=await priorOperation(c,b.operationId,m.id,hash);if(old)return c.json(old);
 await requireMedia(c,b.photoId,m.id,'photo');const version=b.version+1;
 const result={version,operationId:b.operationId};
 await c.env.DB.batch([
 c.env.DB.prepare("UPDATE members SET profile=?,editor=?,photo_id=?,name=?,birth=?,gender=?,version=version+1,status='pending',last_operation=?,updated_at=? WHERE id=? AND version=? AND archived=0 AND EXISTS(SELECT 1 FROM media WHERE id=? AND state='ready') AND NOT EXISTS(SELECT 1 FROM operations WHERE id=?)").bind(JSON.stringify(b.profile),JSON.stringify(b.editor),b.photoId,b.profile.memberName,b.profile.birth,b.profile.gender,b.operationId,now(),m.id,b.version,b.photoId,b.operationId),
 c.env.DB.prepare('INSERT INTO operations(id,member_id,actor_id,digest,result,created_at) SELECT ?,?,?,?,?,? FROM members WHERE id=? AND version=? AND last_operation=? ON CONFLICT(id) DO NOTHING').bind(b.operationId,m.id,c.get('user').id,hash,JSON.stringify(result),now(),m.id,version,b.operationId)
 ]);
 const saved=await priorOperation(c,b.operationId,m.id,hash);if(!saved)fail(409,'记录已在其他页面更新，请返回列表重新打开');return c.json(saved);
});
app.post('/api/members/:id/confirm',async c=>{
 const m=await member(c,c.req.param('id'));writable(c,m);const b=confirmInput.parse(await json(c)),hash=await digest(JSON.stringify(b));const old=await priorOperation(c,b.operationId,m.id,hash);if(old)return c.json(old);
 if(m.version!==b.version||m.status==='draft'||!m.photo_id)fail(409,'预览资料已变化，请重新生成');
 const savedEditor=JSON.parse(m.editor);if(JSON.stringify(savedEditor.transform)!==JSON.stringify(b.editor.transform))fail(409,'照片构图改变，请重新生成');
 await requireMedia(c,b.cardId,m.id,'card');await requireMedia(c,b.thumbId,m.id,'thumb');await requireMedia(c,m.photo_id,m.id,'photo');
 const version=b.version+1,result={version,confirmedId:b.operationId,operationId:b.operationId};
 await c.env.DB.batch([
 c.env.DB.prepare("INSERT INTO snapshots(id,member_id,profile,editor,photo_id,card_id,thumb_id,created_at) SELECT ?,id,profile,?,photo_id,?,?,? FROM members WHERE id=? AND version=? AND archived=0 AND EXISTS(SELECT 1 FROM media WHERE id=? AND state='ready') AND EXISTS(SELECT 1 FROM media WHERE id=? AND state='ready') AND NOT EXISTS(SELECT 1 FROM operations WHERE id=?) ON CONFLICT(id) DO NOTHING").bind(b.operationId,JSON.stringify(b.editor),b.cardId,b.thumbId,now(),m.id,b.version,b.cardId,b.thumbId,b.operationId),
 c.env.DB.prepare("UPDATE members SET confirmed_id=?,editor=?,status='confirmed',version=version+1,last_operation=?,updated_at=? WHERE id=? AND version=? AND archived=0 AND EXISTS(SELECT 1 FROM snapshots WHERE id=? AND member_id=members.id)").bind(b.operationId,JSON.stringify(b.editor),b.operationId,now(),m.id,b.version,b.operationId),
 c.env.DB.prepare('INSERT INTO operations(id,member_id,actor_id,digest,result,created_at) SELECT ?,?,?,?,?,? FROM members WHERE id=? AND version=? AND last_operation=? ON CONFLICT(id) DO NOTHING').bind(b.operationId,m.id,c.get('user').id,hash,JSON.stringify(result),now(),m.id,version,b.operationId)
 ]);
 const saved=await priorOperation(c,b.operationId,m.id,hash);if(!saved)fail(409,'保存冲突，请重新读取会员资料');return c.json(saved);
});
app.get('/api/media/:id',async c=>{
 const id=uuid.parse(c.req.param('id'));
 const row=await c.env.DB.prepare("SELECT a.* FROM media a WHERE a.id=? AND a.state='ready' AND EXISTS(SELECT 1 FROM members owner WHERE owner.id=a.member_id AND owner.archived=0) AND (EXISTS(SELECT 1 FROM members m WHERE m.photo_id=a.id) OR EXISTS(SELECT 1 FROM snapshots s WHERE s.photo_id=a.id OR s.card_id=a.id OR s.thumb_id=a.id))").bind(id).first<any>();
 if(!row)fail(404,'图片尚未关联或已失效');const object=await c.env.MEDIA.get(row.object_key);if(!object)fail(503,'图片暂时无法读取，请稍后重试');
 c.header('Content-Type',row.content_type);c.header('Content-Length',String(object.size));c.header('Cache-Control','private, no-store');return c.body(object.body as any);
});
app.get('/api/members/:id/download',async c=>{
 const m=await member(c,c.req.param('id'));if(!m.confirmed_id)fail(404,'尚未保存最终成品');
 const snap=await c.env.DB.prepare('SELECT s.profile,a.object_key,a.content_type FROM snapshots s JOIN media a ON a.id=s.card_id WHERE s.id=? AND s.member_id=?').bind(m.confirmed_id,m.id).first<any>();if(!snap)fail(404,'成品不存在');
 const p=JSON.parse(snap.profile),name=p.memberName.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').replace(/[. ]+$/g,'')||'未命名';
 const filename=`${numberFor(m.seq)}_${name}_${p.birth}_${p.gender}.png`,object=await c.env.MEDIA.get(snap.object_key);if(!object)fail(503,'成品暂不可用，请重试');
 c.header('Content-Type','image/png');c.header('Cache-Control','private, no-store');c.header('Content-Disposition',"attachment; filename=member-card.png; filename*=UTF-8''"+encodeURIComponent(filename));return c.body(object.body as any);
});
app.all('/api/*',c=>c.json({error:'接口不存在'},404));
app.onError((error,c)=>{if(String(error).includes('member_unavailable'))return c.json({error:'会员不存在或已删除'},404);if(error instanceof ZodError)return c.json({error:error.issues[0]?.message||'输入无效'},400);if(error instanceof HTTPException)return c.json({error:error.message},error.status);console.error('request_failed',error.name);return c.json({error:'服务暂不可用，请稍后重试；当前编辑内容仍保留'},503);});
app.all('*',c=>c.env.ASSETS.fetch(c.req.raw));
export default {fetch:app.fetch,scheduled:(_event:ScheduledController,env:Env['Bindings'],ctx:ExecutionContext)=>{ctx.waitUntil(cleanup(env));}};
