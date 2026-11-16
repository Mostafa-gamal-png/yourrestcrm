// «المستهدفات والنتائج في مكان واحد» (the owner's picture, 2026-11-11): the tabs of the targets page and the tab a reload returns to.
// The address keeps it (?tab=collection beside #targets), and the browser remembers the last one for each person; neither is a secret
// nor a right: a tab the person may not use (lib/permissions.ts: the role, «المبيعات», and since 2026-11-16 the tabs the administrator
// hid from the member, hubTabsOf) is never shown, whatever the address says; the first tab shown is drawn instead (hubTabToShow).
export const HUB_TABS=['results','sales','collection','quotes','targets'] as const;
export type HubTab=typeof HUB_TABS[number];
export const isHubTab=(value:unknown):value is HubTab=>typeof value==='string'&&(HUB_TABS as readonly string[]).includes(value);
/** «إخفاء تبويبات صفحة المستهدفات لكل حساب» (the owner, 2026-11-16, item 6 of the GSCO list; GSCO 2.13.58 performance.results,
 *  performance.collection, performance.quotations, performance.targets): the tabs the administrator may hide per member in «الصلاحيات».
 *  Stored among the member's hidden screens (crm_member_permissions.hidden) as 'targets.<tab>', which no screen is called, so a release
 *  before this one ignores them and shows every tab. «رفع المبيعات» has no switch of its own: it follows «استعراض» of «المبيعات», as in GSCO. */
export const HIDEABLE_HUB_TABS=['results','collection','quotes','targets'] as const;
export type HideableHubTab=typeof HIDEABLE_HUB_TABS[number];
export type HubTabKey=`targets.${HideableHubTab}`;
export const hubTabKey=(tab:HideableHubTab):HubTabKey=>`targets.${tab}`;
export const HUB_TAB_KEYS:readonly HubTabKey[]=HIDEABLE_HUB_TABS.map(hubTabKey);
export const isHubTabKey=(value:unknown):value is HubTabKey=>typeof value==='string'&&(HUB_TAB_KEYS as readonly string[]).includes(value);
/** The tabs' names, for the matrix, a skipped copy and the guide. */
export const HUB_TAB_NAMES:Readonly<Record<HubTab,{ar:string;en:string}>>={results:{ar:'نتائج الأداء',en:'Performance results'},sales:{ar:'رفع المبيعات',en:'Sales upload'},collection:{ar:'التحصيل',en:'Collection'},quotes:{ar:'عروض الأسعار',en:'Quotations'},targets:{ar:'المستهدفات والأوزان',en:'Targets & weights'}};
/** The tabs shown, in the owner's order: a hideable tab unless its key is among the hidden, «رفع المبيعات» while «المبيعات» shows. */
export const shownHubTabs=(hidden:readonly string[],salesShown:boolean):HubTab[]=>HUB_TABS.filter(tab=>tab==='sales'?salesShown:!hidden.includes(hubTabKey(tab)));
/** The tab to draw: the one chosen (the address, the browser's memory, a click) while it is shown, else the first shown. */
export const hubTabToShow=(chosen:HubTab,shown:readonly HubTab[]):HubTab|null=>shown.includes(chosen)?chosen:shown[0]??null;
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
/** A tab drawn in place of one the member does not have: the address names the tab drawn (the browser's memory is left as it is, so the
 *  member's own choice comes back if the administrator shows that tab again). */
export function correctHubTabAddress(tab:HubTab){
 const w=place();let named:string|null=null;
 try{named=new URLSearchParams(w?.location?.search||'').get('tab');}catch{/* no address */}
 if(named!==null&&named!==tab)writeAddress(tab);
}
/** Leaving the page takes the tab out of the address (the browser still remembers it for the next visit). */
export function forgetHubTab(){writeAddress(null);}
