import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {app} from './index';
import {createPoolFromEnv,PgDatabase} from './database';
import {MediaStore} from './media-store';
import type {Bindings} from './types';

export async function start(env=process.env){
 if(!env.PUBLIC_ORIGIN)throw new Error('Missing required configuration: PUBLIC_ORIGIN');
 const origin=new URL(env.PUBLIC_ORIGIN);
 if(origin.origin!==env.PUBLIC_ORIGIN||!['http:','https:'].includes(origin.protocol))throw new Error('PUBLIC_ORIGIN must be a scheme and host without a path');
 if(env.ENVIRONMENT==='production'&&origin.protocol!=='https:')throw new Error('Production PUBLIC_ORIGIN must use HTTPS');
 if(!env.MEDIA_ROOT)throw new Error('Missing required configuration: MEDIA_ROOT');
 const port=Number(env.PORT||8080),hostname=env.HOST||'0.0.0.0';
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port');
 const media=await MediaStore.open(env.MEDIA_ROOT);
 const pool=createPoolFromEnv(env);
 try{await pool.query('SELECT 1');}catch(error){await pool.end();throw error;}
 const bindings:Bindings={DB:new PgDatabase(pool),MEDIA:media,ENVIRONMENT:env.ENVIRONMENT||'local',PUBLIC_ORIGIN:origin.origin,BOOTSTRAP_TOKEN_HASH:env.BOOTSTRAP_TOKEN_HASH,CLIENT_IP_HEADER:env.CLIENT_IP_HEADER,TRUSTED_PROXY_IPS:env.TRUSTED_PROXY_IPS};
 const server=createServer(async(req,res)=>{
  try{
   const target=new URL(req.url||'/',origin);
   const headers=new Headers();
   for(const [name,value] of Object.entries(req.headers))for(const entry of Array.isArray(value)?value:[value])if(entry!==undefined)headers.append(name,entry);
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of req){const data=Buffer.from(chunk);size+=data.length;if(size>21*1024*1024){res.writeHead(413);res.end();return;}chunks.push(data);}
   const bytes=Buffer.concat(chunks);
   const request=new Request(target,{method:req.method,headers,body:['GET','HEAD'].includes(req.method||'GET')?undefined:bytes.length?new Uint8Array(bytes).buffer:undefined});
   const response=await app.fetch(request,{...bindings,REMOTE_IP:req.socket.remoteAddress});
   const outgoing:Record<string,string|string[]>={};
   response.headers.forEach((value,key)=>{outgoing[key]=value;});
   const cookies=response.headers.getSetCookie();if(cookies.length)outgoing['set-cookie']=cookies;
   res.writeHead(response.status,outgoing);
   if(!response.body){res.end();return;}
   Readable.fromWeb(response.body as never).pipe(res);
  }catch(error){console.error('http_request_failed',error instanceof Error?error.name:'unknown');if(!res.headersSent)res.writeHead(503);res.end();}
 });
 try{await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(port,hostname,done);});}catch(error){await pool.end();throw error;}
 console.log('server_listening',hostname,port);
 const stop=async()=>{await new Promise<void>(done=>server.close(()=>done()));await pool.end();};
 process.once('SIGTERM',()=>{void stop();});
 process.once('SIGINT',()=>{void stop();});
 return {server,stop};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 start().catch(error=>{console.error('server_start_failed',error instanceof Error?error.message:'unknown error');process.exitCode=1;});
}
