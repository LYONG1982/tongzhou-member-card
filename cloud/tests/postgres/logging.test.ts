import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {app} from '../../src/server/index';
import {start} from '../../src/server/runtime';
import {logError} from '../../src/server/logger';
import {migrate} from '../../src/server/migrate';
import {createPoolFromEnv} from '../../src/server/database';

async function captureLogs(action:()=>Promise<unknown>){
 const lines:string[]=[],originals={log:console.log,error:console.error,warn:console.warn};
 console.log=(...args:unknown[])=>lines.push(args.map(String).join(' '));
 console.error=(...args:unknown[])=>lines.push(args.map(String).join(' '));
 console.warn=(...args:unknown[])=>lines.push(args.map(String).join(' '));
 let value:unknown,error:unknown;
 try{value=await action();}catch(caught){error=caught;}
 finally{console.log=originals.log;console.error=originals.error;console.warn=originals.warn;}
 return {lines,records:lines.map(line=>JSON.parse(line) as Record<string,unknown>),value,error};
}

test('DATABASEURL works without sslmode and keeps TLS disabled',async()=>{
 const pool=createPoolFromEnv({DATABASEURL:'postgresql://member:password@db.example.test:5432/member_card'} as NodeJS.ProcessEnv);
 try{assert.equal(pool.options.ssl,false);}
 finally{await pool.end();}
 assert.throws(()=>createPoolFromEnv({DATABASEURL:'postgresql://member:password@db.example.test:5432/member_card?sslmode=disable'} as NodeJS.ProcessEnv),/query parameters/);
});

test('structured logs redact credentials and sensitive fields',()=>{
 const connectionString='postgresql://member:known-secret@db.example.test:5432/member_card';
 const previous=process.env.DATABASEURL;process.env.DATABASEURL=connectionString;
 const lines:string[]=[],original=console.error;console.error=(line:string)=>lines.push(line);
 try{logError('redaction_probe',new Error(`connect failed ${connectionString}; password=known-secret`),{DATABASEURL:connectionString,cookie:'session-cookie-secret'});}
 finally{console.error=original;if(previous===undefined)delete process.env.DATABASEURL;else process.env.DATABASEURL=previous;}
 const output=lines.join('\n');
 assert.doesNotMatch(output,/known-secret|member:|session-cookie-secret/);
 const record=JSON.parse(lines[0]) as Record<string,any>;
 assert.equal(record.DATABASEURL,'[REDACTED]');
 assert.equal(record.cookie,'[REDACTED]');
 assert.match(record.error_message,/\[REDACTED\]/);
});

test('startup logs invalid database configuration without revealing its value',async()=>{
 const mediaRoot=await mkdtemp(join(tmpdir(),'member-card-log-config-'));
 try{
  const result=await captureLogs(()=>start({PUBLIC_ORIGIN:'https://member-card.test',MEDIA_ROOT:mediaRoot}));
  assert.ok(result.error instanceof Error);
  const failure=result.records.find(record=>record.event==='server_start_failed');
  assert.equal(failure?.stage,'configuration_validation');
  assert.match(String(failure?.error_message),/DATABASEURL/);
  assert.equal(result.records.some(record=>record.event==='database_connection_started'),false);
 }finally{await rm(mediaRoot,{recursive:true,force:true});}
});

test('database connection failure logs phase and safe cause',async()=>{
 const mediaRoot=await mkdtemp(join(tmpdir(),'member-card-log-db-'));
 const secretUrl='postgresql://member:connection-secret@127.0.0.1:1/member_card_test';
 const previous=process.env.DATABASEURL;process.env.DATABASEURL=secretUrl;
 try{
  const result=await captureLogs(()=>start({PUBLIC_ORIGIN:'https://member-card.test',MEDIA_ROOT:mediaRoot,DATABASEURL:secretUrl}));
  assert.ok(result.error instanceof Error);
  const failure=result.records.find(record=>record.event==='database_connection_failed');
  assert.equal(failure?.stage,'database_connection');
  assert.ok(failure?.error_code);
  assert.doesNotMatch(result.lines.join('\n'),/connection-secret|member:connection/);
 }finally{if(previous===undefined)delete process.env.DATABASEURL;else process.env.DATABASEURL=previous;await rm(mediaRoot,{recursive:true,force:true});}
});

test('migration logs invalid database configuration before connecting',async()=>{
 const previous=process.env.DATABASEURL;delete process.env.DATABASEURL;
 try{
  const result=await captureLogs(()=>migrate());
  assert.ok(result.error instanceof Error);
  const failure=result.records.find(record=>record.event==='migration_failed');
  assert.equal(failure?.stage,'configuration_validation');
  assert.match(String(failure?.error_message),/DATABASEURL/);
  assert.equal(result.records.some(record=>record.event==='migration_database_connection_started'),false);
 }finally{if(previous!==undefined)process.env.DATABASEURL=previous;}
});

test('migration database connection failure logs stage and redacts credentials',async()=>{
 const connectionString='postgresql://member:migration-secret@127.0.0.1:1/member_card_test';
 const previous=process.env.DATABASEURL;process.env.DATABASEURL=connectionString;
 try{
  const result=await captureLogs(()=>migrate());
  assert.ok(result.error instanceof Error);
  const failure=result.records.find(record=>record.event==='migration_failed');
  assert.equal(failure?.stage,'database_connection');
  assert.ok(failure?.error_code);
  assert.doesNotMatch(result.lines.join('\n'),/migration-secret|member:migration/);
 }finally{if(previous===undefined)delete process.env.DATABASEURL;else process.env.DATABASEURL=previous;}
});

test('unexpected API failures log request context and return a request id',async()=>{
 const failure=Object.assign(new Error('simulated database failure password=request-secret'),{code:'XX000'});
 const result=await captureLogs(async()=>app.fetch(new Request('https://member-card.test/api/me',{headers:{Cookie:'tz_personal=stub-session'}}),{
  DB:{one:async()=>{throw failure;}} as any,
  MEDIA:{} as any,
  ENVIRONMENT:'production',
  PUBLIC_ORIGIN:'https://member-card.test'
 }));
 const response=result.value as Response;
 assert.equal(response.status,503);
 assert.ok(response.headers.get('x-request-id'));
 const requestLog=result.records.find(record=>record.event==='request_failed');
 assert.equal(requestLog?.method,'GET');
 assert.equal(requestLog?.path,'/api/me');
 assert.equal(requestLog?.status,503);
 assert.equal(requestLog?.error_code,'XX000');
 assert.equal(requestLog?.error_message,'PostgreSQL operation failed (XX000)');
 assert.doesNotMatch(result.lines.join('\n'),/request-secret/);
});

test('readiness database failures have a diagnostic log entry',async()=>{
 const failure=Object.assign(new Error('connection failed password=readiness-secret'),{code:'08006'});
 const result=await captureLogs(async()=>app.fetch(new Request('https://member-card.test/health/ready'),{
  DB:{one:async()=>{throw failure;}} as any,
  MEDIA:{} as any,
  ENVIRONMENT:'production',
  PUBLIC_ORIGIN:'https://member-card.test'
 }));
 const response=result.value as Response;
 assert.equal(response.status,503);
 const databaseLog=result.records.find(record=>record.event==='database_readiness_check_failed');
 assert.equal(databaseLog?.status,503);
 assert.equal(databaseLog?.error_code,'08006');
 assert.doesNotMatch(result.lines.join('\n'),/readiness-secret/);
});
