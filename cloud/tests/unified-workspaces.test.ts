import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {migrate} from './migrations';
import {hashPassword,digest} from '../src/server/crypto';
import {cleanup} from '../src/server/cleanup';
import worker from '../src/server/index';
const uuid=()=>crypto.randomUUID();
test('R3 unified workspaces: roles, account conflicts, soft-delete boundary and sync',async t=>{
 const password=uuid()+uuid(),bootstrap=uuid();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'app',modules:true,scriptPath:resolve('.wrangler/test-bundle/index.js'),compatibilityDate:'2026-10-21',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{ENVIRONMENT:'local',BOOTSTRAP_TOKEN_HASH:hashPassword(bootstrap)},serviceBindings:{ASSETS:()=>new Response('static')}}]}));
 try{const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('MEDIA');await migrate(db);
 const call=(path:string,method='GET',body?:any,cookie='')=>mf.dispatchFetch('https://uat.test/api'+path,{method,headers:{Origin:'https://uat.test',Cookie:cookie,...(body?{'Content-Type':Buffer.isBuffer(body)?'image/png':'application/json'}:{})},body:body?(Buffer.isBuffer(body)?body:JSON.stringify(body)):undefined});
 const ok=async(path:string,method='GET',body?:any,cookie='')=>{const r=await call(path,method,body,cookie),v=await r.json() as any;assert.ok(r.ok,`${path}: ${r.status} ${JSON.stringify(v)}`);return v;};
 const cookie=(r:Response)=>r.headers.get('set-cookie')!.split(';')[0];
 const admin=cookie(await call('/accounts/setup','POST',{username:'admin',displayName:'管理员',password,bootstrapToken:bootstrap}));
 const eid=(await ok('/admin/users','POST',{username:'employee',displayName:'员工甲',password},admin)).id;
 const employee=cookie(await call('/accounts/login','POST',{username:'employee',password}));
 const bytes=await readFile('public/brand/male-avatar.png');
 async function member(name:string,confirmed=true){const m=await ok('/members','POST',{gender:'男',requestKey:uuid()},admin);if(!confirmed)return m;const photo=uuid(),snap=uuid();await ok(`/members/${m.id}/media/${photo}?kind=photo`,'PUT',bytes,admin);await ok(`/members/${m.id}/photo-sources/${photo}`,'PUT',bytes,admin);const profile=JSON.stringify({memberName:name,gender:'男',birth:'1990',edu:'本科'});await db.prepare('INSERT INTO snapshots(id,member_id,profile,editor,photo_id,card_id,thumb_id,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(snap,m.id,profile,'{}',photo,photo,photo,Date.now()).run();await db.prepare("UPDATE members SET confirmed_id=?,profile=?,photo_id=?,status='confirmed' WHERE id=?").bind(snap,profile,photo,m.id).run();return {...m,photo,snap};}
 let a:any,b:any,record:any;
 await t.test('single login, server role mapping, minimal account data and administration guards',async()=>{
  assert.equal((await ok('/status')).configured,true);assert.equal((await call('/login','POST',{code:'anything'})).status,410);
  const shared=uuid();await db.prepare('INSERT INTO access_sessions(hash,access_version,expires_at) VALUES (?,?,?)').bind(await digest(shared),'legacy',Date.now()+3600000).run();assert.equal((await call('/me','GET',undefined,'tz_session='+shared)).status,401);
  assert.equal((await ok('/me','GET',undefined,employee)).user.role,'employee');assert.equal((await db.prepare('SELECT role FROM users WHERE id=?').bind(eid).first<any>())!.role,'teacher');
  for(const path of ['/admin/users','/admin/members']){assert.equal((await call(path)).status,401);assert.equal((await call(path,'GET',undefined,employee)).status,403);}
  assert.equal((await call('/admin/members/'+uuid(),'DELETE',{version:0,operationId:uuid()},employee)).status,403);
  assert.equal((await call('/admin/users','POST',{username:'bad_role',displayName:'伪造',password,role:'admin'},admin)).status,400);
  const list=await ok('/admin/users','GET',undefined,admin);assert.equal(list.items.length,2);assert.ok(!JSON.stringify(list).includes('password'));assert.ok(!JSON.stringify(list).includes('workspace.internal'));
  assert.equal((await ok('/accounts/setup-status')).needsSetup,false);
 });
 await t.test('unique account concurrency, profile CAS, session preservation and reset revocation',async()=>{
  const r=await Promise.all([1,2].map(()=>call('/admin/users','POST',{username:'duplicate',displayName:'员工乙',password},admin)));assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);
  const body={username:'employee_renamed',displayName:'员工新姓名',expected:{username:'employee',displayName:'员工甲'}};
  await ok('/admin/users/'+eid,'PATCH',body,admin);assert.equal((await ok('/me','GET',undefined,employee)).user.displayName,'员工新姓名');assert.equal((await call('/admin/users/'+eid,'PATCH',{...body,displayName:'冲突'},admin)).status,409);
  await ok('/admin/users/'+eid,'PATCH',{password:password+'new'},admin);assert.equal((await call('/me','GET',undefined,employee)).status,401);
  assert.equal((await call('/accounts/login','POST',{username:'employee_renamed',password})).status,401);
  assert.equal((await call('/accounts/login','POST',{username:'employee_renamed',password:password+'new'})).status,200);
 });
 await t.test('admin sees drafts, confirmed projection wins pending changes, list contracts remain separate',async()=>{
  a=await member('甲方');b=await member('乙方');const draft=await member('未确认',false);
  await db.prepare("UPDATE members SET profile=?,status='pending' WHERE id=?").bind(JSON.stringify({memberName:'不得提前公开',gender:'女',birth:'2000'}),a.id).run();
  const all=await ok('/admin/members','GET',undefined,admin),published=await ok('/members?pageSize=16','GET',undefined,admin);
  assert.equal(all.total,3);assert.equal(all.pageSize,20);assert.equal(all.items.find((m:any)=>m.id===a.id).name,'甲方');assert.equal(all.items.find((m:any)=>m.id===draft.id).name,null);assert.equal(published.total,2);assert.equal(published.pageSize,16);
  assert.equal((await call('/admin/members?pageSize=16','GET',undefined,admin)).status,400);
  record=(await ok(`/members/${a.id}/service-records`,'POST',{counterpartId:b.id,appointmentAt:Date.now()-86400000,status:'completed',note:'历史留存',operationId:uuid()},admin)).record;
 });
 await t.test('soft delete is optimistic, idempotent, audited and preserves all rows and objects',async()=>{
  const orphan=uuid();await ok(`/members/${b.id}/media/${orphan}?kind=photo`,'PUT',bytes,admin);await db.prepare('UPDATE media SET created_at=? WHERE member_id=?').bind(Date.now()-8*86400000,b.id).run();
  const count=await db.prepare('SELECT count(*) AS n FROM snapshots').first<any>(),before=await ok('/sync','GET',undefined,admin),op={version:0,operationId:uuid()};
  assert.equal((await call('/admin/members/'+b.id,'DELETE',{...op,version:99},admin)).status,409);
  const races=await Promise.all([1,2].map(()=>ok('/admin/members/'+b.id,'DELETE',op,admin)));assert.deepEqual(races[0],races[1]);assert.equal((await call('/admin/members/'+b.id,'DELETE',{...op,version:1},admin)).status,409);
  assert.equal((await ok('/sync','GET',undefined,admin)).version,before.version+1);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM audit WHERE action='member.delete' AND target_id=?").bind(b.id).first<any>())!.n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM snapshots').first<any>())!.n,count!.n);
  await cleanup({DB:db,MEDIA:bucket} as any);assert.equal((await db.prepare('SELECT count(*) AS n FROM media WHERE member_id=?').bind(b.id).first<any>())!.n,2);assert.ok(await bucket.get(`members/${b.id}/${orphan}/photo`));
  assert.equal((await ok('/members','GET',undefined,admin)).total,1);
  assert.equal((await ok('/admin/members','GET',undefined,admin)).total,2);
 });
 await t.test('deleted owner cannot be reached by detail, media, source, draft, export, records or replay',async()=>{
  const paths=[`/members/${b.id}`,`/members/${b.id}?edit=1`,`/members/${b.id}/download`,`/media/${b.photo}`,`/members/${b.id}/photo-source`,`/members/${b.id}/photo-source?download=1`,`/members/${b.id}/service-overview`,`/members/${b.id}/service-records`,`/members/${b.id}/service-records/${uuid()}`,`/member-options?exclude=${b.id}`];
  for(const path of paths)assert.equal((await call(path,'GET',undefined,admin)).status,404,path);
  for(const [path,method,body] of [[`/members/${b.id}/gender`,'PUT',{gender:'女',version:1}],[`/members/${b.id}/draft`,'PUT',{}],[`/members/${b.id}/confirm`,'POST',{}],[`/members/${b.id}/media/${uuid()}?kind=photo`,'PUT',bytes],[`/members/${b.id}/photo-sources/${b.photo}`,'PUT',bytes]] as const)assert.equal((await call(path,method,body,admin)).status,404,path);
  const replayBody={counterpartId:b.id,appointmentAt:record.appointment_at,status:'completed',note:'历史留存',operationId:record.request_key};await ok('/admin/members/'+a.id,'DELETE',{version:0,operationId:uuid()},admin);assert.equal((await call(`/members/${a.id}/service-records`,'POST',replayBody,admin)).status,404);
 });
 await t.test('deleted counterpart keeps historical identity and count, permits same-counterpart corrections',async()=>{
  const owner=await member('保留会员'),other=await member('删除对象');const body={counterpartId:other.id,appointmentAt:Date.now()-10000,status:'completed',note:'完成',operationId:uuid()};const r=(await ok(`/members/${owner.id}/service-records`,'POST',body,admin)).record;
  await ok('/admin/members/'+other.id,'DELETE',{version:0,operationId:uuid()},admin);
  const detail=await ok(`/members/${owner.id}/service-records/${r.id}`,'GET',undefined,admin);assert.equal(detail.counterpart_deleted,1);assert.equal(detail.counterpart_name_snapshot,'删除对象');assert.equal((await ok(`/members/${owner.id}/service-overview`,'GET',undefined,admin)).completedCount,1);
  await ok(`/members/${owner.id}/service-records/${r.id}`,'PATCH',{...body,version:1,operationId:uuid(),reason:'补充备注',note:'已回访'},admin);
  assert.equal((await call(`/members/${owner.id}/service-records`,'POST',{...body,operationId:uuid()},admin)).status,400);
 });
 await t.test('archive during R2 upload cannot publish media; database guards reject service races',async()=>{
  const owner=await member('竞态测试',false),mid=uuid();const response=await worker.fetch(new Request(`https://uat.test/api/members/${owner.id}/media/${mid}?kind=photo`,{method:'PUT',headers:{Origin:'https://uat.test',Cookie:admin,'Content-Type':'image/png'},body:bytes}),{DB:db,MEDIA:{put:async(key:string,data:any)=>{await bucket.put(key,data);await db.prepare('UPDATE members SET archived=1 WHERE id=?').bind(owner.id).run();}},ENVIRONMENT:'local'} as any,{} as any);
  assert.equal(response.status,404);assert.equal((await db.prepare('SELECT state FROM media WHERE id=?').bind(mid).first<any>())!.state,'pending');assert.equal((await call('/media/'+mid,'GET',undefined,admin)).status,404);
  await assert.rejects(db.prepare('UPDATE service_records SET note=? WHERE id=?').bind('不得写入已删除会员',record.id).run(),/member_unavailable/);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
 }finally{await mf.dispose();}
});
