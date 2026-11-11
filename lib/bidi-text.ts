// The order of a line that mixes Arabic and Latin (2026-11-11: on the signature page drawn as a picture, «كود ERP: ERP-east1» and a file
// name «رسم القالب.pdf» came out in a confusing order: the dot of «.pdf» on the far side of «pdf», a range or a code split from its label).
// Pure, shared by the screen (app/bidi-text.tsx) and the canvas (drawBidiLine below, on the signature page and the signature block):
// - A line is cut into runs of the line's own direction and runs of the other one. In a right-to-left line, a Latin run is a code, a file
//   name, a number, a date or a page range kept whole: Latin letters and digits with the spaces and the marks between them («Q-77 final.pdf»,
//   «11/11/2026 - 11:13», «1–2», «ERP: ERP-east1»), and the dot of an extension written after Arabic («.pdf» of «رسم القالب.pdf»). In a
//   left-to-right line (English) an Arabic run is the Arabic words with the digits, spaces and marks between them («قالب بلوك 20 - مستند واحد»).
// - Each run is laid out on its own, in its own direction, and the runs follow one another from the line's start (the right edge in Arabic,
//   the left edge in English): no run depends on the canvas guessing a direction, and no isolate mark can be cut by a line break.
// - The direction marks the text carries already (LRM, RLM, isolates, embeddings) are taken out first: the runs decide the order.
// - A line is given as segments (a bold label, the value after it) so a run may cross from one to the next and still read in one order.

/** A piece of a line in one style, in the order it is read (the label, then the value). */
export type BidiSegment={text:string;bold?:boolean};
/** One run of the line: its text in one segment, whether it goes against the line's direction, which run of the line it is (a run that crosses
 *  segments is cut into one part for each), and its segment. */
export type BidiPart={text:string;opposite:boolean;run:number;segment:number};

const CONTROLS=/[؜‎‏‪-‮⁦-⁩]/g;
const LATIN='A-Za-z0-9\\u00c0-\\u024f';
const ARABIC='\\u0600-\\u06ff\\u0750-\\u077f\\u08a0-\\u08ff\\ufb50-\\ufdff\\ufe70-\\ufeff';
/** A Latin run inside Arabic: optionally the «.» of an extension or a mark that opens it, then Latin up to its last Latin letter or digit
 *  (or a closing bracket or percent sign), with the spaces and marks between. */
const LATIN_RUN=new RegExp(`[.#(+]?[${LATIN}](?:[${LATIN} .,_\\-\\u2013/:+()&@#%'"*]*[${LATIN})%])?`,'g');
/** An Arabic run inside English: from an Arabic letter to the last Arabic letter, with the digits, spaces and marks between. */
const ARABIC_RUN=new RegExp(`[${ARABIC}](?:[${ARABIC}0-9 .,_\\-\\u2013/:()«»"'*]*[${ARABIC}])?`,'g');

export const stripBidiControls=(text:string)=>text.replace(CONTROLS,'');

/** The parts of a line in reading order. rtl: the line's direction (Arabic: true). */
export function bidiParts(segments:readonly BidiSegment[],rtl:boolean):BidiPart[]{
 const texts=segments.map(segment=>stripBidiControls(segment.text)),whole=texts.join('');
 // The opposite runs over the whole line, as [start, end) offsets.
 const runs:[number,number][]=[];
 for(const match of whole.matchAll(rtl?LATIN_RUN:ARABIC_RUN))runs.push([match.index!,match.index!+match[0].length]);
 // Cut points: every run's edges and every segment's edges.
 const cuts=new Set<number>([0,whole.length]);
 for(const [start,end] of runs){cuts.add(start);cuts.add(end);}
 let offset=0;for(const text of texts){cuts.add(offset);offset+=text.length;}
 const sorted=[...cuts].sort((a,b)=>a-b),parts:BidiPart[]=[];
 const segmentAt=(at:number)=>{let sum=0;for(let index=0;index<texts.length;index++){sum+=texts[index].length;if(at<sum)return index;}return texts.length-1;};
 let runIndex=-1,lastKey='';
 for(let index=0;index<sorted.length-1;index++){
  const start=sorted[index],end=sorted[index+1];
  if(start===end)continue;
  const found=runs.findIndex(([from,to])=>start>=from&&end<=to);
  // One number for each opposite run, and one for each stretch of the line's own direction between two of them.
  const key=found>=0?'o'+found:'b'+runs.filter(([from])=>from<start).length;
  if(key!==lastKey){runIndex++;lastKey=key;}
  parts.push({text:whole.slice(start,end),opposite:found>=0,run:runIndex,segment:segmentAt(start)});
 }
 return parts;
}

/** A word of a part (the unit a line is broken at): whether white space came before it in the line. */
export type BidiWord={text:string;opposite:boolean;run:number;segment:number;space:boolean};
export function bidiWords(segments:readonly BidiSegment[],rtl:boolean):BidiWord[]{
 const words:BidiWord[]=[];let spaced=false;
 for(const part of bidiParts(segments,rtl)){
  for(const piece of part.text.split(/(\s+)/)){
   if(!piece)continue;
   if(/^\s+$/.test(piece)){spaced=true;continue;}
   words.push({text:piece,opposite:part.opposite,run:part.run,segment:part.segment,space:spaced&&words.length>0});spaced=false;
  }
 }
 return words;
}

