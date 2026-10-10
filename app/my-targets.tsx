'use client';
import {submitJson} from '@/lib/client-submit';
import {useEffect,useState} from 'react';
import {AlertCircle,CalendarDays,Loader2,LockKeyhole,RefreshCw,Target} from 'lucide-react';
import type {Member} from '@/lib/crm';
import type {OwnTargets} from '@/lib/own-targets';
import {t,useLanguage} from '@/lib/i18n';
import {activityFields,quantityNumber,targetProducts} from '@/lib/targets';
import TargetGauge from './target-gauge';
import './my-targets.css';

type Props={me:Member;month:string;onMonthChange:(month:string)=>void};
type LoadState={key:string;phase:'loading'|'ready'|'error';data?:OwnTargets;error?:string};

export function MyTargetDetails({data}:{data:OwnTargets}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const hasQuantities=data.sales.products.some(product=>product.quantity!==null);
 const ongoingSource=(month:string)=>say('ساري من شهر ','Effective from ')+month;
 const activitySource=data.activity.isDefault?say('المستهدفات الافتراضية','Default targets'):data.activity.sourceMonth?ongoingSource(data.activity.sourceMonth):'';
 const labels={target:say('المستهدف المطلوب','Required target'),actual:say('صافي المباع','Net sold'),remaining:say('المتبقي','Remaining'),achievement:say('نسبة التحقيق','Achievement')};
 return <div className="my-targets-details"><section className="panel my-targets-panel" aria-labelledby="my-sales-targets-title"><header><div><h2 id="my-sales-targets-title">{say('مستهدفي وما حققته','My targets and achievement')}</h2></div><span className="my-targets-month" dir="ltr">{data.month}</span></header>
  {data.sales.sourceMonth&&<p className="my-targets-note my-targets-effective-source">{ongoingSource(data.sales.sourceMonth)}</p>}
  {!hasQuantities&&<p className="my-targets-note">{say('لم يُحدد مستهدف كميات الأصناف الساري في الشهر المعروض بعد.','No product quantity targets are effective for the displayed month yet.')}</p>}
  <p className="my-targets-note" id="my-sales-coverage">{data.sales.actualsAvailable?say('صافي المباع بعد المرتجعات. الصفر يعني عدم وجود مبيعات مسجلة للصنف.','Net sold is after returns. Zero means no recorded sales for this product.'):say('الشهر المحدد لم يبدأ بعد؛ يظهر المستهدف فقط.','The selected month has not started; only targets are shown.')}</p>
  <div className="my-targets-products" aria-describedby="my-sales-coverage">{targetProducts.map(product=>{
   const row=data.sales.products.find(item=>item.product===product.id),quantity=row?.quantity??null,actual=row?.actualQuantity??null,remaining=row?.remainingQuantity??null,achievement=row?.achievement??null;
   return <article key={product.id} className="my-target-product"><h3>{t(product.name)}</h3><TargetGauge compact value={achievement} label={labels.achievement+' · '+t(product.name)} emptyLabel={!data.sales.actualsAvailable?say('لم يبدأ الشهر بعد','The month has not started'):quantity===null?say('لم يُحدد مستهدف','No target set'):quantity===0?say('المستهدف صفر','Target is zero'):say('البيانات غير مكتملة','Incomplete data')}/><dl className="my-target-product-values"><div><dt>{labels.actual}</dt><dd>{actual===null?'—':quantityNumber(actual)} <small>{t(product.unit)}</small></dd></div><div><dt>{labels.target}</dt><dd className={quantity===null?'my-targets-unset':undefined}>{quantity===null?t('غير محدد'):quantityNumber(quantity)} <small>{t(product.unit)}</small></dd></div></dl><p className="my-target-product-remaining">{labels.remaining}: <bdi>{remaining===null?'—':quantityNumber(remaining)}</bdi> {t(product.unit)}</p></article>;
  })}</div>
 </section><section className="panel my-targets-panel" aria-labelledby="my-activity-targets-title"><header><div><h2 id="my-activity-targets-title">{say('مستهدفات العملاء والزيارات','Customer and visit targets')}</h2><p>{activitySource}</p></div></header><dl className="my-activity-targets">{activityFields.map(([key,label])=><div key={key}><dt>{t(label)}</dt><dd>{quantityNumber(data.activity[key])}</dd></div>)}</dl></section></div>;
}

export default function MyTargets({me,month,onMonthChange}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const [revision,setRevision]=useState(0),[state,setState]=useState<LoadState>({key:'',phase:'loading'});
 // Key the rendered response as well as the effect, so another identity/month never sees stale values.
 const requestKey=JSON.stringify([me.id,me.role,me.authVersion,me.regionScope,me.branch,me.supervisorId,month,revision]);
 useEffect(()=>{
  const controller=new AbortController();setState({key:requestKey,phase:'loading'});
  if(me.role!=='rep')return()=>controller.abort();
  void submitJson<OwnTargets>('/api/targets?month='+encodeURIComponent(month),{cache:'no-store',signal:controller.signal},{language}).then(body=>{if(body.member?.id!==me.id||body.month!==month)throw new Error('تعذر تحميل المستهدفات');return body as OwnTargets;}).then(data=>{if(!controller.signal.aborted)setState({key:requestKey,phase:'ready',data});}).catch(error=>{if(!controller.signal.aborted)setState({key:requestKey,phase:'error',error:error instanceof Error?error.message:''});});
  return()=>controller.abort();
 },[requestKey]);
 if(me.role!=='rep')return null;
 const current=state.key===requestKey?state:null,loading=!current||current.phase==='loading';
 const error=current?.phase==='error'?(current.error==='تعذر تحميل المستهدفات'?say('تعذر تحميل المستهدفات. حاول مرة أخرى.','Could not load your targets. Please try again.'):t(current.error||say('تعذر تحميل المستهدفات.','Could not load your targets.'))):'';
 return <section className="my-targets"><div className="my-targets-toolbar"><label className="field"><span><CalendarDays size={16}/>{t('الشهر')}</span><input type="month" value={month} required aria-label={say('شهر مستهدفي','My targets month')} onChange={event=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value))onMonthChange(event.target.value);}}/></label><div className="my-targets-owner"><Target size={18}/><strong>{me.name}</strong><span><LockKeyhole size={14}/>{say('للعرض فقط','Read only')}</span></div><button className="btn subtle" disabled={loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={17}/>{say('تحديث أدائي','Refresh progress')}</button></div>
  {loading?<div className="my-targets-state" role="status"><Loader2 size={24} className="spin"/>{say('جارٍ تحميل مستهدفك…','Loading your targets…')}</div>:error?<div className="my-targets-state my-targets-error" role="alert"><AlertCircle size={24}/><p>{error}</p><button className="btn subtle" onClick={()=>setRevision(value=>value+1)}>{say('إعادة المحاولة','Try again')}</button></div>:current?.data?<MyTargetDetails data={current.data}/>:null}
 </section>;
}
