'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {useLanguage} from '@/lib/i18n';
import {SubmitError,submitJson} from '@/lib/client-submit';
import {normalizeMapSearch} from '@/lib/customer-map-search';
import './customer-identities.css';

type CustomerIdentity={id:string;name:string;internalCode:string;erpCode:string;region:string;version:number};
type ERPIdentity={codeKey:string;sourceCodes:string[];customerIds:string[];mappedCustomerId:string|null;mappingVersion:number;status:'unique'|'ambiguous'|'unmatched'|'mapped'};
type IdentitySnapshot={revision:number;customers:CustomerIdentity[];identities:ERPIdentity[]};
type MappingRequest={codeKey:string;customerId:string;version:number;revision:number;customerVersion:number;requestId:string};
type Props={onClose:()=>void;onSaved:()=>Promise<unknown>|void};

/** Administrative reconciliation keeps ERP identities separate from internal CRM codes. */
export default function CustomerIdentities({onClose,onSaved}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const [snapshot,setSnapshot]=useState<IdentitySnapshot|null>(null);
 const [query,setQuery]=useState(''),[onlyReview,setOnlyReview]=useState(true);
 const [activeKey,setActiveKey]=useState(''),[customerId,setCustomerId]=useState(''),[customerQuery,setCustomerQuery]=useState('');
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [conflict,setConflict]=useState(false),[uncertain,setUncertain]=useState(false),[denied,setDenied]=useState(false);
 const pending=useRef<MappingRequest|null>(null),busy=useRef(false),loadGeneration=useRef(0),mounted=useRef(true);
 const getSnapshot=useCallback(async()=>{
  const generation=++loadGeneration.current;
  setLoading(true);setError('');
  try{
   const result=await submitJson<IdentitySnapshot>('/api/customer-identities',{cache:'no-store'},{language});
   if(!mounted.current||generation!==loadGeneration.current)return;
   setSnapshot(result);setConflict(false);setDenied(false);setCustomerId('');setCustomerQuery('');pending.current=null;
  }catch(error){
   if(!mounted.current||generation!==loadGeneration.current)return;
   setError(error instanceof Error?error.message:say('تعذر تحميل الربط.','Could not load customer links.'));
   if(error instanceof SubmitError&&[401,403].includes(error.status)){setDenied(true);setSnapshot(null);}
  }finally{if(mounted.current&&generation===loadGeneration.current)setLoading(false);}
 },[language]);
 useEffect(()=>{mounted.current=true;void getSnapshot();return()=>{mounted.current=false;loadGeneration.current++;};},[]);
 const byId=useMemo(()=>new Map(snapshot?.customers.map(customer=>[customer.id,customer])||[]),[snapshot]);
 const identities=useMemo(()=>{
  const terms=normalizeMapSearch(query).split(' ').filter(Boolean);
  return (snapshot?.identities||[]).filter(identity=>(!onlyReview||identity.status==='ambiguous'||identity.status==='unmatched')&&terms.every(term=>normalizeMapSearch([identity.codeKey,...identity.sourceCodes,...identity.customerIds.flatMap(id=>{const customer=byId.get(id);return customer?[customer.name,customer.internalCode,customer.erpCode,customer.region]:[];})].join(' ')).includes(term)));
 },[snapshot,query,onlyReview,byId]);
 const active=snapshot?.identities.find(identity=>identity.codeKey===activeKey);
 const candidates=(active?.customerIds||[]).map(id=>byId.get(id)).filter((customer):customer is CustomerIdentity=>!!customer);
 const candidateTerms=normalizeMapSearch(customerQuery).split(' ').filter(Boolean);
 const shownCandidates=candidates.filter(customer=>candidateTerms.every(term=>normalizeMapSearch([customer.name,customer.internalCode,customer.erpCode,customer.region].join(' ')).includes(term))).slice(0,40);
 const selected=byId.get(customerId),mapped=active?.mappedCustomerId?byId.get(active.mappedCustomerId):undefined;
 const locked=loading||saving||uncertain||denied;
 const status=(identity:ERPIdentity)=>({unique:say('مطابق تلقائيًا','Automatic match'),ambiguous:say('يحتاج اختيار العميل','Choose a customer'),unmatched:say('لا يوجد عميل مطابق','No matching customer'),mapped:say('تم الربط يدويًا','Manually linked')})[identity.status];
 function selectIdentity(codeKey:string){if(locked)return;setActiveKey(codeKey);setCustomerId('');setCustomerQuery('');setConflict(false);setError('');setNotice('');pending.current=null;}
 async function save(clear=false){
  if(busy.current||loading||conflict||denied||!snapshot||!active)return;
  if(!uncertain&&(!clear&&!selected||clear&&!active.mappedCustomerId))return;
  const request=pending.current||{codeKey:active.codeKey,customerId:clear?'':customerId,version:active.mappingVersion,revision:snapshot.revision,customerVersion:clear?0:selected!.version,requestId:crypto.randomUUID()};
  pending.current=request;busy.current=true;setSaving(true);setError('');setNotice('');
  try{
   await submitJson<{ok:true;alreadySaved?:boolean}>('/api/customer-identities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)},{language});
   if(!mounted.current)return;
   pending.current=null;setUncertain(false);setNotice(request.customerId?say('تم حفظ ربط العميل.','Customer link saved.'):say('تم إلغاء الربط اليدوي.','Manual link cleared.'));
   await getSnapshot();
   try{await onSaved();}catch{if(mounted.current)setNotice(say('تم حفظ الربط. حدّث صفحة العملاء لتحميل بياناتها.','Link saved. Refresh the customer page to load its data.'));}
  }catch(error){
   if(!mounted.current)return;
   setError(error instanceof Error?error.message:say('تعذر حفظ الربط.','Could not save the link.'));
   if(error instanceof SubmitError&&error.status===409){setConflict(true);setUncertain(false);pending.current=null;}
   else if(error instanceof SubmitError&&error.status>=400&&error.status<500){setUncertain(false);pending.current=null;if([401,403].includes(error.status)){setDenied(true);setSnapshot(null);}}
   else setUncertain(true);
  }finally{busy.current=false;if(mounted.current)setSaving(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!saving&&!uncertain)onClose();}}>
  <DialogContent className="crm-dialog customer-identities-dialog" dir={language==='ar'?'rtl':'ltr'}>
   <DialogTitle>{say('ربط عملاء ERP','Link ERP customers')}</DialogTitle>
   <DialogDescription>{say('كود يورست ثابت لكل مصنع. اختر المصنع الصحيح للأكواد المشتركة حتى تُحتسب مبيعاته بدقة.','Each factory has a permanent Yourrest code. Select the correct factory for shared ERP codes so its sales are attributed accurately.')}</DialogDescription>
   <div className="identity-tools">
    <label className="field"><span>{say('بحث بالكود أو اسم العميل','Search code or customer name')}</span><input type="search" value={query} disabled={locked} onChange={event=>setQuery(event.target.value)}/></label>
    <label className="identity-review-filter"><input type="checkbox" checked={onlyReview} disabled={locked} onChange={event=>setOnlyReview(event.target.checked)}/>{say('يحتاج مراجعة فقط','Needs review only')}</label>
    <button type="button" className="btn subtle small" disabled={locked||conflict} onClick={()=>void getSnapshot()}>{say('تحديث','Refresh')}</button>
   </div>
   {loading&&<p role="status">{say('جارٍ تحميل الأكواد…','Loading codes…')}</p>}
   {error&&<p className="form-error" role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   {conflict&&<div className="identity-conflict" role="status"><p>{say('تغيّرت بيانات الربط أو العميل. اختيارك ظاهر ولم يُحفظ. حمّل أحدث البيانات ثم راجعها واختر العميل من جديد.','The customer or link changed. Your choice is still shown and was not saved. Load the latest data, review it and choose the customer again.')}</p><button type="button" className="btn subtle" disabled={loading||saving} onClick={()=>void getSnapshot()}>{say('تحميل أحدث البيانات ومراجعتها','Load latest data for review')}</button></div>}
   {uncertain&&<div className="identity-conflict" role="status"><p>{say('تعذر تأكيد الحفظ. أعد المحاولة بنفس الربط للتأكد من النتيجة قبل تغيير الاختيار أو إغلاق النافذة.','The save could not be confirmed. Retry the same link to confirm the result before changing the selection or closing.')}</p><button type="button" className="btn primary" disabled={saving} onClick={()=>void save()}>{say('التأكد من الحفظ','Confirm save result')}</button></div>}
   {!denied&&snapshot&&<div className="identity-workspace">
    <section className="identity-list" aria-label={say('أكواد ERP','ERP codes')}>
     {!identities.length&&<p>{say('لا توجد أكواد مطابقة لهذا الفلتر.','No codes match this filter.')}</p>}
     {identities.slice(0,100).map(identity=><button type="button" className={'identity-list-item'+(activeKey===identity.codeKey?' is-selected':'')} aria-pressed={activeKey===identity.codeKey} disabled={locked} key={identity.codeKey} onClick={()=>selectIdentity(identity.codeKey)}><bdi>{identity.sourceCodes.join(' / ')||identity.codeKey}</bdi><small>{status(identity)}</small></button>)}
     {identities.length>100&&<p>{say('اكتب جزءًا من الكود أو الاسم لتقليل النتائج.','Enter part of a code or name to narrow the results.')}</p>}
    </section>
    <section className="identity-editor" aria-label={say('اختيار المصنع','Choose factory')}>
     {!active?<p>{say('اختر كود ERP لعرض المصانع المرتبطة به.','Select an ERP code to view its factories.')}</p>:<>
      <h3><bdi>{active.sourceCodes.join(' / ')||active.codeKey}</bdi></h3>
      <p>{status(active)}</p>
      {mapped&&<p>{say('الربط الحالي: ','Current link: ')}<strong>{mapped.name}</strong> <bdi>{mapped.internalCode}</bdi></p>}
      {!candidates.length?<p>{say('لا يوجد عميل يحمل هذا الكود. صحّح كود ERP في بطاقة العميل ثم حدّث هذه القائمة.','No customer has this code. Correct the ERP code in the customer card, then refresh this list.')}</p>:<>
       <label className="field"><span>{say('بحث بين المصانع المطابقة','Search matching factories')}</span><input type="search" value={customerQuery} disabled={locked||conflict} onChange={event=>setCustomerQuery(event.target.value)}/></label>
       <div className="identity-candidates">{shownCandidates.map(customer=><label className="identity-candidate" key={customer.id}><input type="radio" name="erp-identity-customer" value={customer.id} checked={customer.id===customerId} disabled={locked||conflict} onChange={()=>{setCustomerId(customer.id);pending.current=null;setError('');setNotice('');}}/><span><strong>{customer.name}</strong><small>{say('كود يورست: ','Yourrest code: ')}<bdi>{customer.internalCode}</bdi></small><small>{say('كود ERP: ','ERP code: ')}<bdi>{customer.erpCode||'—'}</bdi>{customer.region&&' · '+customer.region}</small></span></label>)}</div>
       {!shownCandidates.length&&<p>{say('لا يوجد مصنع مطابق للبحث.','No factory matches your search.')}</p>}
       {candidates.length>40&&<p>{say('استخدم البحث للوصول للمصنع المطلوب.','Use search to find the required factory.')}</p>}
       {selected&&<p className="identity-confirm-choice">{say('سيُربط هذا الكود بـ: ','This code will link to: ')}<strong>{selected.name}</strong> <bdi>{selected.internalCode}</bdi></p>}
       <button type="button" className="btn primary" disabled={locked||conflict||!selected||selected.id===active.mappedCustomerId} onClick={()=>void save()}>{say('حفظ ربط العميل','Save customer link')}</button>
      </>}
      {active.mappedCustomerId&&<button type="button" className="btn subtle identity-clear" disabled={locked||conflict} onClick={()=>void save(true)}>{say('إلغاء الربط اليدوي لهذا الكود','Clear this code’s manual link')}</button>}
     </>}
    </section>
   </div>}
   <div className="form-footer"><button type="button" className="btn subtle" disabled={saving||uncertain} onClick={onClose}>{say('إغلاق','Close')}</button></div>
  </DialogContent>
 </Dialog>;
}
