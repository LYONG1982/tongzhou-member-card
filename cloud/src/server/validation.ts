import {z} from 'zod';
export const uuid = z.string().uuid();
export const gender = z.enum(['男','女']);
export const loginInput=z.object({username:z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9_.@-]+$/).transform(v=>v.toLowerCase()), password:z.string().min(5,'密码至少 5 位').max(128)});
export const newPassword=z.string().min(5,'密码至少 5 位').max(128,'密码最多 128 位');
export const profileInput=z.object({gender,memberName:z.string().trim().min(1).max(40),birth:z.string().regex(/^\d{4}$/).refine(v=>+v>=1900&&+v<=new Date().getFullYear(),'出生年份无效'),height:z.coerce.number().int().min(100).max(230),ethnic:z.string().max(12),marital:z.enum(['未婚','离异','离异未育','短婚未育','离异有孩（不随身）','离异有孩']),edu:z.string().min(1).max(16),job:z.string().max(24),income:z.string().max(24),assets:z.string().max(30),family:z.string().max(600),review:z.string().max(1200),match:z.string().max(1200)}).strict();
export const editorInput=z.object({transform:z.object({x:z.number().finite().min(-100000).max(100000),y:z.number().finite().min(-100000).max(100000),zoom:z.number().min(1).max(3)}).strict(),privacy:z.enum(['','cover','original']),mask:z.object({x:z.number().min(0).max(612),y:z.number().min(0).max(816),size:z.number().min(80).max(900)}).nullable(),template:z.literal('figma-v1')}).strict();
export const draftInput=z.object({operationId:uuid,version:z.number().int().min(0),profile:profileInput,editor:editorInput,photoId:uuid}).strict();
export const confirmInput=z.object({operationId:uuid,version:z.number().int().min(1),editor:editorInput.refine(v=>v.privacy==='original'||(v.privacy==='cover'&&v.mask!==null),'请选择照片展示方式'),cardId:uuid,thumbId:uuid}).strict();
export function imageInfo(bytes:ArrayBuffer,type:string) {
 const b=new Uint8Array(bytes), view=new DataView(bytes); let width=0,height=0;
 if(type==='image/png'&&b.length>=45&&[137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n)) {
   if(view.getUint32(8)!==13||view.getUint32(12)!==0x49484452) throw Error('PNG 文件无效');
   width=view.getUint32(16);height=view.getUint32(20);
   if(![73,69,78,68].every((n,i)=>b[b.length-8+i]===n)) throw Error('PNG 文件不完整');
 } else if(type==='image/jpeg'&&b.length>20&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217) {
   let p=2; while(p+8<b.length) {if(b[p++]!==255) break;while(b[p]===255)p++;const m=b[p++];if(m===0xda||m===0xd9)break;const len=view.getUint16(p);if(len<2||p+len>b.length)break;if([0xc0,0xc1,0xc2].includes(m)){height=view.getUint16(p+3);width=view.getUint16(p+5);break;}p+=len;}
 } else throw Error('仅接受应用生成的 JPG 或 PNG 图片');
 if(!width||!height||width*height>50_000_000||Math.max(width,height)>20000)throw Error('图片尺寸无效');
 return {width,height};
}
