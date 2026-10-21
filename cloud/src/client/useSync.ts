import {useEffect,useRef} from 'react';
import {api} from './api';
// One in-flight request; hidden tabs stop polling. Failed requests back off to 30s.
export function useSync(enabled:boolean,onChanged:(external:boolean)=>void,onFailure:(failed:boolean)=>void){
 const latest=useRef(onChanged),status=useRef(onFailure);latest.current=onChanged;status.current=onFailure;
 useEffect(()=>{if(!enabled)return;let disposed=false,inFlight=false,suppress=false,timer:ReturnType<typeof setTimeout>|undefined,version:number|undefined,delay=3000;const controller=new AbortController();
  const schedule=()=>{clearTimeout(timer);if(!disposed&&!document.hidden)timer=setTimeout(tick,delay);};
  async function tick(){if(disposed||inFlight||document.hidden)return;clearTimeout(timer);inFlight=true;try{const data=await api('/sync',{signal:controller.signal});if(disposed)return;if(version!==undefined&&version!==data.version&&!suppress)latest.current(true);suppress=false;version=data.version;delay=3000;status.current(false);}catch{if(!disposed)status.current(true);delay=Math.min(delay*2,30000);}finally{inFlight=false;schedule();}}
  const focus=()=>{if(document.hidden)clearTimeout(timer);else void tick();};const changed=()=>{suppress=true;latest.current(false);void tick();};
  void tick();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);window.addEventListener('data-changed',changed);
  return()=>{disposed=true;controller.abort();clearTimeout(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.removeEventListener('data-changed',changed);};
 },[enabled]);
}
