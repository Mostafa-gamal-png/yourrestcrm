'use client';
// What the customer sees from the representative's link (the owner, 2026-11-10: «امكانية ارسال لينك بالpdf طلب القالب للتوقيع عليه»):
// the company's name and logo, «طلب تصنيع قالب» with what the customer signs for (the same fields as the signing summary on the
// representative's device: nothing internal), the request's PDFs and images to open (through the link only), then the signer's name, the
// pad (the app's own), the consent «قرأت الطلب والملفات وموافق عليها» and «توقيع». Since the owner's «يوقع داخل pdf» (2026-11-10, second
// release of the day) the files are the page itself: the quotation's and PO's, then the design's, page after page (MoldDocumentViewer),
// and the signature is a box after their last page holding what is signed for, the name, the pad, the consent and «توقيع». The block stamped in the PDFs is composed here, its
// moment the server's clock (the page's own now). Once signed: «تم التوقيع، شكرًا» and the signed copies to download. A link that does
// not work is one neutral sentence. Arabic first, with English through the app's own language switch (phone first, 360 px).
// Since 2026-11-11 («ملف واحد موقّع») the files are ONE document, its last page the signature page (the summary, the documents and their
// pages, the files named only, the consent sentence, the name and the pad in its box, the moment); the consent box and «توقيع» sit under
// it. Signing sends the signature page as a PNG with the documents it lists, and the thank-you page offers the one signed file.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CheckCircle2,Download,Eraser,FileText,Loader2,PenLine,RotateCcw,TriangleAlert} from 'lucide-react';
import {MOLD_SIGN_PAGE_TEXT,docCategory} from '@/lib/mold-signed-document';
import {MOLD_VIEWER_TEXT} from '@/lib/mold-document-view';
import {useLanguage} from '@/lib/i18n';
import {MOLD_CORES,MOLD_HALF_BLOCKS,MOLD_MODELS,MOLD_PAYMENT_TERMS_TITLE,moldNotSignedText,moldPaymentNames,moldPaymentTermsNames} from '@/lib/mold-requests';
import type {MoldViewerFile} from '@/lib/mold-document-view';
import MoldDocumentViewer,{type DocPlan} from './mold-document-viewer';
import {MoldSignaturePage,signaturePagePng} from './mold-signature-page';
import {MOLD_SIGNER_MAX,MOLD_SIGNER_MIN,moldSignatureDrawn,moldSigner} from '@/portable/mold-rules.mjs';
import type {SignLinkDone,SignLinkPage} from '@/lib/mold-sign-server';
import {noteServerTime,serverNow,signatureBlockPng,signatureBox,signaturePng,type SignatureStrokes} from './mold-signature';
import BidiText from './bidi-text';
import './mold-requests.css';
import './mold-sign-page.css';

type Say=(ar:string,en:string)=>string;
const stamp=(iso:string)=>new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'});
/** The server's words, in English when the page is (the few the link can answer with). */
const english:Record<string,string>={
 'هذا الرابط لم يعد صالحًا. اطلب من المندوب رابطًا جديدًا.':'This link is not working. Ask the representative for a new link.',
 'عُدِّل الطلب؛ افتح الرابط مرة أخرى.':'The request has changed; open the link again.',
 'محاولات كثيرة؛ انتظر دقيقة ثم أعد المحاولة.':'Too many attempts; wait a minute and try again.',
 'يجب أن تقرّ بأنك قرأت الطلب والملفات قبل التوقيع.':'Please confirm you have read the request and its files before signing.',
 'بيانات التوقيع غير صحيحة؛ افتح الرابط مرة أخرى.':'The signature could not be read; open the link again.',
 'وقت التوقيع غير صحيح؛ افتح الرابط مرة أخرى ووقّع.':'The signing time is off; open the link again and sign.',
 'صورة التوقيع غير صالحة؛ امسح التوقيع ووقّع من جديد':'The signature image is not valid; clear it and sign again',
 'اكتب اسم الموقّع عن العميل (من 2 إلى 80 حرفًا)':'Type the name of the person signing (2 to 80 characters)',
 'الطلب غير جاهز للتوقيع الآن؛ تواصل مع المندوب.':'The request is not ready to be signed now; contact the representative.',
 'التوقيع غير متاح الآن؛ أعد المحاولة بعد قليل.':'Signing is not available right now; try again shortly.',
};

function Gone({say}:{say:Say}){
 return <section className="sign-card sign-gone" role="alert"><TriangleAlert size={22} aria-hidden="true"/><p>{say('هذا الرابط لم يعد صالحًا. اطلب من المندوب رابطًا جديدًا.','This link is not working. Ask the representative for a new link.')}</p></section>;
}

