// «المستهدفات والنتائج في مكان واحد» (the owner's picture, 2026-11-11): the tabs of the targets page and the tab a reload returns to.
// The address keeps it (?tab=collection beside #targets), and the browser remembers the last one for each person; neither is a secret
// nor a right: a tab the person may not use (lib/permissions.ts) is never shown, whatever the address says.
export const HUB_TABS=['results','sales','collection','quotes','targets'] as const;
export type HubTab=typeof HUB_TABS[number];
export const isHubTab=(value:unknown):value is HubTab=>typeof value==='string'&&(HUB_TABS as readonly string[]).includes(value);
const storageKey=(memberId:string)=>'yr-targets-tab:'+memberId;
type Place={location?:{search?:string;pathname?:string;hash?:string};history?:{replaceState?:(data:unknown,unused:string,url?:string)=>void};localStorage?:{getItem(key:string):string|null;setItem(key:string,value:string):void}};
const place=():Place|null=>typeof window==='undefined'?null:window as unknown as Place;
/** The tab of the address, else the one this browser remembers for the person, else «نتائج الأداء». */
export function initialHubTab(memberId:string):HubTab{
 const w=place();if(!w)return 'results';
 try{const fromUrl=new URLSearchParams(w.location?.search||'').get('tab');if(isHubTab(fromUrl))return fromUrl;}catch{/* no address */}
 try{const saved=w.localStorage?.getItem(storageKey(memberId));if(isHubTab(saved))return saved;}catch{/* storage blocked */}
 return 'results';
}
function writeAddress(tab:HubTab|null){
 const w=place();if(!w?.location||!w.history?.replaceState)return;
 try{const query=new URLSearchParams(w.location.search||'');if(tab)query.set('tab',tab);else query.delete('tab');const search=query.toString();w.history.replaceState(null,'',(w.location.pathname||'/')+(search?'?'+search:'')+(w.location.hash||''));}catch{/* the address stays as it is */}
}
export function rememberHubTab(memberId:string,tab:HubTab){
 writeAddress(tab);
 try{place()?.localStorage?.setItem(storageKey(memberId),tab);}catch{/* storage blocked: the address still holds it */}
}
/** Leaving the page takes the tab out of the address (the browser still remembers it for the next visit). */
export function forgetHubTab(){writeAddress(null);}
