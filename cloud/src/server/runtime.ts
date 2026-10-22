import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {app} from './index';
import {createPoolFromEnv,PgDatabase} from './database';
import {MediaStore} from './media-store';
import {logError,logInfo} from './logger';
import type {Bindings} from './types';

export async function start(env=process.env){
 const startupTime=Date.now();let stage='configuration_validation';let pool:ReturnType<typeof createPoolFromEnv>|undefined;let server:ReturnType<typeof createServer>|undefined;
 logInfo('server_starting',{stage});
 try{
  if(!env.PUBLIC_ORIGIN)throw new Error('Missing required configuration: PUBLIC_ORIGIN');
  const origin=new URL(env.PUBLIC_ORIGIN);
  if(origin.origin!==env.PUBLIC_ORIGIN||!['http:','https:'].includes(origin.protocol))throw new Error('PUBLIC_ORIGIN must be a scheme and host without a path');
  if(env.ENVIRONMENT==='production'&&origin.protocol!=='https:')throw new Error('Production PUBLIC_ORIGIN must use HTTPS');
  if(!env.MEDIA_ROOT)throw new Error('Missing required configuration: MEDIA_ROOT');
  const port=Number(env.PORT||8080),hostname=env.HOST||'0.0.0.0';
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port');
  logInfo('configuration_validated',{environment:env.ENVIRONMENT||'local',port});

  stage='media_store_initialization';
  logInfo('media_store_initialization_started');
  const media=await MediaStore.open(env.MEDIA_ROOT);
  logInfo('media_store_ready');

  stage='configuration_validation';
  pool=createPoolFromEnv(env);
  pool.on('error',error=>logError('database_pool_client_error',error,{stage:'database_pool'}));
  logInfo('database_pool_initialized');
  stage='database_connection';
  logInfo('database_connection_started');
  const databaseStarted=Date.now();
  try{await pool.query('SELECT 1');}
  catch(error){logError('database_connection_failed',error,{stage,duration_ms:Date.now()-databaseStarted});throw error;}
  logInfo('database_connection_succeeded',{duration_ms:Date.now()-databaseStarted});

  const bindings:Bindings={DB:new PgDatabase(pool),MEDIA:media,ENVIRONMENT:env.ENVIRONMENT||'local',PUBLIC_ORIGIN:origin.origin,BOOTSTRAP_TOKEN_HASH:env.BOOTSTRAP_TOKEN_HASH,CLIENT_IP_HEADER:env.CLIENT_IP_HEADER,TRUSTED_PROXY_IPS:env.TRUSTED_PROXY_IPS};
  server=createServer(async(req,res)=>{
   const requestId=crypto.randomUUID(),method=req.method||'GET',requestPath=(req.url||'/').split('?')[0]||'/';
   try{
    const target=new URL(req.url||'/',origin);
    const headers=new Headers();
    for(const [name,value] of Object.entries(req.headers))for(const entry of Array.isArray(value)?value:[value])if(entry!==undefined)headers.append(name,entry);
    headers.set('x-request-id',requestId);
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){const data=Buffer.from(chunk);size+=data.length;if(size>21*1024*1024){logInfo('http_request_rejected',{request_id:requestId,method,path:requestPath,status:413,reason:'body_too_large'});res.writeHead(413,{'x-request-id':requestId});res.end();return;}chunks.push(data);}
    const bytes=Buffer.concat(chunks);
    const request=new Request(target,{method:req.method,headers,body:['GET','HEAD'].includes(req.method||'GET')?undefined:bytes.length?new Uint8Array(bytes).buffer:undefined});
    const response=await app.fetch(request,{...bindings,REMOTE_IP:req.socket.remoteAddress});
    const outgoing:Record<string,string|string[]>={};
    response.headers.forEach((value,key)=>{outgoing[key]=value;});
    outgoing['x-request-id']=response.headers.get('x-request-id')||requestId;
    const cookies=response.headers.getSetCookie();if(cookies.length)outgoing['set-cookie']=cookies;
    res.writeHead(response.status,outgoing);
    if(!response.body){res.end();return;}
    Readable.fromWeb(response.body as never).pipe(res);
   }catch(error){logError('http_request_failed',error,{request_id:requestId,method,path:requestPath,status:503});if(!res.headersSent)res.writeHead(503,{'x-request-id':requestId});res.end();}
  });

  stage='http_listener';
  logInfo('http_listener_starting',{host:hostname,port});
  const listenStarted=Date.now();
  try{await new Promise<void>((done,reject)=>{server!.once('error',reject);server!.listen(port,hostname,done);});}
  catch(error){logError('http_listener_failed',error,{stage,host:hostname,port,duration_ms:Date.now()-listenStarted});throw error;}
  logInfo('server_listening',{host:hostname,port,startup_duration_ms:Date.now()-startupTime});
  let stopping:Promise<void>|undefined;
  const stop=()=>stopping??=(async()=>{
   logInfo('server_shutdown_started');
   await new Promise<void>((done,reject)=>server!.close(error=>error?reject(error):done()));
   await pool!.end();
   logInfo('server_shutdown_complete');
  })();
  process.once('SIGTERM',()=>{void stop().catch(error=>logError('server_shutdown_failed',error));});
  process.once('SIGINT',()=>{void stop().catch(error=>logError('server_shutdown_failed',error));});
  return {server,stop};
 }catch(error){
  logError('server_start_failed',error,{stage,startup_duration_ms:Date.now()-startupTime});
  if(server?.listening)await new Promise<void>(done=>server!.close(()=>done()));
  if(pool)await pool.end().catch(closeError=>logError('database_pool_shutdown_failed',closeError,{stage}));
  throw error;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 start().catch(()=>{process.exitCode=1;});
}