/** What is drawn of a line: its groups (one run each, in reading order), each the parts of one style drawn in the group's direction. gap: the
 *  white space before it. width: in the measure's units. */
export type BidiPiece={text:string;segment:number;width:number;gap:number};
export type BidiGroup={rtl:boolean;pieces:BidiPiece[];width:number;gap:number};
export type BidiLine={groups:BidiGroup[];width:number};
/** measure(text, segment): the width of a text in a segment's style. */
export type BidiMeasure=(text:string,segment:number)=>number;

/** A line's words broken into lines of at most max wide (a word wider than max is cut by characters), each made into its groups. */
export function layoutBidi(segments:readonly BidiSegment[],rtl:boolean,max:number,measure:BidiMeasure):BidiLine[]{
 const words:BidiWord[]=[];
 for(const word of bidiWords(segments,rtl)){
  if(measure(word.text,word.segment)<=max){words.push(word);continue;}
  let piece='',first=true;
  for(const char of [...word.text]){if(piece&&measure(piece+char,word.segment)>max){words.push({...word,text:piece,space:first&&word.space});first=false;piece='';}piece+=char;}
  if(piece)words.push({...word,text:piece,space:first&&word.space});
 }
 const lines:BidiWord[][]=[];let line:BidiWord[]=[],width=0;
 for(const word of words){
  const gap=line.length&&word.space?measure(' ',word.segment):0,next=width+gap+measure(word.text,word.segment);
  if(line.length&&next>max){lines.push(line);line=[word];width=measure(word.text,word.segment);continue;}
  line.push(word);width=next;
 }
 if(line.length)lines.push(line);
 return (lines.length?lines:[[]]).map(items=>groupLine(items,rtl,measure));
}
function groupLine(words:readonly BidiWord[],rtl:boolean,measure:BidiMeasure):BidiLine{
 const groups:BidiGroup[]=[];
 for(const [index,word] of words.entries()){
  const gap=index&&word.space?measure(' ',word.segment):0,group=groups.at(-1);
  if(!group||words[index-1].run!==word.run){
   const width=measure(word.text,word.segment);
   groups.push({rtl:word.opposite?!rtl:rtl,pieces:[{text:word.text,segment:word.segment,width,gap:0}],width,gap});continue;
  }
  const piece=group.pieces.at(-1)!;
  if(piece.segment===word.segment){const before=piece.width;piece.text+=(word.space?' ':'')+word.text;piece.width=measure(piece.text,piece.segment);group.width+=piece.width-before;}
  else{const width=measure(word.text,word.segment);group.pieces.push({text:word.text,segment:word.segment,width,gap});group.width+=gap+width;}
 }
 return {groups,width:groups.reduce((sum,group,index)=>sum+(index?group.gap:0)+group.width,0)};
}
/** Where each piece of a line goes: its x and how it is anchored, the line starting at start (its right edge in a right-to-left line, its
 *  left edge otherwise). The canvas draws each piece with its group's direction. */
export function placeBidiLine(line:BidiLine,rtl:boolean,start:number){
 const placed:{text:string;segment:number;x:number;rtl:boolean;align:'left'|'right'}[]=[];
 let cursor=start;
 for(const [index,group] of line.groups.entries()){
  if(index)cursor+=rtl?-group.gap:group.gap;
  const left=rtl?cursor-group.width:cursor,right=left+group.width;
  // Inside a group its pieces follow its own direction: from its right edge for a right-to-left group, from its left edge otherwise.
  let at=group.rtl?right:left;
  for(const piece of group.pieces){
   if(piece.gap)at+=group.rtl?-piece.gap:piece.gap;
   placed.push({text:piece.text,segment:piece.segment,x:at,rtl:group.rtl,align:group.rtl?'right':'left'});
   at+=group.rtl?-piece.width:piece.width;
  }
  cursor=rtl?left:right;
 }
 return placed;
}

/** What drawBidiLine needs of a canvas. */
export type BidiCanvas={font:string;fillStyle:string|CanvasGradient|CanvasPattern;direction:CanvasDirection;textAlign:CanvasTextAlign;measureText(text:string):{width:number};fillText(text:string,x:number,y:number):void};
/** A measure for layoutBidi on a canvas: fonts[segment] is the CSS font of that segment. */
export const canvasMeasure=(g:BidiCanvas,fonts:readonly string[]):BidiMeasure=>(text,segment)=>{g.font=fonts[segment]||fonts[0];return g.measureText(text).width;};
/** Draws one line made by layoutBidi at y: from start (see placeBidiLine), or centred on center when given. */
export function drawBidiLine(g:BidiCanvas,line:BidiLine,{rtl,start,center,y,fonts,colors}:{rtl:boolean;start?:number;center?:number;y:number;fonts:readonly string[];colors:readonly string[]}){
 const from=center!==undefined?(rtl?center+line.width/2:center-line.width/2):start??0;
 for(const piece of placeBidiLine(line,rtl,from)){
  g.font=fonts[piece.segment]||fonts[0];g.fillStyle=colors[piece.segment]||colors[0];
  g.direction=piece.rtl?'rtl':'ltr';g.textAlign=piece.align;
  g.fillText(piece.text,piece.x,y);
 }
}
