type LogFields=Record<string,unknown>;
type LogLevel='info'|'warn'|'error';

const sensitiveKey=/password|passwd|secret|token|cookie|authorization|databaseurl|connection.?string|credential/i;

function knownSecrets(){
 const values:string[]=[];
 const connectionString=process.env.DATABASEURL;
 if(connectionString){
  values.push(connectionString);
  try{
   const parsed=new URL(connectionString);
   if(parsed.password){values.push(parsed.password);try{values.push(decodeURIComponent(parsed.password));}catch{}}
  }catch{}
 }
 return [...new Set(values)].filter(Boolean).sort((a,b)=>b.length-a.length);
}

function redactText(value:string){
 let safe=value;
 for(const secret of knownSecrets())safe=safe.split(secret).join('[REDACTED]');
 return safe
  .replace(/\b(postgres(?:ql)?:\/\/)[^\s"'`<>]+/gi,'$1[REDACTED]')
  .replace(/((?:password|passwd|pwd)\s*[=:]\s*)[^\s,;]+/gi,'$1[REDACTED]')
  .replace(/([?&](?:password|sslpassword|token|secret)=)[^&\s]+/gi,'$1[REDACTED]');
}

function sanitize(value:unknown,key=''):unknown{
 if(sensitiveKey.test(key))return '[REDACTED]';
 if(typeof value==='string')return redactText(value);
 if(value instanceof Error)return errorFields(value);
 if(Array.isArray(value))return value.map(item=>sanitize(item));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,sanitize(item,name)]));
 return value;
}

function errorFields(error:unknown){
 if(error instanceof Error){
  const code=(error as Error&{code?:unknown}).code;
  const postgresCode=typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code);
  return {error_name:error.name,error_message:postgresCode?`PostgreSQL operation failed (${code})`:redactText(error.message),...(typeof code==='string'||typeof code==='number'?{error_code:code}:{})};
 }
 return {error_name:'UnknownError',error_message:redactText(String(error))};
}

function write(level:LogLevel,event:string,fields:LogFields={}){
 const record=sanitize({timestamp:new Date().toISOString(),level,event,...fields}) as LogFields;
 const line=JSON.stringify(record);
 if(level==='error')console.error(line);else if(level==='warn')console.warn(line);else console.log(line);
}

export const logInfo=(event:string,fields:LogFields={})=>write('info',event,fields);
export const logWarn=(event:string,fields:LogFields={})=>write('warn',event,fields);
export const logError=(event:string,error:unknown,fields:LogFields={})=>write('error',event,{...fields,...errorFields(error)});
