import {readFileSync} from 'node:fs';
import pg, {type PoolClient, type QueryResultRow} from 'pg';

// PostgreSQL returns int8 (including COUNT and millisecond timestamps) as strings by default.
// Values used by this application fit within Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(pg.types.builtins.INT8, value => {
 const parsed=Number(value);
 if(!Number.isSafeInteger(parsed))throw new Error('PostgreSQL integer exceeds JavaScript safe range');
 return parsed;
});

type Statement={sql:string;values:unknown[]};
type Result<T>={results:T[];meta:{changes:number}};
function placeholders(sql:string,values:unknown[]){let n=0;const rewritten=sql.replace(/\?/g,()=>`$${++n}`);if(n!==values.length)throw new Error(`SQL parameter count mismatch: expected ${n}, received ${values.length}`);return rewritten;}

export class PgDatabase {
 constructor(private readonly client:pg.Pool|PoolClient){}
 statement(sql:string,...values:unknown[]):Statement{return {sql,values};}
 async one<T extends QueryResultRow=any>(sql:string,...values:unknown[]):Promise<T|null>{return (await this.query<T>(sql,values)).results[0]??null;}
 async many<T extends QueryResultRow=any>(sql:string,...values:unknown[]):Promise<Result<T>>{return this.query<T>(sql,values);}
 async exec(sql:string,...values:unknown[]):Promise<Result<any>>{return this.query(sql,values);}
 async transactionBatch(statements:Statement[]){return this.transaction(async tx=>{
  const results=[];
  for(const statement of statements)results.push(await tx.query(statement.sql,statement.values));
  return results;
 });}
 async query<T extends QueryResultRow=any>(sql:string,values:unknown[]=[]):Promise<Result<T>>{
  const result=await this.client.query<T>(placeholders(sql,values),values);
  return {results:result.rows,meta:{changes:result.rowCount??0}};
 }
 async transaction<T>(operation:(transaction:PgDatabase)=>Promise<T>):Promise<T>{
  if(!(this.client instanceof pg.Pool))throw new Error('Nested database transaction is not supported');
  const client=await this.client.connect();
  try{
   await client.query('BEGIN');
   const result=await operation(new PgDatabase(client));
   await client.query('COMMIT');
   return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}

export function createPoolFromEnv(env:NodeJS.ProcessEnv){
 const required=['PGHOST','PGDATABASE','PGUSER','PGPASSWORD'] as const;
 for(const key of required)if(!env[key])throw new Error(`Missing required configuration: ${key}`);
 const mode=env.PG_SSL_MODE||'disable';
 if(!['disable','verify-full'].includes(mode))throw new Error('PG_SSL_MODE must be disable or verify-full');
 const port=Number(env.PGPORT||5432);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PGPORT must be a valid TCP port');
 const max=Number(env.PG_POOL_MAX||10);
 if(!Number.isInteger(max)||max<1||max>100)throw new Error('PG_POOL_MAX must be between 1 and 100');
 if(env.PGSCHEMA&&!/^[a-z][a-z0-9_]{0,62}$/.test(env.PGSCHEMA))throw new Error('PGSCHEMA has an invalid name');
 const ssl=mode==='disable'?false:{rejectUnauthorized:true,ca:env.PG_SSL_CA_FILE?readFileSync(env.PG_SSL_CA_FILE,'utf8'):undefined};
 return new pg.Pool({host:env.PGHOST,port,database:env.PGDATABASE,user:env.PGUSER,password:env.PGPASSWORD,ssl,max,options:env.PGSCHEMA?`-c search_path=${env.PGSCHEMA}`:undefined});
}
