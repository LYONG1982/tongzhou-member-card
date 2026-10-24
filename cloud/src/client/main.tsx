import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api,send,ApiError} from './api';
import {mountEditor} from '../card/editor.js';
import editorTemplate from '../card/template.html?raw';
import './style.css';
import './member-detail.css';
import MemberDetail from './components/MemberDetail';
import {AccountAccess as AccessGate,AccountManager,type Identity} from './components/AccountAccess';
import MemberSummaryCard, {type MemberSummary} from './components/MemberSummaryCard';
import '../card/editor.css';
import './unified-workspaces.css';
import {AdminShell,AdminMembers,type AdminFilters} from './components/AdminWorkspace';
import {useSync} from './useSync';
import EmployeeHeader from './components/EmployeeHeader';
const date=(n:number)=>new Date(n).toLocaleString('zh-CN',{hour12:false});
async function request(path:string,options:RequestInit={}){try{return await api(path,options);}catch(e){if(e instanceof ApiError&&e.status===401)window.dispatchEvent(new Event('session-expired'));throw e;}}
const submit=(method:string,path:string,body:unknown)=>request(path,{method,body:JSON.stringify(body)});
async function privatePhoto(id:string){const r=await fetch('/api/media/'+id,{cache:'no-store'});if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('session-expired'));throw new Error('照片无法读取，请重新登录或重试');}return r.blob();}
async function download(id:string){
 const r=await fetch('/api/members/'+id+'/download',{cache:'no-store'});if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('session-expired'));throw new Error((await r.json() as any).error||'下载失败');}
 const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');const match=r.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''(.+)/);a.href=url;a.download=match?decodeURIComponent(match[1]):'会员卡片.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function ErrorBox({text}:{text:string}){return text?<p className="error-box" role="alert">{text}</p>:null;}
