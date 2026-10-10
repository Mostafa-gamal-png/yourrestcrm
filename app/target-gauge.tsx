'use client';
import {quantityNumber} from '@/lib/targets';
import './target-gauge.css';

type Props={value:number|null|undefined;label:string;emptyLabel:string;compact?:boolean};

/** Display the supplied score unchanged; only the painted circle is bounded. */
export default function TargetGauge({value,label,emptyLabel,compact=false}:Props){
 const known=typeof value==='number'&&Number.isFinite(value);
 const progress=known?Math.max(0,Math.min(100,value)):0;
 const display=known?quantityNumber(value)+'%':'—';
 const tone=!known?'empty':value>=100?'complete':value>=50?'progress':'low';
 return <div className={'target-gauge'+(compact?' target-gauge-compact':'')} data-tone={tone}>
  <svg viewBox="0 0 216 216" role="img" aria-label={label+': '+(known?display:emptyLabel)} focusable="false">
   <circle className="target-gauge-track" cx="108" cy="108" r="88"/>
   {known&&progress>0&&<circle className="target-gauge-fill" cx="108" cy="108" r="88" pathLength="100" strokeDasharray={progress+' 100'} transform="rotate(-90 108 108)"/>}
   <text className="target-gauge-value" x="108" y="119" textAnchor="middle" direction="ltr" textLength={display.length>9?150:undefined} lengthAdjust="spacingAndGlyphs" fontSize={display.length>9?18:display.length>6?25:34}>{display}</text>
  </svg>
  {!compact&&<span className="target-gauge-label">{label}</span>}
  {!known&&<span className="target-gauge-empty">{emptyLabel}</span>}
 </div>;
}
