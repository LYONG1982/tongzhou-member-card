import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {deflateSync} from 'node:zlib';
import {createPoolFromEnv,PgDatabase} from '../../src/server/database';
import {MediaStore} from '../../src/server/media-store';
import {migrate} from '../../src/server/migrate';
import {app} from '../../src/server/index';
import {cleanup} from '../../src/server/cleanup';
import {hashPassword} from '../../src/server/crypto';

const id=()=>crypto.randomUUID();
function png(width:number,height:number){
 function chunk(type:string,data:Buffer){const payload=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of payload){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const tail=Buffer.alloc(4);tail.writeUInt32BE((crc^0xffffffff)>>>0);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);return Buffer.concat([size,payload,tail]);}
 const head=Buffer.alloc(13);head.writeUInt32BE(width);head.writeUInt32BE(height,4);head[8]=8;head[9]=2;
 const pixels=Buffer.alloc((width*3+1)*height,200);for(let y=0;y<height;y++)pixels[y*(width*3+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
test('PostgreSQL, mounted media, API and concurrency',async t=>{
 if(!process.env.PGDATABASE?.endsWith('_test'))throw new Error('Tests require a dedicated PGDATABASE ending in _test');
 const schema=`test_${id().replaceAll('-','')}`;
 const adminPool=createPoolFromEnv({...process.env,PGSCHEMA:undefined});
 await adminPool.query(`CREATE SCHEMA ${schema}`);
 const previousSchema=process.env.PGSCHEMA;
 process.env.PGSCHEMA=schema;
 const mediaRoot=await mkdtemp(join(tmpdir(),'member-card-media-'));
 let pool:ReturnType<typeof createPoolFromEnv>|undefined;
 try{
  await migrate();await migrate();
  pool=createPoolFromEnv(process.env);
  const db=new PgDatabase(pool),media=await MediaStore.open(mediaRoot);
  const bootstrap=id(),password=id()+id(),origin='https://member-card.test';
  const bindings={DB:db,MEDIA:media,ENVIRONMENT:'local',PUBLIC_ORIGIN:origin,BOOTSTRAP_TOKEN_HASH:hashPassword(bootstrap),REMOTE_IP:'127.0.0.1'};
  async function call(path:string,method='GET',body?:unknown,cookie='',override?:typeof bindings){
   const bytes=body instanceof Buffer?body:body===undefined?undefined:JSON.stringify(body);
   return app.fetch(new Request(origin+'/api'+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(bytes===undefined?{}:{'Content-Type':body instanceof Buffer?'image/png':'application/json'})},body:bytes}),override||bindings);
  }
  async function ok(path:string,method='GET',body?:unknown,cookie=''){
   const response=await call(path,method,body,cookie),json=await response.json() as any;
   assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(json)}`);
   return json;
  }
  const cookie=(response:Response)=>response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await ok('/status')).configured,true);
  assert.equal((await app.fetch(new Request(origin+'/health/live'),bindings)).status,200);
  assert.equal((await app.fetch(new Request(origin+'/health/ready'),bindings)).status,200);
  const unavailable={...bindings,DB:{one:async()=>{throw new Error('database unavailable');}}};
  assert.equal((await app.fetch(new Request(origin+'/health/live'),unavailable as any)).status,200);
  assert.equal((await app.fetch(new Request(origin+'/health/ready'),unavailable as any)).status,503);
  assert.equal((await call('/members')).status,401);
  const setup=await call('/accounts/setup','POST',{username:'admin',displayName:'管理员',password,bootstrapToken:bootstrap});
  assert.equal(setup.status,201,await setup.clone().text());
  const admin=cookie(setup);
  assert.equal((await call('/accounts/login','POST',{username:'admin',password:'wrong'})).status,401);
  assert.equal((await ok('/me','GET',undefined,admin)).user.role,'admin');
  const crossOrigin=await app.fetch(new Request(origin+'/api/members',{method:'POST',headers:{Origin:'https://untrusted.test',Cookie:admin,'Content-Type':'application/json'},body:JSON.stringify({requestKey:id(),gender:'男'})}),bindings);
  assert.equal(crossOrigin.status,403);
  await t.test('account uniqueness and permissions',async()=>{
   const duplicate=await Promise.all([0,1].map(()=>call('/admin/users','POST',{username:'employee',displayName:'员工',password},admin)));
   assert.deepEqual(duplicate.map(r=>r.status).sort(),[201,409]);
   const created=await duplicate.find(r=>r.status===201)!.json() as {id:string};
   const employee=cookie(await call('/accounts/login','POST',{username:'employee',password}));
   assert.equal((await call('/admin/users','GET',undefined,employee)).status,403);
   const profile={username:'employee_new',displayName:'新员工',expected:{username:'employee',displayName:'员工'}};
   await ok(`/admin/users/${created.id}`,'PATCH',profile,admin);
   assert.equal((await call(`/admin/users/${created.id}`,'PATCH',profile,admin)).status,409);
   assert.equal((await ok('/me','GET',undefined,employee)).user.displayName,'新员工');
   await ok(`/admin/users/${created.id}`,'PATCH',{password:password+'new'},admin);
   assert.equal((await call('/me','GET',undefined,employee)).status,401);
  });
  await t.test('concurrent numbering and idempotent creation',async()=>{
   const syncBefore=(await ok('/sync','GET',undefined,admin)).version;
   const members=await Promise.all(Array.from({length:20},()=>ok('/members','POST',{requestKey:id(),gender:'男'},admin)));
   assert.equal(new Set(members.map(m=>m.number)).size,20);
   const requestKey=id(),same=await Promise.all(Array.from({length:5},()=>ok('/members','POST',{requestKey,gender:'女'},admin)));
   assert.equal(new Set(same.map(m=>m.id)).size,1);
   assert.equal((await db.one<{n:number}>('SELECT count(*) AS n FROM members'))?.n,21);
   assert.ok((await ok('/sync','GET',undefined,admin)).version>=syncBefore+21);
   assert.equal((await db.one<{n:number}>("SELECT count(*) AS n FROM audit WHERE action='member.create'"))?.n,21);
  });
  const photo=await readFile('public/brand/male-avatar.png');
  async function confirmedMember(name:string){
   const member=await ok('/members','POST',{requestKey:id(),gender:'男'},admin);
   const imageId=id();await ok(`/members/${member.id}/media/${imageId}?kind=photo`,'PUT',photo,admin);
   const profile={memberName:name,gender:'男',birth:'1990',height:175,ethnic:'汉族',marital:'未婚',edu:'本科',job:'',income:'',assets:'',family:'',review:'',match:''};
   const editor={transform:{x:0,y:0,zoom:1},privacy:'original',mask:null,template:'figma-v1'};
   const draft=await ok(`/members/${member.id}/draft`,'PUT',{operationId:id(),version:member.version,profile,editor,photoId:imageId},admin);
   const card=id(),thumb=id();
   return {member,photo:imageId,draft,profile,editor,card,thumb};
  }
  const first=await confirmedMember('甲方');
  await t.test('private media, failure retry and optimistic update',async()=>{
   assert.equal((await call('/media/'+first.photo)).status,401);
   const image=await call('/media/'+first.photo,'GET',undefined,admin);
   assert.equal(image.status,200);
   assert.deepEqual(Buffer.from(await image.arrayBuffer()),photo);
   const failedId=id();
   const failed=await call(`/members/${first.member.id}/media/${failedId}?kind=photo`,'PUT',photo,admin,{...bindings,MEDIA:{...media,put:async()=>{throw new Error('simulated outage');}} as any});
   assert.equal(failed.status,503);
   assert.equal((await db.one<{state:string}>('SELECT state FROM media WHERE id=?',failedId))?.state,'pending');
   await ok(`/members/${first.member.id}/media/${failedId}?kind=photo`,'PUT',photo,admin);
   const associationId=id(),associationDb=Object.create(db) as PgDatabase;
   associationDb.exec=async(sql:string,...values:unknown[])=>{if(sql.includes("UPDATE media SET state='ready'"))throw new Error('simulated database outage');return db.exec(sql,...values);};
   const association=await call(`/members/${first.member.id}/media/${associationId}?kind=photo`,'PUT',photo,admin,{...bindings,DB:associationDb});
   assert.equal(association.status,503);
   assert.equal((await db.one<{state:string}>('SELECT state FROM media WHERE id=?',associationId))?.state,'pending');
   assert.ok(await media.get(`members/${first.member.id}/${associationId}/photo`));
   await ok(`/members/${first.member.id}/media/${associationId}?kind=photo`,'PUT',photo,admin);
   assert.equal((await db.one<{state:string}>('SELECT state FROM media WHERE id=?',associationId))?.state,'ready');
   const current=await ok('/members','POST',{requestKey:id(),gender:'男'},admin);
   const changes=await Promise.all([0,1].map(()=>call(`/members/${current.id}/gender`,'PUT',{gender:'女',version:current.version},admin)));
   assert.ok(changes.some(r=>r.status===200));
  });
  await t.test('confirmed cards, protected download and service revisions',async()=>{
   async function confirm(record:Awaited<ReturnType<typeof confirmedMember>>){
    await ok(`/members/${record.member.id}/media/${record.card}?kind=card`,'PUT',png(1440,1080),admin);
    await ok(`/members/${record.member.id}/media/${record.thumb}?kind=thumb`,'PUT',png(480,360),admin);
    return ok(`/members/${record.member.id}/confirm`,'POST',{operationId:id(),version:record.draft.version,editor:record.editor,cardId:record.card,thumbId:record.thumb},admin);
   }
   await confirm(first);
   await ok(`/members/${first.member.id}/photo-sources/${first.photo}`,'PUT',photo,admin);
   const original=await call(`/members/${first.member.id}/photo-source?download=1`,'GET',undefined,admin);
   assert.equal(original.status,200);
   assert.deepEqual(Buffer.from(await original.arrayBuffer()),photo);
   const second=await confirmedMember('乙方');await confirm(second);
   assert.equal((await ok('/members','GET',undefined,admin)).total,2);
   assert.equal((await ok('/members?q='+encodeURIComponent('甲方'),'GET',undefined,admin)).total,1);
   assert.ok((await ok('/admin/members?gender='+encodeURIComponent('男'),'GET',undefined,admin)).total>=2);
   assert.equal((await ok('/member-options?exclude='+first.member.id+'&q='+encodeURIComponent('乙方'),'GET',undefined,admin)).items[0].id,second.member.id);
   const download=await call(`/members/${first.member.id}/download`,'GET',undefined,admin);
   assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'image/png');
   assert.equal((await call(`/members/${first.member.id}/download`)).status,401);
   const operationId=id(),body={counterpartId:second.member.id,appointmentAt:Date.now()-86400000,status:'completed',note:'已见面',operationId};
   const concurrent=await Promise.all(Array.from({length:3},()=>ok(`/members/${first.member.id}/service-records`,'POST',body,admin)));
   assert.equal(new Set(concurrent.map(x=>x.record.id)).size,1);
   const created=concurrent[0];
   assert.equal(created.overview.completedCount,1);
   assert.equal((await ok(`/members/${first.member.id}/service-records`,'POST',body,admin)).record.id,created.record.id);
   const revised=await ok(`/members/${first.member.id}/service-records/${created.record.id}`,'PATCH',{...body,status:'cancelled',version:1,operationId:id(),reason:'状态更正'},admin);
   assert.equal(revised.record.version,2);
   assert.equal((await ok(`/members/${first.member.id}/service-overview`,'GET',undefined,admin)).completedCount,0);
   const deleted=await ok(`/admin/members/${second.member.id}`,'DELETE',{version:second.draft.version+1,operationId:id()},admin);
   assert.equal(deleted.deleted,true);
   assert.equal((await call(`/media/${second.photo}`,'GET',undefined,admin)).status,404);
   const history=await ok(`/members/${first.member.id}/service-records/${created.record.id}`,'GET',undefined,admin);
   assert.equal(history.counterpart_deleted,1);
  });
  await t.test('cleanup preserves referenced files',async()=>{
   const orphan=id();await ok(`/members/${first.member.id}/media/${orphan}?kind=photo`,'PUT',photo,admin);
   await db.exec('UPDATE media SET created_at=? WHERE id=?',Date.now()-8*86400000,orphan);
   await cleanup(bindings);
   assert.equal(await media.get(`members/${first.member.id}/${orphan}/photo`),null);
   assert.ok(await media.get(`members/${first.member.id}/${first.photo}/photo`));
  });
  const tables=await db.one<{n:number}>("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'");
  assert.equal(tables?.n,15);
  await t.test('six-digit sequence boundary',async()=>{
   await db.exec("SELECT setval(pg_get_serial_sequence('members','seq'),999998,true)");
   assert.equal((await ok('/members','POST',{requestKey:id(),gender:'男'},admin)).number,'TZ-999999');
   assert.equal((await call('/members','POST',{requestKey:id(),gender:'男'},admin)).status,409);
  });
 }finally{
  if(pool)await pool.end();
  delete process.env.PGSCHEMA;
  if(previousSchema)process.env.PGSCHEMA=previousSchema;
  await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
  await adminPool.end();
  await rm(mediaRoot,{recursive:true,force:true});
 }
});
