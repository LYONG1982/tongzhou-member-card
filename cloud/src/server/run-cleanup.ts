import {createPoolFromEnv,PgDatabase} from './database';
import {MediaStore} from './media-store';
import {cleanup} from './cleanup';
import type {Bindings} from './types';

async function run(){
 if(!process.env.MEDIA_ROOT)throw new Error('Missing required configuration: MEDIA_ROOT');
 const media=await MediaStore.open(process.env.MEDIA_ROOT),pool=createPoolFromEnv(process.env);
 let lockClient;
 try{lockClient=await pool.connect();}catch(error){await pool.end();throw error;}
 try{
  const lock=await lockClient.query<{acquired:boolean}>('SELECT pg_try_advisory_lock(84351924) AS acquired');
  if(!lock.rows[0]?.acquired){console.log('cleanup_skipped_already_running');return;}
  const bindings:Bindings={DB:new PgDatabase(pool),MEDIA:media,ENVIRONMENT:process.env.ENVIRONMENT||'production',PUBLIC_ORIGIN:process.env.PUBLIC_ORIGIN||''};
  await cleanup(bindings);
  console.log('cleanup_complete');
 }finally{await lockClient.query('SELECT pg_advisory_unlock(84351924)');lockClient.release();await pool.end();}
}
run().catch(error=>{console.error('cleanup_failed',error instanceof Error?error.message:'unknown error');process.exitCode=1;});
