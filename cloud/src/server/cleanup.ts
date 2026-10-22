import type {Bindings} from './types';
// Keep all referenced versions. Only unreferenced uploads older than seven days qualify.
export async function cleanup(env:Bindings, time=Date.now()) {
 const cutoff=time-7*86400000;
 const unreferenced=`NOT EXISTS(SELECT 1 FROM members WHERE id=media.member_id AND archived=1) AND NOT EXISTS(SELECT 1 FROM members WHERE photo_id=media.id) AND NOT EXISTS(SELECT 1 FROM snapshots WHERE photo_id=media.id OR card_id=media.id OR thumb_id=media.id)`;
 const candidates=await env.DB.many<{id:string}>(`SELECT id FROM media WHERE created_at<? AND ${unreferenced} LIMIT 100`,cutoff);
 for(const {id} of candidates.results) {
  const row=await env.DB.one<{object_key:string}>(`UPDATE media SET state='deleting' WHERE id=? AND created_at<? AND ${unreferenced} RETURNING object_key`,id,cutoff);
  if(!row)continue;
  const source=await env.DB.one<{object_key:string}>('SELECT object_key FROM photo_sources WHERE media_id=?',id);
  if(source){await env.MEDIA.delete(source.object_key);await env.DB.exec('DELETE FROM photo_sources WHERE media_id=?',id);}
  await env.MEDIA.delete(row.object_key);
  await env.DB.exec("DELETE FROM media WHERE id=? AND state='deleting'",id);
 }
 await env.DB.transactionBatch([
  env.DB.statement('DELETE FROM sessions WHERE expires_at<?',time),
  env.DB.statement('DELETE FROM access_sessions WHERE expires_at<?',time),
  env.DB.statement('DELETE FROM invitations WHERE expires_at<?',time),
  env.DB.statement('DELETE FROM limits WHERE expires_at<?',time)
 ]);
}
