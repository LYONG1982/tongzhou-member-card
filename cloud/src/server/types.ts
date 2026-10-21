export type User = {id:string;username:string;displayName:string;role:string;active:number};
export type Bindings = {DB:D1Database;MEDIA:R2Bucket;ASSETS:Fetcher;ENVIRONMENT:string;ACCESS_CODE_HASH?:string;BOOTSTRAP_TOKEN_HASH?:string};
export type Env = {Bindings:Bindings;Variables:{user:User;sessionHash:string;authKind:'personal'|'shared'}};