export default function MoldSignPage({token,page}:{token:string;page:SignLinkPage|null}){
 const {language,setLanguage}=useLanguage(),en=language==='en',say:Say=(ar,english)=>en?english:ar,tr=(message:string)=>en?english[message]||message:message;
 const [signer,setSigner]=useState(''),[strokes,setStrokes]=useState<SignatureStrokes>([]),[width,setWidth]=useState(0),[consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[state,setState]=useState<'open'|'changed'|'gone'>('open'),[done,setDone]=useState<SignLinkDone|null>(null);
 const [plan,setPlan]=useState<DocPlan|null>(null);
 // One identifier per signing (a retry after an answer that never came resends the very same body under it).
 const attempt=useRef<{body:string;id:string}|null>(null);
 // The request's files as the page shows them (2026-11-10): the PDFs and pictures through the link, the others by name.
 const documents=useMemo<MoldViewerFile[]>(()=>page?[...page.files.map(file=>({key:file.id,name:file.name,category:file.category,kind:file.kind,href:file.href,link:file.href})),
  ...(page.others||[]).map((file,index)=>({key:'other:'+index,name:file.name,category:file.category,kind:'other' as const}))]:[],[page]);
 useEffect(()=>{if(page)noteServerTime(page.now);},[page]);
 useEffect(()=>{document.title=en?'Sign the mold request | Yourrest Industries':'توقيع طلب تصنيع قالب | يورست للصناعات';},[en]);
 const head=<header className="sign-head">
  {/* eslint-disable-next-line @next/next/no-img-element -- the company's static logo, as on the sign-in page */}
  <img src="/yourrest-logo.png" alt={say('يورست للصناعات','Yourrest Industries')}/><button type="button" className="btn subtle small" onClick={()=>setLanguage(en?'ar':'en')} lang={en?'ar':'en'}>{en?'العربية':'English'}</button></header>;
 if(!page||state==='gone')return <main className="sign-page" dir={en?'ltr':'rtl'}>{head}<Gone say={say}/></main>;
 const s=page.summary,choose=(names:Record<string,string>,value:string)=>say(names[value]||value,value);
 // As text (2026-11-11): the signature page prints it as the page shows it.
 const facts:[string,string][]=[[say('العميل','Customer'),s.customerName],...(s.erpCode?[[say('كود العميل','Customer code'),s.erpCode] as [string,string]]:[]),
  [say('عنوان التسليم','Delivery address'),s.address||'—'],[say('الوصف','Description'),s.description],[say('الكمية','Quantity'),String(s.quantity??'—')],
  [say('العلب','Core'),choose(MOLD_CORES,s.core)],[say('الرجاجات','Vibrators'),String(s.vibrators??'—')],[say('الموديل','Model'),choose(MOLD_MODELS,s.model)],[say('بلوكة النص','Half block'),choose(MOLD_HALF_BLOCKS,s.halfBlock)],
  [say('عرض القالب (مم)','Mold width (mm)'),String(s.moldWidth??'—')],[say('مقاس الجلب','Gelba size'),String(s.gelbaSize??'—')],
  ...(s.payment?[[say('الدفع','Payment'),say(...moldPaymentNames[s.payment])] as [string,string]]:[]),
  // How a deferred payment is paid (2026-11-10): the customer signs the terms too.
  ...(s.paymentTerms?[[say(...MOLD_PAYMENT_TERMS_TITLE),say(...moldPaymentTermsNames[s.paymentTerms])] as [string,string]]:[]),
  ...(s.quoteNo?[[say('رقم عرض السعر','Quotation no.'),s.quoteNo] as [string,string]]:[]),...(s.poNo?[[say('رقم الـ PO','PO no.'),s.poNo] as [string,string]]:[])];
 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();
  if(busy)return;
  const name=moldSigner(signer),length=name===undefined?0:[...name].length,next:Record<string,string>={};
  if(name===undefined||length<MOLD_SIGNER_MIN||length>MOLD_SIGNER_MAX)next.signer=say('اكتب اسم الموقّع عن العميل (من 2 إلى 80 حرفًا)','Type the name of the person signing (2 to 80 characters)');
  if(!plan?.ready)return;
  const box=signatureBox(strokes,width),drawn=moldSignatureDrawn(box),png=drawn?signaturePng(strokes,width):null;
  if(!png)next.signature=say('التوقيع فارغ أو صغير جدًا؛ وقّع بإصبعك أو بالقلم','The signature is empty or too small; sign with a finger or a stylus');
  if(!consent)next.consent=say('يجب أن تقرّ بأنك قرأت الطلب والملفات قبل التوقيع.','Please confirm you have read the request and its files before signing.');
  setFields(next);setError('');
  if(Object.keys(next).length||!png||name===undefined)return;
  const at=serverNow(),block=signatureBlockPng(strokes,width,name,at),pagePng=block?signaturePagePng({plan,summary:facts,signer:name,strokes,width,at,say,rtl:!en}):null;
  if(!block||!pagePng){setFields({signature:say('تعذّر تجهيز التوقيع؛ امسح التوقيع ووقّع من جديد.','The signature could not be prepared; clear it and sign again.')});return;}
  // The signature page and the documents it lists (2026-11-11): the CRM makes one signed file of them.
  const body=JSON.stringify({token,key:page.key,signer:name,png,block,blockAt:at.toISOString(),consent:true,document:{page:pagePng,parts:plan.parts,category:docCategory(plan.parts,plan.left)}});
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
   setError(typeof reply.error==='string'?reply.error:say('تعذّر التوقيع؛ أعد المحاولة.','The signature could not be saved; try again.'));
  }catch{setError(say('تعذّر الاتصال؛ تأكد من الإنترنت وأعد المحاولة.','Could not connect; check the internet and try again.'));}
  finally{setBusy(false);}
 };
 if(done)return <main className="sign-page" dir={en?'ltr':'rtl'}>{head}
  <section className="sign-card sign-done" role="status"><CheckCircle2 size={28} aria-hidden="true"/><h1>{say('تم التوقيع، شكرًا','Signed, thank you')}</h1>
   <p>{say('وقّع: ','Signed by: ')}<b><bdi>{done.signer}</bdi></b> · <bdi dir="ltr">{stamp(done.signedAt)}</bdi></p>
   {!!done.copies.length&&<><h2>{done.copies.length===1?say('الملف الموقّع','The signed file'):say('النسخ الموقّعة','Signed copies')}</h2><ul className="sign-files">{done.copies.map(file=><li key={file.id}><FileText size={18} aria-hidden="true"/><bdi dir={en?'ltr':'rtl'}><BidiText segments={[{text:file.name}]} rtl={!en}/></bdi>
    <a className="btn small subtle" href={file.href+'?download=1'} download={file.name}><Download size={15} aria-hidden="true"/>{say('تنزيل','Download')}</a></li>)}</ul></>}
   {done.skipped.map((item,index)=><p key={index} className="sign-note"><TriangleAlert size={14} aria-hidden="true"/>{moldNotSignedText(item.name,item.reason,say)}</p>)}
  </section></main>;
 return <main className="sign-page" dir={en?'ltr':'rtl'}>{head}
  <section className="sign-card sign-intro">
   <h1>{say(...MOLD_VIEWER_TEXT.title)} — <bdi dir="auto">{s.customerName}</bdi></h1>
   <p className="sign-lead">{say('راجع المستند صفحة بصفحة: عرض السعر أو الـ PO، ثم التصميم. في الصفحة الأخيرة اكتب اسمك ووقّع داخل الخانة.','Review the document page by page: the quotation or PO, then the design. On the last page, type your name and sign inside the box.')}</p>
   {state==='changed'&&<div className="sign-changed" role="alert"><TriangleAlert size={16} aria-hidden="true"/><span>{tr(error||'عُدِّل الطلب؛ افتح الرابط مرة أخرى.')}</span><button type="button" className="btn small subtle" onClick={()=>window.location.reload()}><RotateCcw size={15} aria-hidden="true"/>{say('افتح الرابط مرة أخرى','Open the link again')}</button></div>}
  </section>
  {/* The documents as one document (2026-11-11), its last page the signature page; the consent and «توقيع» under it. */}
  <form className="sign-documents sign-form" onSubmit={event=>void submit(event)} noValidate>
   <MoldDocumentViewer files={documents} say={say} credentials="omit" onPlan={setPlan} signaturePage={current=><MoldSignaturePage plan={current} summary={facts} say={say} busy={busy||state!=='open'} strokes={strokes} onWidth={setWidth}
    onStrokes={next=>{setStrokes(next);setFields(previous=>({...previous,signature:''}));}} signerError={fields.signer?tr(fields.signer):''} padError={fields.signature?tr(fields.signature):''}
    name={<label className="mold-field">{say(...MOLD_SIGN_PAGE_TEXT.signer)}<input name="signer" dir="auto" autoComplete="name" maxLength={MOLD_SIGNER_MAX+20} value={signer} disabled={busy||state!=='open'} onChange={event=>{setSigner(event.target.value);setFields(previous=>({...previous,signer:''}));}}/></label>}
    clear={<button type="button" className="btn small subtle" disabled={busy||!strokes.length} onClick={()=>setStrokes([])}><Eraser size={15} aria-hidden="true"/>{say('مسح','Clear')}</button>}/>}/>
   {state==='open'&&<div className="sign-card sign-under">
    {!plan?.ready&&<p className="sign-note" role="status"><Loader2 className="spin" size={14} aria-hidden="true"/>{say(...MOLD_SIGN_PAGE_TEXT.preparing)}</p>}
    <label className="sign-consent" aria-invalid={!!fields.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={event=>{setConsent(event.target.checked);setFields(previous=>({...previous,consent:''}));}}/>{say('قرأت الطلب والملفات وموافق عليها','I have read the request and its files and agree to them')}</label>
    {fields.consent&&<small className="field-error">{tr(fields.consent)}</small>}
    {error&&<p className="form-error" role="alert">{tr(error)}</p>}
    <button type="submit" className="btn primary sign-submit" disabled={busy||!plan?.ready}>{busy?<Loader2 className="spin" size={16}/>:<PenLine size={16}/>}{say('توقيع','Sign')}</button>
    <p className="sign-note">{say('الرابط صالح حتى ','The link is valid until ')}<bdi dir="ltr">{stamp(page.expiresAt)}</bdi></p>
   </div>}
  </form>
 </main>;
}