function Editor({id,go,dirty,saved,admin=false,revision=0,onCreated}:{id?:string;go:(path:string)=>void;dirty:(v:boolean)=>void;saved:()=>void;admin?:boolean;revision?:number;onCreated:(id:string)=>void}){
 const initialId=useRef(id);
 const firstRevision=useRef(revision),isDirty=useRef(false),[external,setExternal]=useState(false);useEffect(()=>{if(revision!==firstRevision.current&&isDirty.current)setExternal(true);},[revision]);
 const root=useRef<HTMLDivElement>(null),[record,setRecord]=useState<any>(undefined),[error,setError]=useState('');const latest=useRef({go,dirty,saved});latest.current={go,dirty,saved};
 useEffect(()=>{let alive=true;const id=initialId.current;if(id)request('/members/'+id+'?edit=1').then(r=>{if(alive)setRecord(r);}).catch(e=>{if(alive)setError(e.message);});else setRecord(null);return()=>{alive=false;};},[]);
 useEffect(()=>{
 if(record===undefined||!root.current)return;
 let requestKey:string;try{requestKey=sessionStorage.getItem('tz.new.request')||crypto.randomUUID();sessionStorage.setItem('tz.new.request',requestKey);}catch{requestKey=crypto.randomUUID();}
 const bridge={record,requestKey,send:submit,photo:privatePhoto,download,dirty:(v:boolean)=>{isDirty.current=v;latest.current.dirty(v);},saved:()=>{try{sessionStorage.removeItem('tz.new.request');}catch{}latest.current.saved();},done:(id:string)=>latest.current.go('/members/'+id),source:async(memberId:string,mediaId:string,file:File)=>request(`/members/${memberId}/photo-sources/${mediaId}`,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file}),created:(r:any)=>onCreated(r.id),upload:async(memberId:string,mediaId:string,kind:string,blob:Blob)=>request(`/members/${memberId}/media/${mediaId}?kind=${kind}`,{method:'PUT',headers:{'Content-Type':blob.type},body:blob})};
 if(admin){const gender=root.current.querySelector('.gender-choice')!,fields=root.current.querySelector('.fields')!;fields.insertBefore(gender,fields.children[1]);gender.querySelector('legend')!.textContent='性别';gender.querySelectorAll('label').forEach(label=>{const input=label.querySelector('input')!;for(const n of Array.from(label.childNodes))if(n.nodeType===Node.TEXT_NODE)n.textContent=input.value==='男'?'男生':'女生';});}
 return mountEditor(root.current,bridge);
 },[record]);
 return <>{external&&<p className="u-warning" role="status">工作台有新变化，当前输入已保留。保存时将检查版本；若冲突，请保留输入后重新打开资料。</p>}{admin&&<div className="admin-title"><div><h1>{id?'编辑会员':'新增会员'}</h1><p>填写会员资料，上传照片并生成推荐卡片。</p></div></div>}<ErrorBox text={error}/>{record===undefined&&!error?<p>正在读取资料…</p>:!error&&<div ref={root} className={admin?"card-editor admin-editor":"card-editor"} dangerouslySetInnerHTML={{__html:editorTemplate}}/>}</>;
}
type Filters={q:string;gender:string;marital:string;decade:string;page:string};
const emptyFilters:Filters={q:'',gender:'',marital:'',decade:'',page:'1'};
type MemberListResult = {total:number; page:number; pageSize:number; items:MemberSummary[]};
function List({go,filters,setFilters,revision,restoreScroll}:{go:(path:string)=>void;filters:Filters;setFilters:(f:Filters)=>void;revision:number;restoreScroll:()=>void}){
 const [result,setResult]=useState<MemberListResult|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[search,setSearch]=useState(filters.q),[retry,setRetry]=useState(0);const restored=useRef(false);
 useEffect(()=>{let alive=true;setLoading(true);setError('');request('/members?'+new URLSearchParams({...filters,pageSize:'16'})).then(v=>{if(alive)setResult(v);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[filters,revision,retry]);
 useEffect(()=>{if(result&&!loading&&!error&&!restored.current){restored.current=true;requestAnimationFrame(restoreScroll);}},[result,loading,error]);
 const currentPage=Number(filters.page),totalPages=Math.max(1,Math.ceil((result?.total||0)/(result?.pageSize||16)));
 useEffect(()=>{if(result&&!loading&&!error&&currentPage>totalPages)setFilters({...filters,page:String(totalPages)});},[result,loading,error,currentPage,totalPages]);
 const filter=(k:keyof Filters,v:string)=>setFilters({...filters,[k]:v,page:'1'});
 const filtered=!!(filters.q||filters.gender||filters.marital||filters.decade);
 function clear(){setSearch('');setFilters({...emptyFilters});}
 function create(){try{sessionStorage.removeItem('tz.new.request');}catch{}go('/new');}
 const pages=Array.from(new Set([1,totalPages,currentPage-1,currentPage,currentPage+1,...(currentPage<=2?[2,3]:[]),...(currentPage>=totalPages-1?[totalPages-2,totalPages-1]:[])])).filter(p=>p>=1&&p<=totalPages).sort((a,b)=>a-b);
 const pageButtons:React.ReactNode[]=[];
 pages.forEach((page,index)=>{if(index&&page-pages[index-1]>1)pageButtons.push(<span className="page-ellipsis" key={'gap'+page} aria-hidden="true">…</span>);pageButtons.push(<button key={page} className={'btn page-number'+(page===currentPage?' selected':'')} aria-label={'第'+page+'页'} aria-current={page===currentPage?'page':undefined} disabled={loading} onClick={()=>setFilters({...filters,page:String(page)})}>{page}</button>);});
 return <section className="member-home" aria-label="会员首页">
 <h1 className="sr-only">会员首页</h1>
 <form className="home-filters" onSubmit={e=>{e.preventDefault();filter('q',search);}} aria-label="会员筛选">
  <input className="home-search" aria-label="搜索姓名或编号" placeholder="搜索姓名" title="支持按姓名或会员编号搜索" value={search} onChange={e=>setSearch(e.target.value)} maxLength={64}/>
  <div className="home-gender" role="group" aria-label="性别"><span>性别</span>{[['','全部'],['男','男生'],['女','女生']].map(([value,label])=><button type="button" key={value} aria-pressed={filters.gender===value} className={filters.gender===value?'selected':''} onClick={()=>filter('gender',value)}>{label}</button>)}</div>
  <select aria-label="婚姻状况" value={filters.marital} onChange={e=>filter('marital',e.target.value)}><option value="">婚姻状况：全部</option><option value="unmarried">婚姻状况：未婚</option><option value="divorced">婚姻状况：离异</option></select>
  <select aria-label="出生年代" value={filters.decade} onChange={e=>filter('decade',e.target.value)}><option value="">出生年代：全部</option>{['1970','1980','1990','2000'].map(value=><option key={value} value={value}>出生年代：{value.slice(2)}后</option>)}</select>
  <button className="btn home-search-button" type="submit">搜索</button><button className="btn home-reset" type="button" onClick={clear}>重置</button>
  <button className="btn primary home-create" type="button" onClick={create}>＋ 新增会员</button>
 </form>
 <div className="home-results" aria-live="polite"><span>{filtered?'筛选结果':'全部会员'}</span><span className="result-total">{loading?'正在读取…':error?'读取失败':'共 '+(result?.total??0)+' 位'}</span><span className="home-sort">最近保存</span></div>
 <div aria-busy={loading}>
 {error?<div className="home-empty"><ErrorBox text={error}/><button className="btn" onClick={()=>setRetry(retry+1)}>重新加载</button></div>:loading?<div className="home-loading" role="status">正在读取会员卡片…</div>:result?.items.length===0?<div className="home-empty"><span className="empty-icon">♡</span><h2>{filtered?'没有找到匹配的会员':'这里还没有会员卡片'}</h2><p>{filtered?'可以调整筛选条件，再看看。':'新增会员并保存卡片后，即可在这里查看。'}</p><button className="btn" onClick={filtered?clear:create}>{filtered?'查看全部会员':'＋ 新增会员'}</button></div>:<div className="home-member-grid">{result?.items.map(m=><MemberSummaryCard key={m.id} member={m} onOpen={()=>go('/members/'+m.id)}/>)}</div>}
 </div>
 {result&&!error&&result.total>0&&<nav className="home-pagination" aria-label="会员分页"><span className="page-range">第 {(currentPage-1)*result.pageSize+1}–{Math.min(currentPage*result.pageSize,result.total)} 位，共 {result.total} 位</span><div className="page-controls"><button className="btn" disabled={loading||currentPage<=1} onClick={()=>setFilters({...filters,page:String(currentPage-1)})}>上一页</button>{pageButtons}<button className="btn" disabled={loading||currentPage>=totalPages} onClick={()=>setFilters({...filters,page:String(currentPage+1)})}>下一页</button></div></nav>}
 </section>;
}
function App(){
 const [identity,setIdentity]=useState<Identity|null>(null),identityRef=useRef<Identity|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[expired,setExpired]=useState(false),[syncError,setSyncError]=useState(false),[epoch,setEpoch]=useState(0);
 const [route,setRoute]=useState({path:location.pathname,creating:location.pathname==='/new',key:crypto.randomUUID()}),[filters,setFilters]=useState<Filters>({...emptyFilters}),[adminFilters,setAdminFilters]=useState<AdminFilters>({q:'',gender:'',page:'1'}),[revision,setRevision]=useState(0),[externalRevision,setExternalRevision]=useState(0);
 const dirty=useRef(false),scroll=useRef(0);
 const home=(me:Identity)=>me.user.role==='admin'?'/admin/members':'/';
 const canonical=(path:string,me:Identity)=>{if(me.user.role==='admin'){if(path==='/'||path==='/accounts')return path==='/accounts'?'/admin/users':'/admin/members';if(path==='/new')return '/admin/members/new';if(/^\/members\/[^/]+(?:\/edit)?$/.test(path))return '/admin'+path;}return path;};
 function setPath(path:string,replace=false){history[replace?'replaceState':'pushState']({},'',path);setRoute({path,creating:path==='/new',key:crypto.randomUUID()});}
 async function load(){try{const me:Identity=await api('/me');const previous=identityRef.current;
  if(previous&&previous.user.id!==me.user.id){dirty.current=false;sessionStorage.removeItem('tz.new.request');setFilters({...emptyFilters});setAdminFilters({q:'',gender:'',page:'1'});setEpoch(v=>v+1);setPath(home(me),true);}
  else if(!previous){const dest=canonical(location.pathname,me);setPath(dest==='/login'?home(me):dest,true);}
  identityRef.current=me;setIdentity(me);setExpired(false);setError('');
 }catch(e){if(!(e instanceof ApiError&&e.status===401))setError((e as Error).message);}finally{setReady(true);}}
 useEffect(()=>{void load();const expired=()=>{if(identityRef.current)setExpired(true);};const before=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue='';}};window.addEventListener('session-expired',expired);window.addEventListener('beforeunload',before);return()=>{window.removeEventListener('session-expired',expired);window.removeEventListener('beforeunload',before);};},[]);
 useSync(!!identity&&!expired,(external)=>{setRevision(v=>v+1);if(external)setExternalRevision(v=>v+1);void api<Identity>('/me').then(me=>{if(identityRef.current?.user.id===me.user.id){identityRef.current=me;setIdentity(me);}}).catch(()=>{});},setSyncError);
 useEffect(()=>{const pop=()=>{if(dirty.current&&!confirm('有未保存修改，离开将丢失这些修改。继续？')){history.pushState({},'',route.path);return;}dirty.current=false;const path=identity?canonical(location.pathname,identity):location.pathname;setPath(path,true);};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[route.path,identity]);
 function go(path:string){if(!identity)return;if(!/^\/(?:admin\/(?:members(?:\/(?:new|[a-f0-9-]+)(?:\/edit)?)?|users)|members\/[a-f0-9-]+(?:\/edit)?|new)?$/.test(path))return;if(dirty.current&&!confirm('有未保存修改，离开将丢失这些修改。继续？'))return;if(route.path==='/')scroll.current=window.scrollY;dirty.current=false;setPath(canonical(path,identity));if(path!=='/')window.scrollTo(0,0);}
 async function logout(){if(dirty.current&&!confirm('退出将清除当前未保存内容。继续？'))return;try{await submit('POST','/logout',{});}catch(e){if(!(e instanceof ApiError&&e.status===401)){setError((e as Error).message);return;}}dirty.current=false;sessionStorage.removeItem('tz.new.request');identityRef.current=null;setIdentity(null);setExpired(false);setFilters({...emptyFilters});setAdminFilters({q:'',gender:'',page:'1'});setEpoch(v=>v+1);setPath('/login',true);}
 if(!ready)return <div className="empty">正在连接工作台…</div>;
 if(!identity)return <><AccessGate onDone={()=>void load()}/>{error&&<p className="error-box">{error}</p>}</>;
 const isAdmin=identity.user.role==='admin',match=route.path.match(isAdmin?/^\/admin\/members\/([a-f0-9-]+)(\/edit)?$/:/^\/members\/([a-f0-9-]+)(\/edit)?$/),isNew=route.path===(isAdmin?'/admin/members/new':'/new'),isHome=route.path===(isAdmin?'/admin/members':'/'),isAccounts=isAdmin&&route.path==='/admin/users';
 let content:React.ReactNode;
 if(!isAdmin&&route.path.startsWith('/admin'))content=<div className="u-empty"><h1>无权访问管理控制台</h1><p>当前账号仅可使用员工工作台。</p><button className="btn" onClick={()=>go('/')}>返回会员首页</button></div>;
 else if(isAccounts)content=<AccountManager identity={identity} revision={revision}/>;
 else if(isNew||match?.[2])content=<Editor key={route.key} id={match?.[1]} go={go} admin={isAdmin} revision={externalRevision} onCreated={id=>{const path=(isAdmin?'/admin':'')+'/members/'+id+'/edit';history.replaceState({},'',path);setRoute(r=>({...r,path}));}} dirty={v=>{dirty.current=v;}} saved={()=>setRevision(v=>v+1)}/>;
 else if(match)content=<MemberDetail key={match[1]} id={match[1]} go={go} identity={identity} download={download} onLogin={()=>setExpired(true)} admin={isAdmin} externalRevision={revision}/>;
 else if(isHome)content=isAdmin?<AdminMembers filters={adminFilters} setFilters={setAdminFilters} revision={revision} go={go}/>:<List go={go} filters={filters} setFilters={setFilters} revision={revision} restoreScroll={()=>window.scrollTo(0,scroll.current)}/>;
 else content=<div className="u-empty"><h1>页面不存在</h1><button className="btn" onClick={()=>go(home(identity))}>返回工作台</button></div>;
 return <div key={epoch}>{syncError&&<p className="u-sync-warning" role="status">同步暂不可用，当前内容已保留；连接恢复后将自动刷新。</p>}{isAdmin?<AdminShell path={route.path} go={go} logout={logout} name={identity.user.displayName}>{error&&<ErrorBox text={error}/>} {content}</AdminShell>:<div className={'employee-shell '+(isHome?'home-shell':match&&!match[2]?'v2-shell':'')}><EmployeeHeader identity={identity} creating={route.creating} pageKey={route.key} go={go} logout={logout}/><main className={isHome?'home-workspace':match&&!match[2]?'v2-workspace':'workspace'}><ErrorBox text={error}/>{content}</main></div>}{expired&&<AccessGate overlay onDone={()=>void load()}/>}</div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
