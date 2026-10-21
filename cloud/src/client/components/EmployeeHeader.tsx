import {useEffect,useRef,useState} from 'react';
import type {Identity} from './AccountAccess';

export default function EmployeeHeader({identity,creating,pageKey,go,logout}:{identity:Identity;creating:boolean;pageKey:string;go:(path:string)=>void;logout:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const area=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const name=identity.user.displayName.trim()||identity.user.username;
 useEffect(()=>setOpen(false),[pageKey]);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!area.current?.contains(e.target as Node))setOpen(false);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 async function signOut(){setBusy(true);try{await logout();}finally{setBusy(false);setOpen(false);trigger.current?.focus();}}
 return <header className="employee-header"><div className="employee-header-inner">
  <div className="employee-brand-group"><button className="employee-brand" onClick={()=>go('/')} aria-label="同舟婚恋，返回会员工作台"><span className="employee-logo" aria-hidden="true"><img src="/brand/brand-logo.png" alt=""/></span><strong>同舟婚恋</strong></button><span className="employee-system-name">会员卡片管理系统</span></div>
  <nav className="employee-nav" aria-label="员工主导航"><button aria-current={!creating?'page':undefined} onClick={()=>go('/')}>会员工作台</button><button aria-current={creating?'page':undefined} onClick={()=>go('/new')}>创建会员</button></nav>
  <div className="employee-account" ref={area} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOpen(false);}}>
   <button className="employee-account-trigger" ref={trigger} aria-label={'账户菜单：'+name} aria-expanded={open} aria-controls="employee-account-panel" onClick={()=>setOpen(v=>!v)}><span className="employee-avatar" aria-hidden="true">{Array.from(name)[0]}</span><span className="employee-account-name" title={name}>{name}</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></button>
   {open&&<div className="employee-account-panel" id="employee-account-panel" role="region" aria-label="当前账户"><strong>{name}</strong><span>{identity.user.username}</span><span className="employee-role">员工账号</span><button onClick={()=>void signOut()} disabled={busy}>{busy?'正在退出…':'退出登录'}</button></div>}
  </div>
 </div></header>;
}
