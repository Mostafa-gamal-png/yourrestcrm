export type InstallSnapshot={available:boolean;busy:boolean;installed:boolean};
export type InstallOutcome='installed'|'busy'|'unavailable'|'accepted'|'dismissed'|'error';
export type InstallController={
 snapshot:()=>InstallSnapshot;
 subscribe:(listener:(state:InstallSnapshot)=>void)=>()=>void;
 request:()=>Promise<InstallOutcome>;
};
declare global {interface Window {__yourrestInstall?:InstallController}}
// The synchronous layout bootstrap owns the prompt, even before login hydrates.
export function installController(){return typeof window==='undefined'?undefined:window.__yourrestInstall;}

let workerRegistrationStarted=false;
export function registerInstallWorker(){
 if(workerRegistrationStarted||typeof window==='undefined'||!window.isSecureContext||!('serviceWorker' in navigator))return;
 workerRegistrationStarted=true;
 try{void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{workerRegistrationStarted=false;});}
 catch{workerRegistrationStarted=false;}
}
