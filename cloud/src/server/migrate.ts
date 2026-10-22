import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {createPoolFromEnv} from './database';
import {logError,logInfo} from './logger';

export async function migrate(directory=resolve(process.cwd(),'pg-migrations')){
 const startedAt=Date.now();let stage='configuration_validation',fileInProgress:string|undefined,migrationCount=0;
 let pool:ReturnType<typeof createPoolFromEnv>|undefined,client:PoolClient|undefined;
 let transactionStarted=false;
 logInfo('migration_starting',{stage});
 try{
  stage='configuration_validation';
  pool=createPoolFromEnv(process.env);
  logInfo('migration_configuration_validated');
  logInfo('migration_database_pool_initialized');
  stage='database_connection';
  const connectionStarted=Date.now();logInfo('migration_database_connection_started',{stage});
  client=await pool.connect();
  logInfo('migration_database_connected',{duration_ms:Date.now()-connectionStarted});

  stage='migration_file_discovery';
  const files=(await readdir(directory)).filter(name=>/^\d{4}_[a-z0-9_-]+\.sql$/.test(name)).sort();
  if(!files.length)throw new Error('No PostgreSQL migration files found');
  migrationCount=files.length;
  logInfo('migration_files_discovered',{count:files.length});
  stage='migration_transaction';
  await client.query('BEGIN');
  transactionStarted=true;logInfo('migration_transaction_started');
  await client.query('SELECT pg_advisory_xact_lock(84351922)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of files){
   fileInProgress=file;stage='migration_file_read';
   const fileStarted=Date.now();logInfo('migration_file_started',{file});
   const sql=await readFile(resolve(directory,file),'utf8');
   const sha=createHash('sha256').update(sql).digest('hex');
   const existing=await client.query<{sha256:string}>('SELECT sha256 FROM schema_migrations WHERE version=$1',[file]);
   if(existing.rows.length){if(existing.rows[0].sha256!==sha)throw new Error(`Migration checksum mismatch: ${file}`);logInfo('migration_file_skipped',{file,duration_ms:Date.now()-fileStarted});fileInProgress=undefined;continue;}
   stage='migration_file_execution';
   try{
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)',[file,sha]);
   }catch(error){logError('migration_file_failed',error,{file,stage,duration_ms:Date.now()-fileStarted});throw error;}
   logInfo('migration_file_applied',{file,duration_ms:Date.now()-fileStarted});fileInProgress=undefined;
  }
  stage='migration_commit';
  await client.query('COMMIT');
  transactionStarted=false;logInfo('migration_committed',{migration_count:migrationCount,duration_ms:Date.now()-startedAt});
 }catch(error){
  if(transactionStarted&&client){
   try{await client.query('ROLLBACK');logInfo('migration_rolled_back',{failed_file:fileInProgress});}
   catch(rollbackError){logError('migration_rollback_failed',rollbackError,{failed_file:fileInProgress});}
  }
  logError('migration_failed',error,{stage,file:fileInProgress,duration_ms:Date.now()-startedAt});
  throw error;
 }finally{
  client?.release();
  if(pool)await pool.end();
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 migrate().catch(()=>{process.exitCode=1;});
}
