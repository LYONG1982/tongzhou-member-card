export class ApiError extends Error { constructor(message:string,public status:number){super(message);} }
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T> {
 const headers=new Headers(options.headers);if(typeof options.body==='string'&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
 const response=await fetch('/api'+path,{...options,headers,credentials:'same-origin',cache:'no-store'});
 if(!response.ok){let error='请求失败，请稍后重试';try{error=(await response.json() as any).error||error;}catch{}throw new ApiError(error,response.status);}
 return response.json() as Promise<T>;
}
export const send=(method:string,path:string,body:unknown)=>api(path,{method,body:JSON.stringify(body)});
