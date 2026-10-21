import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
const base=process.env.SMOKE_URL;
if(base!=='https://tongzhou-member-card-staging.lvyongsz.workers.dev')throw Error('Only the isolated staging environment is permitted');
const {code}=JSON.parse(await readFile(process.env.SMOKE_CREDENTIAL_FILE!,'utf8'));
const id=()=>crypto.randomUUID();
function png(w:number,h:number){
 function chunk(type:string,data:Buffer){const b=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const x of b){crc^=x;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const tail=Buffer.alloc(4);tail.writeUInt32BE((crc^0xffffffff)>>>0);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);return Buffer.concat([size,b,tail]);}
 const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=2;
 const rows=Buffer.alloc((w*3+1)*h,200);for(let y=0;y<h;y++)rows[y*(w*3+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
async function call(path:string,method='GET',body?:unknown,cookie=''){return fetch(base+'/api'+path,{method,headers:{Origin:base!,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':body instanceof Buffer?'image/png':'application/json'})},body:body===undefined?undefined:body instanceof Buffer?body:JSON.stringify(body)});}
async function ok(path:string,method='GET',body?:unknown,cookie=''){const r=await call(path,method,body,cookie);assert.ok(r.ok,`${path} HTTP ${r.status}`);return r.json() as Promise<any>;}
async function login(){const r=await call('/login','POST',{code});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie')!,/Secure/i);return r.headers.get('set-cookie')!.split(';')[0];}
assert.equal((await call('/members')).status,401);
const a=await login(),b=await login();
const batch=await Promise.all(Array.from({length:50},()=>ok('/members','POST',{requestKey:id(),gender:'男'},a)));
assert.equal(new Set(batch.map(m=>m.number)).size,50);
const requestKey=id();const retry=await Promise.all(Array.from({length:10},()=>ok('/members','POST',{requestKey,gender:'女'},a)));assert.equal(new Set(retry.map(m=>m.id)).size,1);
const marker='云端验收'+Date.now();
for(const [i,m] of batch.slice(0,2).entries()){
 const gender=i?'女':'男',photoId=id(),cardId=id(),thumbId=id();
 const editor={transform:{x:0,y:0,zoom:1},privacy:'original',mask:null,template:'figma-v1'};
 const profile={memberName:marker+i,gender,birth:i?'1992':'1982',height:165,ethnic:'汉族',marital:i?'离异未育':'未婚',edu:'本科',job:'',income:'',assets:'',family:'',review:'',match:''};
 for(const [mediaId,kind,w,h] of [[photoId,'photo',600,800],[cardId,'card',1440,1080],[thumbId,'thumb',480,360]] as const)await ok(`/members/${m.id}/media/${mediaId}?kind=${kind}`,'PUT',png(w,h),a);
 const draft=await ok('/members/'+m.id+'/draft','PUT',{operationId:id(),version:m.version,photoId,profile,editor},a);
 const body={operationId:id(),version:draft.version,editor,cardId,thumbId};
 const saved=await ok('/members/'+m.id+'/confirm','POST',body,b);assert.deepEqual(await ok('/members/'+m.id+'/confirm','POST',body,b),saved);
 assert.equal((await call('/media/'+photoId)).status,401);assert.equal((await call('/media/'+photoId,'GET',undefined,b)).status,200);
 const download=await call('/members/'+m.id+'/download','GET',undefined,b);assert.equal(download.status,200);assert.ok(decodeURIComponent(download.headers.get('content-disposition')!).includes(m.number+'_'+profile.memberName+'_'+profile.birth+'_'+gender+'.png'));
 assert.deepEqual(Buffer.from(await download.arrayBuffer()),png(1440,1080));
 const q=new URLSearchParams({q:marker,gender,marital:i?'divorced':'unmarried',decade:i?'1990':'1980'});
 assert.equal((await ok('/members?'+q,'GET',undefined,b)).total,1);
}
await ok('/logout','POST',{},a);assert.equal((await call('/members','GET',undefined,a)).status,401);
console.log('PASS: staging two sessions, 50 concurrent numbers, idempotency, R2 upload/download, snapshots, filters and logout');
