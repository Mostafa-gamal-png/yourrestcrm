/** Keep manual and ERP invoice identity identical without changing its display.
 * ERP exports/pasted references may contain bidi marks or compatibility glyphs,
 * and one typed on an Arabic keyboard may carry Arabic-Indic digits (١٠٢٣ is 1023).
 */
export function canonicalInvoiceReference(value:string):string {
 return value.normalize('NFKC')
  .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'')
  .replace(/[\u0660-\u0669\u06f0-\u06f9]/g,digit=>String(digit.charCodeAt(0)-(digit>='\u06f0'?0x6f0:0x660)))
  .replace(/\s+/g,' ').trim().toUpperCase();
}
