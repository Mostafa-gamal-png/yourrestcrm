'use client';
// What the customer sees from the representative's link (the owner, 2026-11-10: «امكانية ارسال لينك بالpdf طلب القالب للتوقيع عليه»):
// the company's name and logo, «طلب تصنيع قالب» with what the customer signs for (the same fields as the signing summary on the
// representative's device: nothing internal), the request's PDFs and images to open (through the link only), then the signer's name, the
// pad (the app's own), the consent «قرأت الطلب والملفات وموافق عليها» and «توقيع». The block stamped in the PDFs is composed here, its
// moment the server's clock (the page's own now). Once signed: «تم التوقيع، شكرًا» and the signed copies to download. A link that does
// not work is one neutral sentence. Arabic first, with English through the app's own language switch (phone first, 360 px).
import React,{useEffect,useRef,useState} from 'react';
import {CheckCircle2,Download,Eraser,Eye,FileText,ImageIcon,Loader2,PenLine,RotateCcw,TriangleAlert} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import {MOLD_CORES,MOLD_HALF_BLOCKS,MOLD_MODELS,MOLD_PAYMENT_TERMS_TITLE,moldFileCategoryNames,moldNotSignedText,moldPaymentNames,moldPaymentTermsNames} from '@/lib/mold-requests';
import {MOLD_SIGNER_MAX,MOLD_SIGNER_MIN,moldSignatureDrawn,moldSigner} from '@/portable/mold-rules.mjs';
import type {SignLinkDone,SignLinkPage} from '@/lib/mold-sign-server';
import {SignaturePad,noteServerTime,serverNow,signatureBlockPng,signatureBox,signaturePng,type SignatureStrokes} from './mold-signature';
import './mold-requests.css';
import './mold-sign-page.css';

type Say=(ar:string,en:string)=>string;
const size=(bytes:number)=>bytes<1024*1024?Math.max(1,Math.round(bytes/1024))+' KB':(bytes/1024/1024).toFixed(1)+' MB';
const stamp=(iso:string)=>new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'});
/** The server's words, in English when the page is (the few the link can answer with). */
const english:Record<string,string>={
 'اللينك ده مش شغال. اطلب من المندوب لينك جديد.':'This link is not working. Ask the representative for a new link.',
 'الطلب اتعدّل، افتح اللينك تاني.':'The request has changed; open the link again.',
 'محاولات كتير؛ استنى دقيقة وحاول تاني.':'Too many attempts; wait a minute and try again.',
 'لازم توافق إنك قريت الطلب والملفات قبل التوقيع.':'Please confirm you have read the request and its files before signing.',
 'بيانات التوقيع غير صحيحة؛ افتح اللينك تاني.':'The signature could not be read; open the link again.',
 'وقت التوقيع مش مظبوط؛ افتح اللينك تاني ووقّع.':'The signing time is off; open the link again and sign.',
 'صورة التوقيع غير صالحة؛ امسح ووقّع من جديد':'The signature image is not valid; clear it and sign again',
 'اكتب اسم اللي بيوقّع عن العميل (من 2 إلى 80 حرف)':'Type the name of the person signing (2 to 80 characters)',
 'الطلب مش جاهز للتوقيع دلوقتي؛ كلّم المندوب.':'The request is not ready to be signed now; contact the representative.',
 'التوقيع مش متاح دلوقتي؛ حاول بعد شوية.':'Signing is not available right now; try again shortly.',
};

function Gone({say}:{say:Say}){
 return <section className="sign-card sign-gone" role="alert"><TriangleAlert size={22} aria-hidden="true"/><p>{say('اللينك ده مش شغال. اطلب من المندوب لينك جديد.','This link is not working. Ask the representative for a new link.')}</p></section>;
}

