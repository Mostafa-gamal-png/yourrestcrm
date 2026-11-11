// The signature page and the signature block drawn on a canvas as CELLS (2026-11-11, second pass: a line that mixed a label, a value, a file
// name and a page range in one run of text came out in a confusing order: «كود ERP: ERP-east1», «رسم القالب.pdf», «صفحات 1–2» split onto
// its own line). Pure (no import, no DOM global), shared by app/mold-signature-page.tsx, app/mold-signature.tsx and the browser test:
// - A fact is two cells: the label (alone, in the page's direction) at the start side, the value in its own cell with its own direction
//   (the first strong character, as dir="auto": a Latin value left to right, an Arabic value right to left), aligned towards the label.
// - A document is three cells: its kind, its file name (its own direction, the platform's standard order for an Arabic name: «pdf.رسم
//   القالب» reads «رسم القالب.pdf» from the right), and its pages («صفحات 1–2», never wrapped, the numbers inside LRI…PDI).
// - Each cell's line is ONE fillText with the canvas's direction set to that cell's: Chromium applies the Unicode bidi algorithm inside
//   it. A long value wraps inside its own cell only. Nothing mixes two cells in one bidi paragraph.

export type Dir='rtl'|'ltr';
const RTL_CHAR=/[֐-ࣿיִ-﷿ﹰ-ﻼ]/,LTR_CHAR=/[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
const ISOLATES=/[⁦-⁩]/;
/** The direction of a text as dir="auto" decides it: its first strong character (text inside an isolate skipped), else the fallback. */
export function firstStrongDir(text:string,fallback:Dir):Dir{
 let depth=0;
 for(const char of text){
  if(char==='⁩'){depth=Math.max(0,depth-1);continue;}
  if(ISOLATES.test(char)){depth++;continue;}
  if(depth)continue;
  if(RTL_CHAR.test(char))return 'rtl';
  if(LTR_CHAR.test(char))return 'ltr';
 }
 return fallback;
}
/** A text kept left to right inside a right-to-left line (a range, a moment): LRI … PDI. */
export const ltrIsolate=(text:string)=>'⁦'+text+'⁩';
/** A text's words broken into lines of at most max wide (a word wider than max is cut by characters); white space is collapsed. */
export function wrapWords(text:string,max:number,measure:(text:string)=>number):string[]{
 const lines:string[]=[];let line='';
 for(const word of text.split(/\s+/).filter(Boolean)){
  const next=line?line+' '+word:word;
  if(measure(next)<=max){line=next;continue;}
  if(line)lines.push(line);
  if(measure(word)<=max){line=word;continue;}
  let piece='';
  for(const char of [...word]){if(piece&&measure(piece+char)>max){lines.push(piece);piece='';}piece+=char;}
  line=piece;
 }
 if(line)lines.push(line);
 return lines.length?lines:[''];
}

/** What the drawing needs of a canvas (a CanvasRenderingContext2D; a recording stand-in in the tests). */
export type SignCanvas={font:string;fillStyle:unknown;strokeStyle:unknown;lineWidth:number;direction:string;textAlign:string;textBaseline:string;
 measureText(text:string):{width:number};fillText(text:string,x:number,y:number):void;fillRect(x:number,y:number,w:number,h:number):void;strokeRect(x:number,y:number,w:number,h:number):void;
 beginPath():void;moveTo(x:number,y:number):void;lineTo(x:number,y:number):void;stroke():void};
/** One text drawn: one fillText. */
export type DrawnText={text:string;x:number;y:number;font:string;color:string;dir:Dir;align:'left'|'right'|'center';cell?:{row:string;column:number}};

/** A column of a table: its font and colour, whether its cells take the page's direction or their own (auto), whether it takes the room
 *  left (grow), the most of the width it may take (max, a share), and whether it never wraps. */
export type Column={font:string;color:string;dir:'page'|'auto';grow?:boolean;max?:number;nowrap?:boolean};
/** A table laid out from the start edge (the right in Arabic): each cell's lines at its offset, the row height the tallest cell's. */
export function layoutTable(g:SignCanvas,rows:readonly (readonly string[])[],columns:readonly Column[],{width,gap,size,rtl,start,top,name}:{width:number;gap:number;size:number;rtl:boolean;start:number;top:number;name:string}){
 const measure=(column:number)=>(text:string)=>{g.font=columns[column].font;return g.measureText(text).width;};
 const widths=columns.map((column,index)=>column.grow?0:Math.min(Math.max(0,...rows.map(row=>measure(index)(row[index]||''))),width*(column.max??0.45)));
 const grow=columns.findIndex(column=>column.grow);
 if(grow>=0)widths[grow]=Math.max(width*0.25,width-widths.reduce((sum,value)=>sum+value,0)-gap*(columns.length-1));
 const offsets=widths.map((_,index)=>widths.slice(0,index).reduce((sum,value)=>sum+value+gap,0));
 const lineHeight=size*1.5,texts:DrawnText[]=[];
 let y=top;
 for(const [rowIndex,row] of rows.entries()){
  const cells=columns.map((column,index)=>{const text=row[index]||'';return column.nowrap?[text]:wrapWords(text,widths[index],measure(index));});
  for(const [index,lines] of cells.entries()){
   const column=columns[index],text=row[index]||'',dir=column.dir==='auto'?firstStrongDir(text,rtl?'rtl':'ltr'):(rtl?'rtl':'ltr');
   for(const [at,line] of lines.entries())texts.push({text:line,x:rtl?start-offsets[index]:start+offsets[index],y:y+size*1.1+at*lineHeight,font:column.font,color:column.color,dir,align:rtl?'right':'left',cell:{row:name+':'+rowIndex,column:index}});
  }
  y+=Math.max(...cells.map(lines=>lines.length))*lineHeight;
 }
 return {texts,height:y-top,widths,offsets};
}
export function drawTexts(g:SignCanvas,texts:readonly DrawnText[]){
 for(const item of texts){g.font=item.font;g.fillStyle=item.color;g.direction=item.dir;g.textAlign=item.align;g.fillText(item.text,item.x,item.y);}
}

/** The signature page's words, as lines and cells (made by app/mold-signature-page.tsx from the request and its documents). */
export type SignPageContent={title:string;heading:string;facts:[string,string][];documentsTitle:string;documents:[string,string,string][];none:string;
 othersTitle:string;others:[string,string,string][];consent:string;signerLabel:string;signer:string;when:string;counter:string};
/** Draws the whole page on a W×H canvas: the words at the largest scale that leaves the signature box at least 420 high, the box with the
 *  signer's row, the drawing (drawing(room) draws the strokes into the room given) and the moment, and the counter at the foot. */
export function drawSignaturePage(g:SignCanvas,content:SignPageContent,{width:W,height:H,rtl,family,drawing}:{width:number;height:number;rtl:boolean;family:string;drawing:(room:{x:number;y:number;width:number;height:number})=>void}){
 const margin=90,inner=W-2*margin,start=rtl?W-margin:margin,dir:Dir=rtl?'rtl':'ltr',align=rtl?'right':'left';
 const font=(weight:string,size:number)=>weight+' '+size+'px '+family;
 const layout=(s:number)=>{
  const texts:DrawnText[]=[];let y=90,rule=0;
  const centred=(text:string,size:number,weight:string,color:string,gap:number)=>{texts.push({text,x:W/2,y:y+size*1.1,font:font(weight,size),color,dir,align:'center'});y+=size*1.5+gap;};
  const paragraph=(text:string,size:number,weight:string,color:string,gap:number)=>{
   const f=font(weight,size),lines=wrapWords(text,inner,line=>{g.font=f;return g.measureText(line).width;});
   for(const line of lines){texts.push({text:line,x:start,y:y+size*1.1,font:f,color,dir,align});y+=size*1.5;}
   y+=gap;
  };
  const table=(name:string,rows:readonly (readonly string[])[],columns:Column[],size:number,gap:number)=>{const laid=layoutTable(g,rows,columns,{width:inner,gap:18*s,size,rtl,start,top:y,name});texts.push(...laid.texts);y+=laid.height+gap;};
  centred(content.title,44*s,'bold','#111',10*s);rule=y;y+=8*s;
  centred(content.heading,26*s,'normal','#444',22*s);
  table('fact',content.facts,[{font:font('bold',23*s),color:'#111',dir:'page'},{font:font('normal',23*s),color:'#111',dir:'auto',grow:true}],23*s,14*s);
  paragraph(content.documentsTitle,26*s,'bold','#111',4*s);
  if(content.documents.length)table('document',content.documents,[{font:font('bold',22*s),color:'#111',dir:'page'},{font:font('normal',22*s),color:'#111',dir:'auto',grow:true},{font:font('normal',22*s),color:'#111',dir:'page',nowrap:true}],22*s,10*s);
  else paragraph(content.none,22*s,'normal','#111',10*s);
  if(content.others.length){paragraph(content.othersTitle,26*s,'bold','#111',4*s);table('other',content.others,[{font:font('bold',21*s),color:'#333',dir:'page'},{font:font('normal',21*s),color:'#333',dir:'auto',grow:true},{font:font('normal',21*s),color:'#333',dir:'page',max:0.4}],21*s,10*s);}
  paragraph(content.consent,24*s,'bold','#111',0);
  return {texts,height:y,rule};
 };
 let scale=1,laid=layout(1);
 while(scale>0.55&&laid.height+24+420+70>H){scale-=0.05;laid=layout(scale);}
 g.fillStyle='#fff';g.fillRect(0,0,W,H);g.textBaseline='alphabetic';
 drawTexts(g,laid.texts);
 g.strokeStyle='#5b6b62';g.lineWidth=2;g.beginPath();g.moveTo(margin,laid.rule+2);g.lineTo(W-margin,laid.rule+2);g.stroke();
 // The signature box: the signer's row at its top (label cell, name cell), the drawing in the middle, the moment at its foot.
 const boxTop=laid.height+24,boxHeight=Math.max(260,H-70-boxTop),pad=26;
 g.strokeStyle='#1d2a22';g.lineWidth=3;g.strokeRect(margin,boxTop,inner,boxHeight);
 const signerRow=labelValueRow(g,content.signerLabel,content.signer,{room:inner-2*pad,start:rtl?W-margin-pad:margin+pad,y:boxTop+pad,rtl,family,size:30,min:16,weight:'bold'});
 drawTexts(g,signerRow.texts);
 const whenSize=fitSize(g,content.when,inner-2*pad,size=>font('normal',size),24,14);
 drawTexts(g,[{text:content.when,x:rtl?W-margin-pad:margin+pad,y:boxTop+boxHeight-pad,font:font('normal',whenSize),color:'#333',dir,align}]);
 const roomTop=boxTop+pad+signerRow.size+18,roomBottom=boxTop+boxHeight-pad-whenSize-18;
 drawing({x:margin+pad,y:roomTop,width:inner-2*pad,height:Math.max(40,roomBottom-roomTop)});
 drawTexts(g,[{text:content.counter,x:W/2,y:H-28,font:font('normal',22),color:'#555',dir,align:'center'}]);
 return laid.texts;
}
/** The largest size from size down to min at which a text fits room. */
export function fitSize(g:SignCanvas,text:string,room:number,font:(size:number)=>string,size:number,min:number){
 let next=size;
 for(;next>min;next-=1){g.font=font(next);if(g.measureText(text).width<=room)break;}
 return next;
}
/** «<label> <value>» as two cells on one line: the label in the page's direction at the start, the value after a gap in its own
 *  direction, the size lowered until both fit. */
export function labelValueRow(g:SignCanvas,label:string,value:string,{room,start,y,rtl,family,size,min,weight,color='#111'}:{room:number;start:number;y:number;rtl:boolean;family:string;size:number;min:number;weight:string;color?:string}){
 const font=(next:number)=>weight+' '+next+'px '+family;
 let next=size,labelWidth=0,gap=0;
 for(;;next-=1){g.font=font(next);labelWidth=g.measureText(label).width;gap=next*0.4;if(labelWidth+gap+g.measureText(value).width<=room||next<=min)break;}
 const dir:Dir=rtl?'rtl':'ltr',align=rtl?'right':'left',baseline=y+next;
 const texts:DrawnText[]=[{text:label,x:start,y:baseline,font:font(next),color,dir,align,cell:{row:'signer',column:0}},
  {text:value,x:rtl?start-labelWidth-gap:start+labelWidth+gap,y:baseline,font:font(next),color,dir:firstStrongDir(value,dir),align,cell:{row:'signer',column:1}}];
 return {texts,size:next};
}
