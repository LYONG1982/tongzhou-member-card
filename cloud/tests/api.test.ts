import test from 'node:test';
import {migrate} from './migrations';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {deflateSync} from 'node:zlib';
import {cleanup} from '../src/server/cleanup.ts';
import {hashPassword} from '../src/server/crypto.ts';
import worker from '../src/server/index.ts';
import {portraitGeometry} from '../src/client/components/MemberSummaryCard.tsx';
const id=()=>crypto.randomUUID();
function png(w:number,h:number){
 function chunk(type:string,data:Buffer){const b=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const x of b){crc^=x;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const tail=Buffer.alloc(4);tail.writeUInt32BE((crc^0xffffffff)>>>0);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);return Buffer.concat([size,b,tail]);}
 const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=2;
 const rows=Buffer.alloc((w*3+1)*h,200);for(let y=0;y<h;y++)rows[y*(w*3+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
test('saved portrait crop: portrait, landscape, zoom, offset, resized uploads and invalid geometry',()=>{
 assert.deepEqual(portraitGeometry(612,816,{x:0,y:0,zoom:1}),{x:0,y:0,width:612,height:816});
 assert.deepEqual(portraitGeometry(1200,800,{x:0,y:0,zoom:1}),{x:-306,y:0,width:1224,height:816});
 const moved={x:200,y:-100,zoom:2};
 assert.deepEqual(portraitGeometry(1200,800,moved),{x:-718,y:-508,width:2448,height:1632});
 assert.deepEqual(portraitGeometry(2400,1600,moved),portraitGeometry(1200,800,moved));
 assert.deepEqual(moved,{x:200,y:-100,zoom:2});
 const edge=portraitGeometry(1200,800,{x:100000,y:100000,zoom:2});assert.equal(edge.x,0);assert.equal(edge.y,0);
 assert.throws(()=>portraitGeometry(0,800,moved));assert.throws(()=>portraitGeometry(1200,800,{x:NaN,y:0,zoom:1}));assert.throws(()=>portraitGeometry(1200,800,{x:0,y:0,zoom:4}));
});
test('Cloudflare runtime: authentication, numbering, media versions and recovery',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'tz-api-'));const scriptPath=resolve('.wrangler/test-bundle/index.js');
 const password=id()+id(),accessHash=hashPassword(password);
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"app",modules:true,scriptPath,compatibilityDate:'2026-10-21',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{ENVIRONMENT:'local',BOOTSTRAP_TOKEN_HASH:accessHash},serviceBindings:{ASSETS:()=>new Response('static')}}]}));
 try {
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('MEDIA');
 await migrate(db);
 async function call(path:string,method='GET',body?:unknown,cookie='',extra:Record<string,string>={}){return mf.dispatchFetch('https://card.test/api'+path,{method,headers:{Origin:'https://card.test',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':body instanceof Buffer?'image/png':'application/json'}),...extra},body:body===undefined?undefined:body instanceof Buffer?body:JSON.stringify(body)});}
 async function ok(path:string,method='GET',body?:unknown,cookie=''){const r=await call(path,method,body,cookie);const value=await r.json() as any;assert.ok(r.ok,`${path}: ${r.status} ${JSON.stringify(value)}`);return value;}
 const cookie=(r:Response)=>r.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await call('/members')).status,401);
 const before=performance.now();const access=await call('/accounts/setup','POST',{username:'admin',displayName:'验收管理员',password,bootstrapToken:password});assert.equal(access.status,201,await access.text());const admin=cookie(access);t.diagnostic(`Access verification including D1: ${Math.round(performance.now()-before)}ms wall time (not remote CPU)`);
 assert.equal((await call('/accounts/login','POST',{username:'admin',password:'incorrect'})).status,401);
 const second=await call('/accounts/login','POST',{username:'admin',password});assert.equal(second.status,200);
 const owner={cookie:admin},reader={cookie:cookie(second)};
 assert.equal((await call('/admin/users','GET',undefined,admin)).status,200);
 assert.equal((await call('/setup','POST',{},admin)).status,404);
 await t.test('fifty concurrent independent numbers and ten identical retries',async()=>{
  const all=await Promise.all(Array.from({length:50},()=>ok('/members','POST',{requestKey:id(),gender:'男'},owner.cookie)));
  assert.equal(new Set(all.map(m=>m.number)).size,50);assert.ok(all.some(m=>m.number==='TZ-00001'));
  const requestKey=id();const retries=await Promise.all(Array.from({length:10},()=>ok('/members','POST',{requestKey,gender:'女'},owner.cookie)));
  assert.equal(new Set(retries.map(m=>m.id)).size,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM members').first<{n:number}>())?.n,51);
  const p1=await ok('/admin/members?page=1','GET',undefined,admin),p2=await ok('/admin/members?page=2','GET',undefined,admin),p3=await ok('/admin/members?page=3','GET',undefined,admin);assert.deepEqual([p1.items.length,p2.items.length,p3.items.length],[20,20,11]);assert.equal(new Set([...p1.items,...p2.items,...p3.items].map(m=>m.id)).size,51);
 });
 let m=await ok('/members','POST',{requestKey:id(),gender:'男'},owner.cookie);
 const originalNumber=m.number; m=await ok('/members/'+m.id+'/gender','PUT',{gender:'女',version:m.version},owner.cookie);assert.equal(m.number,originalNumber);
 assert.equal((await call('/members/'+m.id+'/gender','PUT',{gender:'女',version:m.version},reader.cookie)).status,200);
 assert.equal((await call('/members/'+m.id+'?edit=1','GET',undefined,reader.cookie)).status,200);
 assert.equal((await call('/members/'+m.id,'GET',undefined,reader.cookie)).status,404);
 assert.equal((await ok('/members','GET',undefined,reader.cookie)).total,0);
 assert.equal((await call('/members','POST',{requestKey:id(),gender:'男'},owner.cookie,{Origin:'https://other.test'})).status,403);
 const photoId=id(),cardId=id(),thumbId=id();
 const upload=(memberId:string,mediaId:string,kind:string,image:Buffer,user=owner.cookie)=>ok('/members/'+memberId+'/media/'+mediaId+'?kind='+kind,'PUT',image,user);
 await upload(m.id,photoId,'photo',png(600,800));
 assert.equal((await call('/media/'+photoId,'GET',undefined,owner.cookie)).status,404);
 assert.equal((await call('/members/'+m.id+'/media/'+id()+'?kind=photo','PUT',Buffer.from('<svg/>'),owner.cookie)).status,400);
 assert.equal((await call('/members/'+m.id+'/media/'+id()+'?kind=card','PUT',png(60,80),owner.cookie)).status,400);
 assert.equal((await call('/members/'+m.id+'/media/'+photoId+'?kind=photo','PUT',png(610,800),owner.cookie)).status,409);
 const editor={transform:{x:0,y:0,zoom:1},privacy:'original',mask:null,template:'figma-v1'};
 const profile={memberName:'测试会员',gender:'女',birth:'1982',height:165,ethnic:'汉族',marital:'未婚',edu:'本科',job:'教师',income:'10000',assets:'有房有车',family:'家庭和睦',review:'性格开朗',match:'真诚友善'};
 const draft={operationId:id(),version:m.version,photoId,editor,profile};
 const first=await ok('/members/'+m.id+'/draft','PUT',draft,owner.cookie);assert.deepEqual(await ok('/members/'+m.id+'/draft','PUT',draft,owner.cookie),first);
 assert.equal((await call('/members/'+m.id+'/draft','PUT',{...draft,operationId:id()},owner.cookie)).status,409);
 assert.equal((await call('/media/'+photoId)).status,401);assert.equal((await call('/media/'+photoId,'GET',undefined,reader.cookie)).status,200);
 await upload(m.id,cardId,'card',png(1440,1080));await upload(m.id,thumbId,'thumb',png(480,360));
 const confirmBody={operationId:id(),version:first.version,editor,cardId,thumbId};
 const confirmed=await ok('/members/'+m.id+'/confirm','POST',confirmBody,owner.cookie);assert.deepEqual(await ok('/members/'+m.id+'/confirm','POST',confirmBody,owner.cookie),confirmed);
 let full=await ok('/members/'+m.id,'GET',undefined,reader.cookie);assert.equal(full.confirmed.cardId,cardId);assert.equal(full.number,originalNumber);
 const file=await call('/members/'+m.id+'/download','GET',undefined,reader.cookie);assert.equal(file.status,200);assert.ok(decodeURIComponent(file.headers.get('content-disposition')!).includes(originalNumber+'_测试会员_1982_女.png'));assert.deepEqual(Buffer.from(await file.arrayBuffer()),png(1440,1080));
 const foreign=await ok('/members','POST',{requestKey:id(),gender:'男'},owner.cookie);
 assert.equal((await call('/members/'+foreign.id+'/draft','PUT',{...draft,operationId:id(),version:0},owner.cookie)).status,400);
 const replacementPhoto=id();await upload(m.id,replacementPhoto,'photo',png(800,600));
 const updated=await ok('/members/'+m.id+'/draft','PUT',{...draft,photoId:replacementPhoto,version:confirmed.version,operationId:id(),profile:{...profile,memberName:'新版姓名',birth:'1995',marital:'离异未育',ethnic:'蒙古族'}},owner.cookie);
 const portraitList=await ok('/members?pageSize=16','GET',undefined,reader.cookie);assert.equal(portraitList.pageSize,16);
 assert.equal(portraitList.items[0].photo_id,photoId);assert.equal(portraitList.items[0].ethnic,'汉族');assert.equal(portraitList.items[0].template,'figma-v1');assert.deepEqual(portraitList.items[0].transform,editor.transform);
 for(const key of ['profile','editor','privacy','mask','object_key'])assert.equal(key in portraitList.items[0],false);
 assert.equal((await call('/members?pageSize=15','GET',undefined,reader.cookie)).status,400);
 assert.equal((await call('/members?pageSize=100000','GET',undefined,reader.cookie)).status,400);

 full=await ok('/members/'+m.id,'GET',undefined,reader.cookie);assert.equal(full.confirmed.profile.memberName,'测试会员');assert.equal(full.profile.memberName,'测试会员');
 assert.equal((await ok('/members/'+m.id+'?edit=1','GET',undefined,reader.cookie)).profile.memberName,'新版姓名');
 const oldDownload=await call('/members/'+m.id+'/download','GET',undefined,reader.cookie);assert.ok(decodeURIComponent(oldDownload.headers.get('content-disposition')!).includes('测试会员'));
 assert.equal((await ok('/members?q='+encodeURIComponent('新版姓名'),'GET',undefined,reader.cookie)).total,0);
 assert.equal((await ok('/members?q='+encodeURIComponent('%'),'GET',undefined,reader.cookie)).total,0);
 assert.equal((await ok('/members?gender='+encodeURIComponent('女')+'&marital=unmarried&decade=1980','GET',undefined,reader.cookie)).total,1);
 assert.equal((await ok('/members?marital=divorced&decade=1990','GET',undefined,reader.cookie)).total,0);
 assert.equal((await call('/members?decade=1982','GET',undefined,reader.cookie)).status,400);
 assert.equal((await call('/members/'+m.id+'/archive','POST',{archived:true,version:updated.version},reader.cookie)).status,404);
 const republish=await ok('/members/'+m.id+'/confirm','POST',{...confirmBody,operationId:id(),version:updated.version},reader.cookie);
 assert.equal((await ok('/members?marital=divorced&decade=1990','GET',undefined,owner.cookie)).total,1);
 assert.equal((await ok('/members?marital=unmarried&decade=1980','GET',undefined,owner.cookie)).total,0);
 await t.test('decade boundaries, divorced categories, pagination and combinations',async()=>{
  const fixtures=[['1969','未婚'],['1970','未婚'],['1979','未婚'],['1980','离异'],['1989','离异未育'],['1990','短婚未育'],['1999','离异有孩（不随身）'],['2000','离异有孩'],['2009','未婚'],['2010','未婚'],['','未婚'],...Array.from({length:15},()=>['1985','未婚'])];
  for(const [birth,marital] of fixtures){const mid=id(),sid=id();await db.prepare("INSERT INTO members(id,owner_id,request_key,gender,created_at,updated_at) VALUES (?,?,?,'男',0,0)").bind(mid,'00000000-0000-4000-8000-000000000002',id()).run();await db.prepare('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)').bind(sid,mid,JSON.stringify({...profile,gender:'男',memberName:'筛选测试',birth,marital}),JSON.stringify(editor),photoId,cardId,thumbId,0).run();await db.prepare('UPDATE members SET confirmed_id=? WHERE id=?').bind(sid,mid).run();}
  for(const [decade,n] of [['1970',2],['1980',17],['1990',3],['2000',2]])assert.equal((await ok('/members?decade='+decade,'GET',undefined,admin)).total,n);
  assert.equal((await ok('/members?marital=divorced','GET',undefined,admin)).total,6);
  assert.equal((await ok('/members?gender='+encodeURIComponent('男')+'&marital=divorced&decade=1980','GET',undefined,admin)).total,2);
  const small1=await ok('/members?page=1&pageSize=16','GET',undefined,admin),small2=await ok('/members?page=2&pageSize=16','GET',undefined,admin);
  assert.equal(small1.pageSize,16);assert.equal(small1.total,27);assert.equal(small1.items.length,16);assert.equal(small2.items.length,11);assert.equal(new Set([...small1.items,...small2.items].map(m=>m.id)).size,27);
  assert.deepEqual([...small1.items,...small2.items].map(m=>m.id),[...((await ok('/members?page=1','GET',undefined,admin)).items),...((await ok('/members?page=2','GET',undefined,admin)).items)].map(m=>m.id));
  const filtered=await ok('/members?marital=divorced&decade=1990&pageSize=16','GET',undefined,admin);assert.equal(filtered.total,3);
  const published=filtered.items.find(row=>row.id===m.id);assert.equal(published.photo_id,replacementPhoto);assert.equal(published.ethnic,'蒙古族');

  const page1=await ok('/members?page=1','GET',undefined,admin),page2=await ok('/members?page=2','GET',undefined,admin);assert.equal(page1.total,27);assert.equal(page1.items.length,24);assert.equal(page2.items.length,3);assert.equal(new Set([...page1.items,...page2.items].map(m=>m.id)).size,27);
 });
 await t.test('failed upload and database association can be retried safely',async()=>{
  const mediaId=id(),path='/members/'+m.id+'/media/'+mediaId+'?kind=photo';
  const failure=await worker.fetch(new Request('https://card.test/api'+path,{method:'PUT',headers:{Origin:'https://card.test',Cookie:admin,'Content-Type':'image/png'},body:png(600,800)}),{DB:db,MEDIA:{put:async()=>{throw new Error('simulated storage outage');}},ENVIRONMENT:'local',BOOTSTRAP_TOKEN_HASH:accessHash} as any,{} as any);
  assert.equal(failure.status,503);assert.equal((await db.prepare('SELECT state FROM media WHERE id=?').bind(mediaId).first<{state:string}>())?.state,'pending');
  await upload(m.id,mediaId,'photo',png(600,800));
  const current=await ok('/members/'+m.id+'?edit=1','GET',undefined,admin);
  const body={...draft,operationId:id(),version:current.version,photoId:mediaId};
  const dbFailure=await worker.fetch(new Request('https://card.test/api/members/'+m.id+'/draft',{method:'PUT',headers:{Origin:'https://card.test',Cookie:admin,'Content-Type':'application/json'},body:JSON.stringify(body)}),{DB:{prepare:db.prepare.bind(db),batch:async()=>{throw new Error('simulated database outage');}},MEDIA:bucket,ENVIRONMENT:'local',BOOTSTRAP_TOKEN_HASH:accessHash} as any,{} as any);
  assert.equal(dbFailure.status,503);assert.equal((await ok('/members/'+m.id+'?edit=1','GET',undefined,admin)).version,current.version);
  await ok('/members/'+m.id+'/draft','PUT',body,admin);
  assert.equal((await ok('/members/'+m.id,'GET',undefined,admin)).confirmed.id,republish.confirmedId);
  const latest=await ok('/members/'+m.id+'?edit=1','GET',undefined,admin);
  const races=await Promise.all([admin,reader.cookie].map((cookie,index)=>call('/members/'+m.id+'/draft','PUT',{...body,version:latest.version,operationId:id(),profile:{...profile,memberName:'并发修改'+index}},cookie)));
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 });
 await t.test('garbage collection preserves all referenced photos and snapshots',async()=>{
  const orphan=id();await upload(m.id,orphan,'thumb',png(480,360));
  await db.prepare('UPDATE media SET created_at=?').bind(Date.now()-8*86400000).run();
  const key=(await db.prepare('SELECT object_key FROM media WHERE id=?').bind(orphan).first<{object_key:string}>())!.object_key;
  await cleanup({DB:db,MEDIA:bucket} as any);
  assert.equal(await bucket.get(key),null);assert.equal(await db.prepare('SELECT id FROM media WHERE id=?').bind(orphan).first(),null);
  assert.equal((await call('/media/'+photoId,'GET',undefined,reader.cookie)).status,200);assert.equal((await call('/members/'+m.id+'/download','GET',undefined,reader.cookie)).status,200);
 });
 await ok('/logout','POST',{},reader.cookie);assert.equal((await call('/me','GET',undefined,reader.cookie)).status,401);
 // Verify rate limiting and expiration without affecting the active test session.
 for(let i=0;i<31;i++){const attempt=await call('/accounts/login','POST',{username:'admin',password:'incorrect'},'',{'CF-Connecting-IP':'192.0.2.99'});assert.equal(attempt.status,i<30?401:429);}
 const fresh=await call('/accounts/login','POST',{username:'admin',password});assert.equal(fresh.status,200);const freshCookie=cookie(fresh);
 const {digest}=await import('../src/server/crypto.ts');await db.prepare('UPDATE sessions SET expires_at=0 WHERE hash=?').bind(await digest(freshCookie.split('=')[1])).run();assert.equal((await call('/me','GET',undefined,freshCookie)).status,401);
 // Artificial sequence boundary is confined to this disposable test database.
 await db.prepare("UPDATE sqlite_sequence SET seq=999998 WHERE name='members'").run();
 assert.equal((await ok('/members','POST',{requestKey:id(),gender:'男'},admin)).number,'TZ-999999');assert.equal((await call('/members','POST',{requestKey:id(),gender:'男'},admin)).status,409);
 await db.prepare("UPDATE sessions SET expires_at=0").run();assert.equal((await call('/me','GET',undefined,admin)).status,401);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
