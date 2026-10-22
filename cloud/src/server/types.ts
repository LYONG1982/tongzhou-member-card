import type {PgDatabase} from './database';
import type {MediaStore} from './media-store';
export type User = {id:string;username:string;displayName:string;role:string;active:number};
export type Bindings = {DB:PgDatabase;MEDIA:MediaStore;ENVIRONMENT:string;PUBLIC_ORIGIN:string;BOOTSTRAP_TOKEN_HASH?:string;CLIENT_IP_HEADER?:string;TRUSTED_PROXY_IPS?:string;REMOTE_IP?:string};
export type Env = {Bindings:Bindings;Variables:{user:User;sessionHash:string;authKind:'personal'|'shared'}};
