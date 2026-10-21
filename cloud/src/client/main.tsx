import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api,send,ApiError} from './api';
import {mountEditor} from '../card/editor.js';
import editorTemplate from '../card/template.html?raw';
import './style.css';
import '../card/editor.css';
const date=(n:number)=>new Date(n).toLocaleString('zh-CN',{hour12:false});
async function request(path:string,options:RequestInit={}){try{return await api(path,options);}catch(e){if(e instanceof ApiError&&e.status===401)window.dispatchEvent(new Event('session-expired'));throw e;}}
const submit=(method:string,path:string,body:unknown)=>request(path,{method,body:JSON.stringify(body)});
async function privatePhoto(id:string){const r=await fetch('/api/media/'+id,{cache:'no-store'});if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('session-expired'));throw new Error('照片无法读取，请重新登录或重试');}return r.blob();}
async function download(id:string){
 const r=await fetch('/api/members/'+id+'/download',{cache:'no-store'});if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('session-expired'));throw new Error((await r.json() as any).error||'下载失败');}
 const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');const match=r.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''(.+)/);a.href=url;a.download=match?decodeURIComponent(match[1]):'会员卡片.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function ErrorBox({text}:{text:string}){return text?<p className="error-box" role="alert">{text}</p>:null;}
function AccessGate({onDone,overlay=false}:{onDone:()=>void;overlay?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function handle(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;setBusy(true);setError('');try{await send('POST','/login',{code:new FormData(form).get('code')});form.reset();onDone();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className={overlay?'modal-backdrop':'auth-page'}><section className="auth-panel"><div className="brand-mark">同舟婚恋 <span>TONGZHOU</span></div><h1>{overlay?'重新输入访问码':'会员卡片工作台'}</h1><p className="muted">{overlay?'访问已过期，当前编辑内容仍保留。':'请输入访问码，开始制作与管理会员卡片。'}</p><form onSubmit={handle}><label>访问码<input name="code" type="password" autoComplete="off" required maxLength={128} placeholder="请输入访问码"/></label><ErrorBox text={error}/><button className="btn primary" disabled={busy}>{busy?'正在验证…':'进入工作台'}</button></form><p className="muted small">资料与图片仅持访问码的人可查看。</p></section></div>;
}
function Editor({id,go,dirty,saved}:{id?:string;go:(path:string)=>void;dirty:(v:boolean)=>void;saved:()=>void}){
 const root=useRef<HTMLDivElement>(null),[record,setRecord]=useState<any>(undefined),[error,setError]=useState('');const latest=useRef({go,dirty,saved});latest.current={go,dirty,saved};
 useEffect(()=>{let alive=true;if(id)request('/members/'+id+'?edit=1').then(r=>{if(alive)setRecord(r);}).catch(e=>{if(alive)setError(e.message);});else setRecord(null);return()=>{alive=false;};},[id]);
 useEffect(()=>{
 if(record===undefined||!root.current)return;
 let requestKey:string;try{requestKey=sessionStorage.getItem('tz.new.request')||crypto.randomUUID();sessionStorage.setItem('tz.new.request',requestKey);}catch{requestKey=crypto.randomUUID();}
 const bridge={record,requestKey,send:submit,photo:privatePhoto,download,dirty:(v:boolean)=>latest.current.dirty(v),saved:()=>latest.current.saved(),created:(r:any)=>{history.replaceState({},'', '/members/'+r.id+'/edit');},next:()=>{try{sessionStorage.removeItem('tz.new.request');}catch{}latest.current.go('/new');},upload:async(memberId:string,mediaId:string,kind:string,blob:Blob)=>request(`/members/${memberId}/media/${mediaId}?kind=${kind}`,{method:'PUT',headers:{'Content-Type':blob.type},body:blob})};
 return mountEditor(root.current,bridge);
 },[record]);
 return <><div className="page-heading"><div><p className="eyebrow">会员工作台 / {id?'编辑资料':'创建会员'}</p><h1>{id?'继续制作会员卡片':'创建会员卡片'}</h1></div><button className="btn" onClick={()=>go('/')}>返回列表</button></div><ErrorBox text={error}/>{record===undefined&&!error?<p>正在读取资料…</p>:!error&&<div ref={root} className="card-editor" dangerouslySetInnerHTML={{__html:editorTemplate}}/>}</>;
}
type Filters={q:string;gender:string;marital:string;decade:string;page:string};
const emptyFilters:Filters={q:'',gender:'',marital:'',decade:'',page:'1'};
function FilterTags({title,options,value,onChange}:{title:string;options:string[][];value:string;onChange:(v:string)=>void}){
 return <div className="filter-row"><span>{title}</span><div role="group" aria-label={title}>{options.map(([key,label])=><button key={key} type="button" aria-pressed={value===key} className={value===key?'selected':''} onClick={()=>onChange(key)}>{label}</button>)}</div></div>;
}
function List({go,filters,setFilters,revision,restoreScroll}:{go:(path:string)=>void;filters:Filters;setFilters:(f:Filters)=>void;revision:number;restoreScroll:()=>void}){
 const [result,setResult]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[search,setSearch]=useState(filters.q),[retry,setRetry]=useState(0);const restored=useRef(false);
 useEffect(()=>{let alive=true;setLoading(true);setError('');request('/members?'+new URLSearchParams(filters)).then(v=>{if(alive)setResult(v);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[filters,revision,retry]);
 useEffect(()=>{if(result&&!loading&&!restored.current){restored.current=true;requestAnimationFrame(restoreScroll);}},[result,loading]);
 const filter=(k:keyof Filters,v:string)=>setFilters({...filters,[k]:v,page:'1'});
 const filtered=!!(filters.q||filters.gender||filters.marital||filters.decade);
 function clear(){setSearch('');setFilters({...emptyFilters});}
 return <><div className="page-heading"><div><h1>会员卡片 <span className="count">{result?.total??'—'}</span></h1></div><button className="btn primary" onClick={()=>{try{sessionStorage.removeItem('tz.new.request');}catch{}go('/new');}}>＋ 创建会员卡片</button></div>
 <section className="filter-panel"><div className="toolbar"><form onSubmit={e=>{e.preventDefault();filter('q',search);}} className="search"><input aria-label="搜索姓名或编号" placeholder="搜索姓名或编号" value={search} onChange={e=>setSearch(e.target.value)} maxLength={64}/><button className="btn">搜索</button></form><select aria-label="筛选性别" value={filters.gender} onChange={e=>filter('gender',e.target.value)}><option value="">全部性别</option><option>男</option><option>女</option></select><button className="btn" disabled={!filtered} onClick={clear}>清除筛选</button></div>
 <FilterTags title="婚姻状况" options={[["","全部"],["unmarried","未婚"],["divorced","离异"]]} value={filters.marital} onChange={v=>filter('marital',v)}/>
 <FilterTags title="出生年代" options={[["","全部"],["1970","70后"],["1980","80后"],["1990","90后"],["2000","00后"]]} value={filters.decade} onChange={v=>filter('decade',v)}/></section>
 {error?<><ErrorBox text={error}/><button className="btn" onClick={()=>setRetry(retry+1)}>重新加载</button></>:loading?<div className="empty">正在读取会员卡片…</div>:result?.items.length===0?<div className="empty"><span className="empty-icon">♡</span><h2>{filtered?'没有找到匹配的会员':'这里还没有会员卡片'}</h2><p>{filtered?'可以调整筛选条件，再看看。':'点击右上角创建，保存后即可在这里查看。'}</p>{filtered&&<button className="btn" onClick={clear}>查看全部会员</button>}</div>:<div className="member-grid">{result?.items.map((m:any)=><article key={m.id} className={'member-card '+(m.gender==='女'?'pink':'blue')}>
 <button className="card-image" aria-label={'查看 '+m.name} onClick={()=>go('/members/'+m.id)}><img src={'/api/media/'+m.thumb_id} loading="lazy" alt="会员卡片" onError={e=>{e.currentTarget.style.visibility='hidden';e.currentTarget.parentElement?.setAttribute('data-error','图片加载失败，点击查看并重试');}}/></button>
 <div className="card-content"><div className="card-title"><h2>{m.name}</h2></div><p className="code">{m.number}</p><p className="summary">{[m.gender,m.birth&&m.birth+'年',m.height&&m.height+'cm',m.edu,m.marital].filter(Boolean).join(' · ')}</p><div className="card-meta"><time>更新于 {date(m.updated_at)}</time></div><div className="card-actions"><button className="btn" onClick={()=>go('/members/'+m.id)}>查看资料</button><button className="btn" onClick={()=>download(m.id).catch(e=>setError(e.message))}>下载卡片</button></div></div></article>)}</div>}
 {result&&result.total>0&&<div className="pagination"><span>共 {result.total} 条 · 每页 24 条</span><button className="btn" disabled={loading||Number(filters.page)<=1} onClick={()=>setFilters({...filters,page:String(Number(filters.page)-1)})}>上一页</button><span>{filters.page} / {Math.max(1,Math.ceil(result.total/24))}</span><button className="btn" disabled={loading||Number(filters.page)*24>=result.total} onClick={()=>setFilters({...filters,page:String(Number(filters.page)+1)})}>下一页</button></div>}</>;
}
function Detail({id,go}:{id:string;go:(p:string)=>void}){
 const [m,setM]=useState<any>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setM(null);setError('');request('/members/'+id).then(r=>{if(active)setM(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id,retry]);
 return <><div className="page-heading"><div><h1>{m?.profile.memberName||'会员资料'}</h1><p className="code">{m?.number}</p></div><button className="btn" onClick={()=>go('/')}>返回列表</button></div><ErrorBox text={error}/>{error&&<button className="btn" onClick={()=>setRetry(retry+1)}>重试</button>}{m&&<><div className="detail-actions"><button className="btn primary" onClick={()=>go('/members/'+id+'/edit')}>编辑资料</button><button className="btn" onClick={()=>download(id).catch(e=>setError(e.message))}>下载卡片</button></div>
 <div className="detail-grid"><section className="surface"><h2>会员资料</h2><dl className="data-list">{Object.entries({memberName:'姓名',gender:'性别',birth:'出生年份',height:'身高',ethnic:'民族',marital:'婚姻状况',edu:'学历',job:'工作',income:'月收入',assets:'资产',family:'家庭情况',review:'红娘评价',match:'择偶要求'}).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{m.profile[key]||'未填写'}</dd></div>)}</dl></section><section className="surface"><h2>工作照片</h2><p className="muted small">成品中的卡通遮挡不会改变这里保存的工作照片。</p><img className="work-photo" src={'/api/media/'+m.photoId} alt="会员工作照片" onError={()=>setError('照片读取失败，请点击重试。')}/></section></div><section className="surface"><h2>会员卡片</h2><img className="poster" src={'/api/media/'+m.confirmed.cardId} alt="会员卡片成品" onError={()=>setError('成品读取失败，请点击重试。')}/></section></>}</>;
}
function App(){
 const [signedIn,setSignedIn]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[expired,setExpired]=useState(false);
 const [route,setRoute]=useState({path:location.pathname,key:crypto.randomUUID()}),[filters,setFilters]=useState<Filters>({...emptyFilters}),[revision,setRevision]=useState(0),[opens,setOpens]=useState('');
 const dirty=useRef(false),scroll=useRef(0);
 async function load(){try{const s=await api('/status');if(!s.configured)throw new Error('工作台入口尚在配置，请稍后再试。');try{await api('/me');setSignedIn(true);setExpired(false);}catch(e){if(!(e instanceof ApiError)||e.status!==401)throw e;}}catch(e){setError((e as Error).message);}finally{setReady(true);}}
 useEffect(()=>{void load();const expired=()=>setExpired(true);window.addEventListener('session-expired',expired);const before=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',before);
 const pageKey='tongzhou.memberCard.pageOpenCount.v1';const count=async()=>{try{const increment=()=>{const old=localStorage.getItem(pageKey);const n=old?JSON.parse(old).count:0;if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(n+1))throw Error();localStorage.setItem(pageKey,JSON.stringify({version:1,count:n+1}));setOpens('本机已打开 '+(n+1)+' 次');};if(navigator.locks)await navigator.locks.request('tongzhou.memberCard.page-open-lock.v1',increment);else increment();}catch{setOpens('打开次数暂不可用');}};void count();
 return()=>{window.removeEventListener('session-expired',expired);window.removeEventListener('beforeunload',before);};},[]);
 useEffect(()=>{const pop=()=>{if(dirty.current&&!confirm('有未保存修改，离开将丢失这些修改。继续？')){history.pushState({},'',route.path);return;}dirty.current=false;setRoute({path:location.pathname,key:crypto.randomUUID()});};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[route.path]);
 function go(path:string){if(dirty.current&&!confirm('有未保存修改，离开将丢失这些修改。继续？'))return;if(route.path==='/')scroll.current=window.scrollY;dirty.current=false;history.pushState({},'',path);setRoute({path,key:crypto.randomUUID()});if(path!=='/')window.scrollTo(0,0);}
 async function logout(){if(dirty.current&&!confirm('退出将清除当前未保存内容。继续？'))return;try{await submit('POST','/logout',{});dirty.current=false;setSignedIn(false);location.replace('/');}catch(e){setError((e as Error).message);}}
 if(!ready)return <div className="empty">正在连接工作台…</div>;
 if(error&&!signedIn)return <div className="auth-page"><section className="auth-panel"><h1>工作台暂时无法连接</h1><ErrorBox text={error}/><button className="btn" onClick={()=>{setError('');setReady(false);void load();}}>重试连接</button></section></div>;
 if(!signedIn)return <AccessGate onDone={()=>void load()}/>;
 const match=route.path.match(/^\/members\/([^/]+)(\/edit)?$/);
 return <><header className="app-header"><button className="brand-mark" onClick={()=>go('/')}>同舟婚恋 <span>会员卡片工作台</span></button><nav><button className={route.path==='/'?'selected':''} onClick={()=>go('/')}>会员卡片</button><button onClick={logout}>退出工作台</button></nav></header><div className="privacy-strip"><span>资料与图片保存至工作台，仅持访问码的人可查看</span><span>{opens}</span></div><main className="workspace"><ErrorBox text={error}/>{route.path==='/new'||match?.[2]?<Editor key={route.key} id={match?.[1]} go={go} dirty={v=>{dirty.current=v;}} saved={()=>setRevision(v=>v+1)}/>:match?<Detail id={match[1]} go={go}/>:<List go={go} filters={filters} setFilters={setFilters} revision={revision} restoreScroll={()=>window.scrollTo(0,scroll.current)}/>}</main>{expired&&<AccessGate overlay onDone={()=>void load()}/>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);
