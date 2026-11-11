// The quotation numbers an ERP sales invoice line names in its «الوصف» (the owner, 2026-11-11: «الفواتير مربوطة بعروض السعر فى عمود
// الوصف»). The ERP numbers its quotations «Qut-349»; a line may write «Qut-349», «Qut 349», «QUT-349», «qut349», «Qut-٣٤٩» or several of
// them in one cell. Each is read as the ERP writes it, «Qut-<number>» (leading zeros dropped), so the invoice and the CRM quote record
// imported from the ERP (data.number «Qut-349», lib/erp-quotes.ts) meet on the same text. Pure: shared by the import and the KPI.

/** At most this many references are kept for one invoice (a cell of a real export names one or two). */
export const MAX_QUOTATION_REFS=50;
const arabicDigits=(value:string)=>value.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?0x6f0:0x660)));
// «Qut», then nothing or separators (spaces, dashes of any width, the tatweel, «_», «.», «/», «#», «:», «№»), then the digits. Not after a
// Latin letter or a digit, so «ABCQut-1» and «2Qut-1» are not read; «عرضQut-1» (Arabic before it) is.
const REF=/(?<![A-Za-z0-9])qut[\s\-‐‑‒–—―ـ_./#:№]*(\d{1,9})(?!\d)/giu;
const clean=(value:unknown)=>arabicDigits(String(value??'').normalize('NFKC').replace(/[​-‏‪-‮⁦-⁩﻿]/g,''));

/** Every quotation reference in a text, each once, in the order first written, as «Qut-349». None: []. */
export function quotationRefs(text:unknown):string[]{
 const found:string[]=[];
 for(const match of clean(text).matchAll(REF)){
  const ref='Qut-'+String(Number(match[1]));
  if(!found.includes(ref))found.push(ref);
  if(found.length>=MAX_QUOTATION_REFS)break;
 }
 return found;
}
/** The reference a quote number stands for («Qut-0349» and «qut 349» are «Qut-349»), or null when the number is not an ERP quotation
 *  number (a quote numbered in the CRM some other way cannot be named by an invoice's description). */
export function quotationRefKey(number:unknown):string|null{
 const text=clean(number).trim(),refs=quotationRefs(text);
 if(refs.length!==1)return null;
 // The whole number must be the reference («Qut-349», «QUT 349»), not a longer text that happens to hold one.
 return /^qut[\s\-‐‑‒–—―ـ_./#:№]*\d{1,9}$/iu.test(text)?refs[0]:null;
}
/** A stored list read back: only well-formed references, each once, at most MAX_QUOTATION_REFS. */
export function storedQuotationRefs(value:unknown):string[]{
 if(!Array.isArray(value))return [];
 const out:string[]=[];
 for(const item of value){if(typeof item==='string'&&/^Qut-\d{1,9}$/.test(item)&&!out.includes(item))out.push(item);if(out.length>=MAX_QUOTATION_REFS)break;}
 return out;
}
