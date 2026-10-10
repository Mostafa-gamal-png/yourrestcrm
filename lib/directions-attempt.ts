/** Bound only the screen's wait. Native mutations remain serialized by the
 * tracker, which checks cancellation before the next mutation. A late result
 * is consumed here and cannot open a stale destination or leak a rejection. */
export const DIRECTIONS_START_TIMEOUT_MS=30_000;
export function waitForDirectionsStep<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(callback:()=>void)=>{if(settled)return;settled=true;signal.removeEventListener('abort',aborted);callback();};
  const aborted=()=>finish(()=>{const error=new Error('directions_cancelled');error.name='AbortError';reject(error);});
  signal.addEventListener('abort',aborted,{once:true});
  work.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
  if(signal.aborted)aborted();
 });
}
