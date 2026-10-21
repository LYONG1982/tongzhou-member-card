import {HTTPException} from 'hono/http-exception';
import type {Context} from 'hono';
import type {Env} from './types';
export type Ctx=Context<Env>;
export function fail(status:400|401|403|404|409|410|413|429|503,message:string):never {throw new HTTPException(status,{message});}
export async function json(c:Ctx){if(!c.req.header('content-type')?.startsWith('application/json'))fail(400,'请求格式无效');return c.req.json();}
export function personal(c:Ctx){if(c.get('authKind')!=='personal')fail(403,'请使用老师个人账号登录后操作');return c.get('user');}
export function admin(c:Ctx){const u=personal(c);if(u.role!=='admin')fail(403,'仅管理员可执行此操作');return u;}
export const numberFor=(n:number)=>'TZ-'+String(n).padStart(5,'0');
