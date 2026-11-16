// A minimal .xlsx writer for the import templates (lib/record-import-server.ts): one sheet, text cells only (inline strings, so nothing a
// person typed is ever read as a formula), a header row frozen and bold, column widths, right-to-left for Arabic. The archive is stored
// (not compressed), which every spreadsheet program opens and lib/erp-sales.ts readWorkbookSheets reads back. No dependency; pure.
const encoder=new TextEncoder();
const CRC_TABLE=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}return table;})();
export function crc32(bytes:Uint8Array){let c=0xffffffff;for(const byte of bytes)c=CRC_TABLE[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
/** XML text: the five entities, and characters XML 1.0 cannot hold are dropped. */
export const xmlText=(value:string)=>value.replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
/** A column's letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index:number){let name='',n=index+1;while(n>0){name=String.fromCharCode(65+(n-1)%26)+name;n=Math.floor((n-1)/26);}return name;}

/** A stored ZIP archive of these files (UTF-8 names, no compression, no data descriptors). */
export function storedZip(files:readonly {name:string;data:Uint8Array}[]):Uint8Array<ArrayBuffer>{
 const chunks:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
 for(const file of files){
  const name=encoder.encode(file.name),crc=crc32(file.data),size=file.data.length;
  const local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
  lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);lv.setUint16(8,0,true);lv.setUint16(10,0,true);lv.setUint16(12,0x21,true);
  lv.setUint32(14,crc,true);lv.setUint32(18,size,true);lv.setUint32(22,size,true);lv.setUint16(26,name.length,true);lv.setUint16(28,0,true);local.set(name,30);
  const entry=new Uint8Array(46+name.length),cv=new DataView(entry.buffer);
  cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);cv.setUint16(10,0,true);cv.setUint16(12,0,true);cv.setUint16(14,0x21,true);
  cv.setUint32(16,crc,true);cv.setUint32(20,size,true);cv.setUint32(24,size,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);entry.set(name,46);
  chunks.push(local,file.data);central.push(entry);offset+=local.length+size;
 }
 const directorySize=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);
 ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,directorySize,true);ev.setUint32(16,offset,true);
 const all=new Uint8Array(offset+directorySize+22);let at=0;for(const chunk of [...chunks,...central,end]){all.set(chunk,at);at+=chunk.length;}
 return all;
}

export type SheetSpec={name:string;rows:readonly (readonly string[])[];widths?:readonly number[];rightToLeft?:boolean;
 /** Rows (0-based) drawn as the header (bold) and as notes (grey italic). */
 headerRow?:number;noteRow?:number};
