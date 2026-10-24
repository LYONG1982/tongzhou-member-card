import type {Hono} from 'hono';
import type {Env} from './types';
import {uuid} from './validation';
import {digest} from './crypto';
import {fail} from './common';
// Detect original raster formats rather than trusting file extensions or MIME headers.
export function sourceInfo(bytes:ArrayBuffer){
 const b=new Uint8Array(bytes),v=new DataView(bytes),ascii=(a:number,n:number)=>String.fromCharCode(...b.slice(a,a+n));let type='',width=0,height=0;
 if(b.length>=33&&[137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n)&&v.getUint32(8)===13&&ascii(12,4)==='IHDR'){type='image/png';width=v.getUint32(16);height=v.getUint32(20);}
 else if(b.length>20&&b[0]===255&&b[1]===216){
  type='image/jpeg';let p=2;
  while(p+3<b.length){if(b[p]!==255)break;while(b[p]===255)p++;if(p>=b.length)break;const marker=b[p++];if(marker===0xda||marker===0xd9)break;if(marker===0x00||marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;if(p+2>b.length)break;const length=v.getUint16(p);if(length<2||p+length>b.length)break;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=length;
  }
 }
 else if(b.length>=10&&/^GIF8[79]a$/.test(ascii(0,6))){type='image/gif';width=v.getUint16(6,true);height=v.getUint16(8,true);}
 else if(b.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
  type='image/webp';const t=ascii(12,4);
  if(t==='VP8X'){width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}
  else if(t==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
  else if(t==='VP8L'&&b[20]===47){width=1+((b[21]|b[22]<<8)&16383);height=1+((b[22]>>6|b[23]<<2|b[24]<<10)&16383);}
 }else if(b.length>=26&&ascii(0,2)==='BM'){type='image/bmp';width=v.getInt32(18,true);height=Math.abs(v.getInt32(22,true));}
 else if(b.length>=16&&ascii(4,4)==='ftyp'&&/avif|avis|heic|heix|hevc|hevx|mif1/.test(ascii(8,Math.min(32,b.length-8)))){type=/avif|avis/.test(ascii(8,Math.min(32,b.length-8)))?'image/avif':'image/heif';for(let i=4;i+16<=b.length;i++){if(ascii(i,4)==='ispe'&&v.getUint32(i-4)>=20){width=v.getUint32(i+8);height=v.getUint32(i+12);break;}}}
 if(!type&&b.length>=16&&((ascii(0,2)==='II'&&b[2]===42)||(ascii(0,2)==='MM'&&b[3]===42))){const le=ascii(0,2)==='II',offset=v.getUint32(4,le);if(offset+2<=b.length){const n=v.getUint16(offset,le);for(let i=0;i<n;i++){const p=offset+2+i*12;if(p+12>b.length)break;const tag=v.getUint16(p,le),t=v.getUint16(p+2,le),count=v.getUint32(p+4,le);if(count===1&&(tag===256||tag===257)&&[3,4].includes(t)){const value=t===3?v.getUint16(p+8,le):v.getUint32(p+8,le);if(tag===256)width=value;else height=value;}}type='image/tiff';}}
 if(!type||width<=0||height<=0||width*height>50_000_000||Math.max(width,height)>20000)fail(400,'原文件格式或尺寸无效，请使用 PNG、JPG、WebP、GIF、BMP、AVIF、HEIF 或 TIFF 图片');
 return {type,width,height};
}
export function photoSourceRoutes(app:Hono<Env>){
 app.put('/api/members/:id/photo-sources/:media',async c=>{
  const id=uuid.parse(c.req.param('id')),mid=uuid.parse(c.req.param('media'));
  if(!await c.env.DB.one('SELECT id FROM members WHERE id=? AND archived=0',id))fail(404,'会员不存在或已删除');
  const m=await c.env.DB.one("SELECT a.id FROM media a JOIN members m ON m.id=a.member_id WHERE a.id=? AND a.member_id=? AND a.kind='photo' AND a.state='ready' AND m.archived=0",mid,id);if(!m)fail(400,'请先上传当前会员的工作照片');
  const bytes=await c.req.arrayBuffer();if(bytes.byteLength>20*1024*1024)fail(413,'原文件超过20MB');const info=sourceInfo(bytes),hash=await digest(bytes),key=`members/${id}/${mid}/original`;
  await c.env.DB.exec("INSERT INTO photo_sources(media_id,member_id,object_key,digest,content_type,size,state,created_by,created_at) VALUES (?,?,?,?,?,?,'pending',?,?) ON CONFLICT(media_id) DO NOTHING",mid,id,key,hash,info.type,bytes.byteLength,c.get('user').id,Date.now());
  const row=await c.env.DB.one<any>('SELECT * FROM photo_sources WHERE media_id=?',mid);if(row.digest!==hash||row.member_id!==id)fail(409,'该工作照片已关联不同原文件');if(row.state==='deleting')fail(410,'图片已过期，请重新上传');
  if(row.state!=='ready'){await c.env.DB.exec("UPDATE photo_sources SET created_at=? WHERE media_id=? AND state='pending'",Date.now(),mid);await c.env.MEDIA.put(key,bytes,{httpMetadata:{contentType:info.type},customMetadata:{sha256:hash}});const r=await c.env.DB.exec("UPDATE photo_sources SET state='ready' WHERE media_id=? AND state='pending'",mid);if(!r.meta.changes&&!await c.env.DB.one("SELECT media_id FROM photo_sources WHERE media_id=? AND state='ready'",mid))fail(409,'原件状态变化，请重试');}
  if(!await c.env.DB.one('SELECT id FROM members WHERE id=? AND archived=0',id))fail(404,'会员不存在或已删除');return c.json({stored:true,size:bytes.byteLength});
 });
 app.get('/api/members/:id/photo-source',async c=>{
  const id=uuid.parse(c.req.param('id'));if(!await c.env.DB.one('SELECT id FROM members WHERE id=? AND archived=0',id))fail(404,'会员不存在或已删除');const r=await c.env.DB.one<any>("SELECT p.* FROM members m JOIN snapshots s ON s.id=m.confirmed_id JOIN photo_sources p ON p.media_id=s.photo_id WHERE m.id=? AND m.archived=0 AND p.state='ready'",id);
  if(c.req.query('download')!=='1')return c.json({stored:!!r,size:r?.size||null});if(!r)fail(404,'这张历史照片未留存上传原文件');const object=await c.env.MEDIA.get(r.object_key);if(!object)fail(503,'原文件暂时无法读取');c.header('Content-Type',r.content_type);c.header('Content-Disposition','attachment; filename="original-photo.'+({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/bmp':'bmp','image/avif':'avif','image/heif':'heif','image/tiff':'tiff'}[r.content_type as string]||'bin')+'"');return c.body(object.body as any);
 });
}
