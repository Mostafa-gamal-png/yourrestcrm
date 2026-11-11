'use client';
// A line that mixes Arabic and Latin on the screen, in the same order as the signature page draws it (lib/bidi-text.ts): each run that goes
// against the page's direction (a code, a file name, a number, a date or a range in Arabic; the Arabic words in English) is its own isolate,
// the rest is the page's own text, and a run may cross from a bold label into its value («كود ERP: ERP-east1» reads as one).
import React from 'react';
import {bidiParts,type BidiSegment} from '@/lib/bidi-text';

type Say=(ar:string,en:string)=>string;
/** Whether the page reads right to left, from its say(). */
export const sayIsRtl=(say:Say)=>say('ar','en')==='ar';
export default function BidiText({segments,rtl}:{segments:readonly BidiSegment[];rtl:boolean}){
 const parts=bidiParts(segments,rtl),out:React.ReactNode[]=[];
 for(let index=0;index<parts.length;){
  const run=parts[index].run,group=[];
  while(index<parts.length&&parts[index].run===run)group.push(parts[index++]);
  const inner=group.map((part,at)=>segments[part.segment].bold?<b key={at}>{part.text}</b>:<React.Fragment key={at}>{part.text}</React.Fragment>);
  out.push(group[0].opposite?<bdi key={run} dir={rtl?'ltr':'rtl'}>{inner}</bdi>:<React.Fragment key={run}>{inner}</React.Fragment>);
 }
 return <>{out}</>;
}
