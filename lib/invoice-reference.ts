/** Keep manual and ERP invoice identity identical without changing its display.
 * ERP exports/pasted references may contain bidi marks or compatibility glyphs.
 */
export function canonicalInvoiceReference(value:string):string {
 return value.normalize('NFKC')
  .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'')
  .replace(/\s+/g,' ').trim().toUpperCase();
}
