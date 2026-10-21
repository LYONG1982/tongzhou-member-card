import type {Bindings} from './types';
// Keep all referenced versions. Only unreferenced uploads older than seven days qualify.
export async function cleanup(env:Bindings, time=Date.now()) {
 const cutoff=time-7*86400000;
 const unreferenced=`NOT EXISTS(SELECT 1 FROM members WHERE photo_id=media.id) AND NOT EXISTS(SELECT 1 FROM snapshots WHERE photo_id=media.id OR card_id=media.id OR thumb_id=media.id)`;
 const candidates=await env.DB.prepare(`SELECT id FROM media WHERE created_at<? AND ${unreferenced} LIMIT 100`).bind(cutoff).all<{id:string}>();
 for(const {id} of candidates.results) {
  const row=await env.DB.prepare(`UPDATE media SET state='deleting' WHERE id=? AND created_at<? AND ${unreferenced} RETURNING object_key`).bind(id,cutoff).first<{object_key:string}>();
  if(!row)continue;
  await env.MEDIA.delete(row.object_key);
  await env.DB.prepare("DELETE FROM media WHERE id=? AND state='deleting'").bind(id).run();
 }
 await env.DB.batch([
  env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(time),
  env.DB.prepare('DELETE FROM access_sessions WHERE expires_at<?').bind(time),
  env.DB.prepare('DELETE FROM invitations WHERE expires_at<?').bind(time),
  env.DB.prepare('DELETE FROM limits WHERE expires_at<?').bind(time)
 ]);
}