/** One worksheet as an .xlsx file. */
export function xlsxWorkbook(sheet:SheetSpec):Uint8Array<ArrayBuffer>{
 const rows=sheet.rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((value,c)=>value===''?'':'<c r="'+columnName(c)+(r+1)+'" t="inlineStr"'+(r===sheet.headerRow?' s="1"':r===sheet.noteRow?' s="2"':'')+'><is><t xml:space="preserve">'+xmlText(value)+'</t></is></c>').join('')+'</row>').join('');
 const cols=sheet.widths?.length?'<cols>'+sheet.widths.map((width,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.max(6,Math.min(80,width))+'" customWidth="1"/>').join('')+'</cols>':'';
 const frozen=sheet.headerRow===undefined?'':'<pane ySplit="'+(sheet.headerRow+1)+'" topLeftCell="A'+(sheet.headerRow+2)+'" activePane="bottomLeft" state="frozen"/>';
 const worksheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"'+(sheet.rightToLeft?' rightToLeft="1"':'')+'>'+frozen+'</sheetView></sheetViews>'+cols+'<sheetData>'+rows+'</sheetData></worksheet>';
 const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>';
 const part=(text:string)=>encoder.encode(text);
 return storedZip([
  {name:'[Content_Types].xml',data:part('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')},
  {name:'_rels/.rels',data:part('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')},
  {name:'xl/workbook.xml',data:part('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+xmlText(sheet.name.slice(0,31))+'" sheetId="1" r:id="rId1"/></sheets></workbook>')},
  {name:'xl/_rels/workbook.xml.rels',data:part('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')},
  {name:'xl/styles.xml',data:part(styles)},
  {name:'xl/worksheets/sheet1.xml',data:part(worksheet)},
 ]);
}

/** One sheet of a workbook with several (the owner, 2026-11-16, GSCO list item 3: «تصدير Excel» of the customer-service reports, three
 *  sheets). A cell is text (an inline string, never read as a formula), a finite number (a number cell, so a spreadsheet sums it), or
 *  empty (null, undefined or ''). headerRows are bold, noteRows grey italic; the first header row is frozen. */
export type BookCell=string|number|null|undefined;
export type BookSheet={name:string;rows:readonly (readonly BookCell[])[];widths?:readonly number[];rightToLeft?:boolean;headerRows?:readonly number[];noteRows?:readonly number[]};
/** Excel refuses a sheet name longer than 31 characters, one holding any of : \ / ? * [ ], and two sheets of the same name. */
export function bookSheetName(name:string,index:number,taken:Set<string>){
 let clean=name.replace(/[:\\/?*[\]]/g,' ').replace(/\s+/g,' ').trim().slice(0,31)||'Sheet'+(index+1);
 for(let n=2;taken.has(clean.toLowerCase());n++)clean=clean.slice(0,31-String(n).length-1)+' '+n;
 taken.add(clean.toLowerCase());return clean;
}
const bookStyles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
function bookCell(value:BookCell,ref:string,header:boolean,note:boolean){
 if(value===null||value===undefined||value==='')return '';
 if(typeof value==='number')return Number.isFinite(value)?'<c r="'+ref+'" s="'+(header?4:3)+'"><v>'+value+'</v></c>':'';
 return '<c r="'+ref+'" t="inlineStr" s="'+(header?1:note?2:0)+'"><is><t xml:space="preserve">'+xmlText(String(value))+'</t></is></c>';
}
/** A workbook of one or more sheets, each written as xlsxWorkbook writes its one (stored archive, inline text, right to left for Arabic). */
export function xlsxBook(sheets:readonly BookSheet[]):Uint8Array<ArrayBuffer>{
 const list=sheets.length?sheets:[{name:'Sheet1',rows:[]}],taken=new Set<string>(),names=list.map((sheet,index)=>bookSheetName(sheet.name,index,taken));
 const part=(text:string)=>encoder.encode(text),xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const worksheets=list.map(sheet=>{
  const headers=new Set(sheet.headerRows||[]),notes=new Set(sheet.noteRows||[]);
  const rows=sheet.rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((value,c)=>bookCell(value,columnName(c)+(r+1),headers.has(r),notes.has(r))).join('')+'</row>').join('');
  const cols=sheet.widths?.length?'<cols>'+sheet.widths.map((width,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.max(6,Math.min(80,width))+'" customWidth="1"/>').join('')+'</cols>':'';
  const first=sheet.headerRows?.length?Math.min(...sheet.headerRows):undefined;
  const frozen=first===undefined?'':'<pane ySplit="'+(first+1)+'" topLeftCell="A'+(first+2)+'" activePane="bottomLeft" state="frozen"/>';
  return xml+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"'+(sheet.rightToLeft?' rightToLeft="1"':'')+'>'+frozen+'</sheetView></sheetViews>'+cols+'<sheetData>'+rows+'</sheetData></worksheet>';
 });
 return storedZip([
  {name:'[Content_Types].xml',data:part(xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+list.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')},
  {name:'_rels/.rels',data:part(xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')},
  {name:'xl/workbook.xml',data:part(xml+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+names.map((name,i)=>'<sheet name="'+xmlText(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>')},
  {name:'xl/_rels/workbook.xml.rels',data:part(xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+list.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(list.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')},
  {name:'xl/styles.xml',data:part(bookStyles)},
  ...worksheets.map((text,i)=>({name:'xl/worksheets/sheet'+(i+1)+'.xml',data:part(text)})),
 ]);
}