export default function MoldSignPage({token,page}:{token:string;page:SignLinkPage|null}){
 const {language,setLanguage}=useLanguage(),en=language==='en',say:Say=(ar,english)=>en?english:ar,tr=(message:string)=>en?english[message]||message:message;
 const [signer,setSigner]=useState(''),[strokes,setStrokes]=useState<SignatureStrokes>([]),[width,setWidth]=useState(0),[consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[state,setState]=useState<'open'|'changed'|'gone'>('open'),[done,setDone]=useState<SignLinkDone|null>(null);
 // One identifier per signing (a retry after an answer that never came resends the very same body under it).
 const attempt=useRef<{body:string;id:string}|null>(null);
 useEffect(()=>{if(page)noteServerTime(page.now);},[page]);
 useEffect(()=>{document.title=en?'Sign the mold request | Yourrest Industries':'توقيع طلب تصنيع قالب | يورست للصناعات';},[en]);
 const head=<header className="sign-head">
  {/* eslint-disable-next-line @next/next/no-img-element -- the company's static logo, as on the sign-in page */}
  <img src="/yourrest-logo.png" alt={say('يورست للصناعات','Yourrest Industries')}/><button type="button" className="btn subtle small" onClick={()=>setLanguage(en?'ar':'en')} lang={en?'ar':'en'}>{en?'العربية':'English'}</button></header>;
 if(!page||state==='gone')return <main className="sign-page" dir={en?'ltr':'rtl'}>{head}<Gone say={say}/></main>;
 const s=page.summary,choose=(names:Record<string,string>,value:string)=>say(names[value]||value,value);
 const facts:[string,React.ReactNode][]=[[say('العميل','Customer'),<span dir="auto" key="c">{s.customerName}</span>],...(s.erpCode?[[say('كود العميل','Customer code'),<bdi dir="ltr" key="e">{s.erpCode}</bdi>] as [string,React.ReactNode]]:[]),
  [say('عنوان التسليم','Delivery address'),<span dir="auto" key="a">{s.address||'—'}</span>],[say('الوصف','Description'),<span dir="auto" key="d">{s.description}</span>],[say('الكمية','Quantity'),String(s.quantity??'—')],
  [say('العلب','Core'),choose(MOLD_CORES,s.core)],[say('الرجاجات','Vibrators'),String(s.vibrators??'—')],[say('الموديل','Model'),choose(MOLD_MODELS,s.model)],[say('بلوكة النص','Half block'),choose(MOLD_HALF_BLOCKS,s.halfBlock)],
  [say('عرض القالب (مم)','Mold width (mm)'),String(s.moldWidth??'—')],[say('مقاس الجلب','Gelba size'),String(s.gelbaSize??'—')],
  ...(s.payment?[[say('الدفع','Payment'),say(...moldPaymentNames[s.payment])] as [string,React.ReactNode]]:[]),
  // How a deferred payment is paid (2026-11-10): the customer signs the terms too.
  ...(s.paymentTerms?[[say(...MOLD_PAYMENT_TERMS_TITLE),say(...moldPaymentTermsNames[s.paymentTerms])] as [string,React.ReactNode]]:[]),
  ...(s.quoteNo?[[say('رقم عرض السعر','Quotation no.'),<bdi dir="ltr" key="q">{s.quoteNo}</bdi>] as [string,React.ReactNode]]:[]),...(s.poNo?[[say('رقم الـ PO','PO no.'),<bdi dir="ltr" key="p">{s.poNo}</bdi>] as [string,React.ReactNode]]:[])];
 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();
  if(busy)return;
  const name=moldSigner(signer),length=name===undefined?0:[...name].length,next:Record<string,string>={};
  if(name===undefined||length<MOLD_SIGNER_MIN||length>MOLD_SIGNER_MAX)next.signer=say('اكتب اسم اللي بيوقّع عن العميل (من 2 إلى 80 حرف)','Type the name of the person signing (2 to 80 characters)');
  const box=signatureBox(strokes,width),drawn=moldSignatureDrawn(box),png=drawn?signaturePng(strokes,width):null;
  if(!png)next.signature=say('التوقيع فاضي أو صغير قوي؛ وقّع بصباعك أو بالقلم','The signature is empty or too small; sign with a finger or a stylus');
  if(!consent)next.consent=say('لازم توافق إنك قريت الطلب والملفات قبل التوقيع.','Please confirm you have read the request and its files before signing.');
  setFields(next);setError('');
  if(Object.keys(next).length||!png||name===undefined)return;
  const at=serverNow(),block=signatureBlockPng(strokes,width,name,at);
  if(!block){setFields({signature:say('تعذّر تجهيز التوقيع؛ امسح ووقّع تاني.','The signature could not be prepared; clear it and sign again.')});return;}
  const body=JSON.stringify({token,key:page.key,signer:name,png,block,blockAt:at.toISOString(),consent:true});
  if(attempt.current?.body!==body)attempt.current={body,id:crypto.randomUUID()};
  setBusy(true);
  try{
   const response=await fetch('/api/mold-sign',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({...JSON.parse(body),requestId:attempt.current.id})});
   let reply:Record<string,unknown>={};try{reply=await response.json();}catch{reply={};}
   if(response.ok&&reply.ok===true){attempt.current=null;setDone(reply as unknown as SignLinkDone);return;}
   if(response.status===404||reply.gone){setState('gone');return;}
   if(response.status===409){setState('changed');setError(typeof reply.error==='string'?reply.error:'');attempt.current=null;return;}
   if(response.status===400)attempt.current=null;
   if(reply.fields&&typeof reply.fields==='object')setFields(Object.fromEntries(Object.entries(reply.fields as Record<string,string>).map(([key,value])=>[key,tr(value)])));
   setError(typeof reply.error==='string'?reply.error:say('تعذّر التوقيع؛ حاول تاني.','The signature could not be saved; try again.'));
  }catch{setError(say('تعذّر الاتصال؛ تأكد من الإنترنت وحاول تاني.','Could not connect; check the internet and try again.'));}
  finally{setBusy(false);}
 };
 if(done)return <main className="sign-page" dir={en?'ltr':'rtl'}>{head}
  <section className="sign-card sign-done" role="status"><CheckCircle2 size={28} aria-hidden="true"/><h1>{say('تم التوقيع، شكرًا','Signed, thank you')}</h1>
   <p>{say('وقّع: ','Signed by: ')}<b><bdi>{done.signer}</bdi></b> · <bdi dir="ltr">{stamp(done.signedAt)}</bdi></p>
   {!!done.copies.length&&<><h2>{say('النسخ الموقّعة','Signed copies')}</h2><ul className="sign-files">{done.copies.map(file=><li key={file.id}><FileText size={18} aria-hidden="true"/><bdi>{file.name}</bdi>
    <a className="btn small subtle" href={file.href+'?download=1'} download={file.name}><Download size={15} aria-hidden="true"/>{say('تنزيل','Download')}</a></li>)}</ul></>}
   {done.skipped.map((item,index)=><p key={index} className="sign-note"><TriangleAlert size={14} aria-hidden="true"/>{moldNotSignedText(item.name,item.reason,say)}</p>)}
  </section></main>;
 return <main className="sign-page" dir={en?'ltr':'rtl'}>{head}
  <section className="sign-card">
   <h1>{say('طلب تصنيع قالب','Mold manufacturing request')}</h1>
   <p className="sign-lead">{say('راجع الطلب والملفات، وبعدين اكتب اسمك ووقّع.','Review the request and its files, then type your name and sign.')}</p>
   {state==='changed'&&<div className="sign-changed" role="alert"><TriangleAlert size={16} aria-hidden="true"/><span>{tr(error||'الطلب اتعدّل، افتح اللينك تاني.')}</span><button type="button" className="btn small subtle" onClick={()=>window.location.reload()}><RotateCcw size={15} aria-hidden="true"/>{say('افتح اللينك تاني','Open the link again')}</button></div>}
   <dl className="mold-facts sign-facts">{facts.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
   <h2>{say('الملفات','Files')}</h2>
   {!page.files.length?<p className="sign-note">{say('مفيش ملفات في الطلب.','The request has no files.')}</p>
    :<ul className="sign-files">{page.files.map(file=><li key={file.id}>{file.kind==='image'?<ImageIcon size={18} aria-hidden="true"/>:<FileText size={18} aria-hidden="true"/>}<span className="sign-file-name"><bdi>{file.name}</bdi><small>{say(...moldFileCategoryNames[file.category])} · <span dir="ltr">{size(file.size)}</span></small></span>
     <a className="btn small subtle" href={file.href} target="_blank" rel="noopener noreferrer"><Eye size={15} aria-hidden="true"/>{say('فتح','Open')}</a></li>)}</ul>}
   <p className="sign-note">{say('اللينك صالح لحد ','The link is valid until ')}<bdi dir="ltr">{stamp(page.expiresAt)}</bdi></p>
   {state==='open'&&<form className="sign-form" onSubmit={event=>void submit(event)} noValidate>
    <label className="mold-field" aria-invalid={!!fields.signer}>{say('اسم اللي بيوقّع عن العميل','Name of the person signing for the customer')}
     <input name="signer" dir="auto" autoComplete="name" maxLength={MOLD_SIGNER_MAX+20} value={signer} disabled={busy} onChange={event=>{setSigner(event.target.value);setFields(previous=>({...previous,signer:''}));}}/>
     {fields.signer&&<small className="field-error">{tr(fields.signer)}</small>}</label>
    <div className="mold-signature-box" aria-invalid={!!fields.signature}>
     <SignaturePad strokes={strokes} onChange={next=>{setStrokes(next);setFields(previous=>({...previous,signature:''}));}} onWidth={setWidth} disabled={busy} say={say}/>
     <div className="mold-signature-tools"><small><PenLine size={14} aria-hidden="true"/> {say('وقّع هنا بصباعك أو بالقلم','Sign here with a finger or a stylus')}</small>
      <button type="button" className="btn small subtle" disabled={busy||!strokes.length} onClick={()=>setStrokes([])}><Eraser size={15} aria-hidden="true"/>{say('امسح','Clear')}</button></div>
     {fields.signature&&<small className="field-error" role="alert">{tr(fields.signature)}</small>}
    </div>
    <label className="sign-consent" aria-invalid={!!fields.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={event=>{setConsent(event.target.checked);setFields(previous=>({...previous,consent:''}));}}/>{say('قرأت الطلب والملفات وموافق عليها','I have read the request and its files and agree to them')}</label>
    {fields.consent&&<small className="field-error">{tr(fields.consent)}</small>}
    {error&&state==='open'&&<p className="form-error" role="alert">{tr(error)}</p>}
    <button type="submit" className="btn primary sign-submit" disabled={busy}>{busy?<Loader2 className="spin" size={16}/>:<PenLine size={16}/>}{say('توقيع','Sign')}</button>
   </form>}
  </section>
 </main>;
}
