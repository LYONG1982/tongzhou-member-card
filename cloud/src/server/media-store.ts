import {lstat,mkdir,readFile,realpath,stat,unlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';

const keyPattern=/^members\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:photo|card|thumb|original)$/i;
export class MediaStore {
 private constructor(private readonly root:string){}
 static async open(root:string){
  if(!isAbsolute(root))throw new Error('MEDIA_ROOT must be an absolute path');
  const canonical=await realpath(root).catch(()=>{throw new Error('MEDIA_ROOT does not exist');});
  const info=await stat(canonical);
  if(!info.isDirectory())throw new Error('MEDIA_ROOT is not a directory');
  const probe=join(canonical,`.write-check-${process.pid}-${Date.now()}`);
  try{await writeFile(probe,'ok',{flag:'wx'});await unlink(probe);}catch{throw new Error('MEDIA_ROOT is not writable');}
  return new MediaStore(canonical);
 }
 private path(key:string){
  if(!keyPattern.test(key))throw new Error('Invalid media key');
  const file=resolve(this.root,...key.split('/'));
  if(relative(this.root,file).startsWith('..'))throw new Error('Invalid media path');
  return file;
 }
 private async checkedParent(file:string){
  const parent=dirname(file);
  await mkdir(parent,{recursive:true});
  await this.assertParent(file);
 }
 private async assertParent(file:string){
  const parent=dirname(file);
  const canonical=await realpath(parent);
  if(relative(this.root,canonical).startsWith('..'))throw new Error('Media path escapes MEDIA_ROOT');
 }
 private async rejectLink(file:string){
  const info=await lstat(file).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
  if(info?.isSymbolicLink())throw new Error('Media symlinks are not allowed');
  return info;
 }
 async put(key:string,bytes:ArrayBuffer,_metadata?:unknown){
  const file=this.path(key),body=Buffer.from(bytes);
  await this.checkedParent(file);
  await this.rejectLink(file);
  // Database rows remain pending until the mounted filesystem reads back the complete file.
  // Retrying the same key overwrites a partial write; callers already bind the key to a digest.
  await writeFile(file,body,{flag:'w'});
  const verified=await readFile(file);
  if(verified.length!==body.length||createHash('sha256').update(verified).digest('hex')!==createHash('sha256').update(body).digest('hex'))throw new Error('Media read-back verification failed');
 }
 async get(key:string){
  const file=this.path(key);
  try{await this.assertParent(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  const info=await this.rejectLink(file);
  if(!info)return null;
  if(info.size>20*1024*1024)throw new Error('Media file exceeds expected size');
  const bytes=await readFile(file).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
  if(!bytes)return null;
  return {body:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,size:bytes.byteLength};
 }
 async delete(key:string){
  const file=this.path(key);
  try{await this.assertParent(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  await this.rejectLink(file);
  await unlink(file).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
 }
}
