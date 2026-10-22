import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createPoolFromEnv} from './database';

export async function migrate(directory=resolve(process.cwd(),'pg-migrations')){
 const pool=createPoolFromEnv(process.env);
 let client;
 try{client=await pool.connect();}catch(error){await pool.end();throw error;}
 let started=false;
 try{
  const files=(await readdir(directory)).filter(name=>/^\d{4}_[a-z0-9_-]+\.sql$/.test(name)).sort();
  if(!files.length)throw new Error('No PostgreSQL migration files found');
  await client.query('BEGIN');
  started=true;console.log('migration_started',files.length);
  await client.query('SELECT pg_advisory_xact_lock(84351922)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of files){
   const sql=await readFile(resolve(directory,file),'utf8');
   const sha=createHash('sha256').update(sql).digest('hex');
   const existing=await client.query<{sha256:string}>('SELECT sha256 FROM schema_migrations WHERE version=$1',[file]);
   if(existing.rows.length){if(existing.rows[0].sha256!==sha)throw new Error(`Migration checksum mismatch: ${file}`);console.log('migration_skipped',file);continue;}
   await client.query(sql);
   await client.query('INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)',[file,sha]);
   console.log('migration_applied',file);
  }
  await client.query('COMMIT');
  started=false;console.log('migration_committed');
 }catch(error){if(started){await client.query('ROLLBACK');console.error('migration_rolled_back');}throw error;}finally{client.release();await pool.end();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 migrate().catch(error=>{console.error('migration_failed',error instanceof Error?error.message:'unknown error');process.exitCode=1;});
}
