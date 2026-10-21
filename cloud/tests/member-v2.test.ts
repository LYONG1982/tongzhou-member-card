import test from 'node:test';
import {migrate} from './migrations';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {hashPassword} from '../src/server/crypto.ts';
import {cleanup} from '../src/server/cleanup.ts';
const uuid=()=>crypto.randomUUID();
test('V2: identities, single-member records, revisions, original files and compatibility',async t=>{
 const code=uuid(),password=uuid()+uuid();const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'app',modules:true,scriptPath:resolve('.wrangler/test-bundle/index.js'),compatibilityDate:'2026-10-21',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{ENVIRONMENT:'local',BOOTSTRAP_TOKEN_HASH:hashPassword(code)},serviceBindings:{ASSETS:()=>new Response('static')}}]}));
 try{
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('MEDIA');await migrate(db);
 async function call(path:string,method='GET',body?:any,cookie=''){return mf.dispatchFetch('https://test.local/api'+path,{method,headers:{Origin:'https://test.local',Cookie:cookie,...(body?{'Content-Type':body instanceof Buffer?'image/png':'application/json'}:{})},body:body?body instanceof Buffer?body:JSON.stringify(body):undefined});}
 async function ok(path:string,method='GET',body?:any,cookie=''){const r=await call(path,method,body,cookie);const b=await r.json() as any;assert.ok(r.ok,`${path} ${r.status} ${JSON.stringify(b)}`);return b;}
 const cookie=(r:Response)=>r.headers.get('set-cookie')!.split(';')[0];
 const shared='tz_session='+uuid().replaceAll('-','').repeat(2);assert.equal((await call('/login','POST',{code})).status,410);let admin='',teacher='',otherTeacher='',teacherId='';
 await t.test('one-time bootstrap and personal account authority',async()=>{
  assert.equal((await ok('/accounts/setup-status')).needsSetup,true);
  assert.equal((await call('/accounts/setup','POST',{username:'root',displayName:'验收管理员',password,bootstrapToken:'wrong'})).status,401);
  const r=await call('/accounts/setup','POST',{username:'root',displayName:'验收管理员',password,bootstrapToken:code});assert.equal(r.status,201);admin=cookie(r);
  assert.equal((await call('/accounts/setup','POST',{username:'again',displayName:'重复',password,bootstrapToken:code})).status,409);
  assert.equal((await ok('/me','GET',undefined,admin)).authKind,'personal');
  assert.equal((await call('/admin/users','GET',undefined,shared)).status,401);
  teacherId=(await ok('/admin/users','POST',{username:'teacher',displayName:'验收老师甲',password},admin)).id;
  await ok('/admin/users','POST',{username:'teacher2',displayName:'验收老师乙',password},admin);
  teacher=cookie(await call('/accounts/login','POST',{username:'teacher',password}));otherTeacher=cookie(await call('/accounts/login','POST',{username:'teacher2',password}));
  assert.equal((await call('/admin/users','POST',{username:'forged',displayName:'越权',password},teacher)).status,403);
 });
 const originals=await readFile('public/brand/male-avatar.png');const a=await ok('/members','POST',{requestKey:uuid(),gender:'男'},admin),b=await ok('/members','POST',{requestKey:uuid(),gender:'女'},admin);
 const photo=uuid();await ok(`/members/${b.id}/media/${photo}?kind=photo`,'PUT',originals,admin);
 // Disposable DB fixture: a confirmed counterpart; no user workspace data is touched.
 const snap=uuid();const profile={memberName:'虚构对象',gender:'女',birth:'1992'};
 await db.prepare('INSERT INTO snapshots(id,member_id,profile,editor,photo_id,card_id,thumb_id,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(snap,b.id,JSON.stringify(profile),'{}',photo,photo,photo,Date.now()).run();
 await db.prepare('UPDATE members SET confirmed_id=?,photo_id=? WHERE id=?').bind(snap,photo,b.id).run();
 let record:any;const base={counterpartId:b.id,appointmentAt:Date.now()-86400000,status:'pending',note:'初次约见安排',operationId:uuid()};
 await t.test('single-owner creation, validation, retries and no counterpart count',async()=>{
  assert.equal((await call(`/members/${a.id}/service-records`,'POST',base,shared)).status,401);
  assert.equal((await call(`/members/${a.id}/service-records`,'POST',{...base,createdBy:'forged'},teacher)).status,400);
  assert.equal((await call(`/members/${a.id}/service-records`,'POST',{...base,counterpartId:a.id},teacher)).status,400);
  assert.equal((await call(`/members/${a.id}/service-records`,'POST',{...base,status:'completed',appointmentAt:Date.now()+86400000},teacher)).status,400);
  const retries=await Promise.all([1,2,3].map(()=>ok(`/members/${a.id}/service-records`,'POST',base,teacher)));record=retries[0].record;assert.equal(new Set(retries.map(r=>r.record.id)).size,1);
  assert.equal(record.created_by,teacherId);assert.equal(record.recorder_name_snapshot,'验收老师甲');
  assert.equal((await ok(`/members/${a.id}/service-records`,'GET',undefined,teacher)).total,1);
  assert.equal((await ok(`/members/${b.id}/service-records`,'GET',undefined,teacher)).total,0);
  assert.equal((await ok(`/members/${a.id}/service-overview`,'GET',undefined,teacher)).completedCount,0);
 });
 await t.test('state correction, immutable actor, optimistic concurrency and history',async()=>{
  const update={...base,status:'completed',version:record.version,operationId:uuid(),reason:'确认双方已到场'};
  assert.equal((await call(`/members/${a.id}/service-records/${record.id}`,'PATCH',update,otherTeacher)).status,403);
  assert.equal((await call(`/members/${b.id}/service-records/${record.id}`,'PATCH',update,teacher)).status,404);
  const r=await ok(`/members/${a.id}/service-records/${record.id}`,'PATCH',update,teacher);assert.equal(r.overview.completedCount,1);assert.equal(r.overview.latestPending,null);assert.equal(r.record.created_by,teacherId);
  assert.equal((await ok(`/members/${a.id}/service-records/${record.id}`,'PATCH',update,teacher)).record.version,2);
  assert.equal((await call(`/members/${a.id}/service-records/${record.id}`,'PATCH',{...update,operationId:uuid()},teacher)).status,409);
  const current=await ok(`/members/${a.id}/service-records/${record.id}`,'GET',undefined,teacher);assert.equal(current.history.length,2);assert.equal(JSON.parse(current.history[0].before_data).status,'pending');
  const races=await Promise.all(['cancelled','no_show'].map(status=>call(`/members/${a.id}/service-records/${record.id}`,'PATCH',{...update,status,version:2,operationId:uuid()},admin)));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  assert.equal((await ok(`/members/${a.id}/service-overview`,'GET',undefined,admin)).completedCount,0);
  assert.equal((await ok(`/members/${b.id}/service-overview`,'GET',undefined,admin)).completedCount,0);
 });
 await t.test('pagination, time ordering, latest summaries and future cancellation',async()=>{
  for(let i=0;i<10;i++)await ok(`/members/${a.id}/service-records`,'POST',{...base,operationId:uuid(),appointmentAt:Date.now()+(i+1)*86400000,status:'pending'},teacher);
  await ok(`/members/${a.id}/service-records`,'POST',{...base,operationId:uuid(),appointmentAt:Date.now()+86400000,status:'cancelled'},teacher);
  const page1=await ok(`/members/${a.id}/service-records?page=1`,'GET',undefined,teacher),page2=await ok(`/members/${a.id}/service-records?page=2`,'GET',undefined,teacher);assert.equal(page1.items.length,8);assert.equal(page2.items.length,4);assert.equal(new Set([...page1.items,...page2.items].map(r=>r.id)).size,12);
  assert.equal((await ok(`/members/${a.id}/service-overview`,'GET',undefined,teacher)).latestPending.id,page1.items[0].id);
  assert.equal((await ok('/member-options?'+new URLSearchParams({exclude:a.id,q:'TZ-00002'}),'GET',undefined,teacher)).items[0].id,b.id);
 });
 await t.test('original bytes, incompatible overwrites and garbage collection',async()=>{
  const before=await db.prepare('SELECT seq,id,confirmed_id,photo_id FROM members ORDER BY seq').all();
  await ok(`/members/${b.id}/photo-sources/${photo}`,'PUT',originals,teacher);await ok(`/members/${b.id}/photo-sources/${photo}`,'PUT',originals,teacher);
  const original=await call(`/members/${b.id}/photo-source?download=1`,'GET',undefined,teacher);assert.deepEqual(Buffer.from(await original.arrayBuffer()),originals);
  assert.equal((await call(`/members/${b.id}/photo-source?download=1`)).status,401);
  assert.equal((await call(`/members/${b.id}/photo-sources/${photo}`,'PUT',await readFile('public/brand/female-avatar.png'),teacher)).status,409);
  assert.equal((await call(`/members/${b.id}/photo-sources/${photo}`,'PUT',Buffer.from('<svg/>'),teacher)).status,400);
  await db.prepare('UPDATE media SET created_at=?').bind(Date.now()-8*86400000).run();await cleanup({DB:db,MEDIA:bucket} as any);assert.equal((await ok(`/members/${b.id}/photo-source`,'GET',undefined,teacher)).stored,true);
  const orphan=uuid();await ok(`/members/${a.id}/media/${orphan}?kind=photo`,'PUT',originals,teacher);await ok(`/members/${a.id}/photo-sources/${orphan}`,'PUT',originals,teacher);await db.prepare('UPDATE media SET created_at=? WHERE id=?').bind(Date.now()-8*86400000,orphan).run();await cleanup({DB:db,MEDIA:bucket} as any);assert.equal(await db.prepare('SELECT * FROM photo_sources WHERE media_id=?').bind(orphan).first(),null);
  assert.deepEqual((await db.prepare('SELECT seq,id,confirmed_id,photo_id FROM members ORDER BY seq').all()).results,before.results);
 });
 await t.test('disabled accounts and password reset revoke sessions',async()=>{
  await ok('/admin/users/'+teacherId,'PATCH',{active:false},admin);assert.equal((await call('/me','GET',undefined,teacher)).status,401);assert.equal((await call('/accounts/login','POST',{username:'teacher',password})).status,401);
  await ok('/admin/users/'+teacherId,'PATCH',{active:true},admin);await ok('/admin/users/'+teacherId,'PATCH',{password:password+'new'},admin);assert.equal((await call('/accounts/login','POST',{username:'teacher',password})).status,401);assert.equal((await call('/accounts/login','POST',{username:'teacher',password:password+'new'})).status,200);
  const me=await ok('/me','GET',undefined,admin);assert.equal((await call('/admin/users/'+me.user.id,'PATCH',{active:false},admin)).status,409);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
 }finally{await mf.dispose();}
});
