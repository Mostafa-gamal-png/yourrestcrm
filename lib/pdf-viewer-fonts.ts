// The standard fonts of pdf.js (pdfjs-dist/standard_fonts: the Foxit Type 1 fonts and Liberation Sans, their licences beside them),
// each an asset of the build served from the CRM's own origin and fetched only when a PDF uses a font it does not carry (Helvetica, Times,
// Courier... as many quotations and POs are written): without them pdf.js draws such text in a substitute whose widths do not match.
// Loaded with pdf.js (lib/pdf-viewer-loader.ts), never by the pages everyone opens.
import font0 from 'pdfjs-dist/standard_fonts/FoxitDingbats.pfb?url';
import font1 from 'pdfjs-dist/standard_fonts/FoxitFixed.pfb?url';
import font2 from 'pdfjs-dist/standard_fonts/FoxitFixedBold.pfb?url';
import font3 from 'pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb?url';
import font4 from 'pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb?url';
import font5 from 'pdfjs-dist/standard_fonts/FoxitSerif.pfb?url';
import font6 from 'pdfjs-dist/standard_fonts/FoxitSerifBold.pfb?url';
import font7 from 'pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb?url';
import font8 from 'pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb?url';
import font9 from 'pdfjs-dist/standard_fonts/FoxitSymbol.pfb?url';
import font10 from 'pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?url';
import font11 from 'pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf?url';
import font12 from 'pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf?url';
import font13 from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url';

export const STANDARD_FONT_URLS:Record<string,string>={'FoxitDingbats.pfb':font0,'FoxitFixed.pfb':font1,'FoxitFixedBold.pfb':font2,'FoxitFixedBoldItalic.pfb':font3,'FoxitFixedItalic.pfb':font4,'FoxitSerif.pfb':font5,'FoxitSerifBold.pfb':font6,'FoxitSerifBoldItalic.pfb':font7,'FoxitSerifItalic.pfb':font8,'FoxitSymbol.pfb':font9,'LiberationSans-Bold.ttf':font10,'LiberationSans-BoldItalic.ttf':font11,'LiberationSans-Italic.ttf':font12,'LiberationSans-Regular.ttf':font13};
/** pdf.js's StandardFontDataFactory (getDocument's option): a font by its file name, from the build's own assets; any other name refused. */
export class StandardFontsFromBuild{
 constructor(_options?:unknown){void _options;}
 async fetch({filename}:{filename:string}):Promise<Uint8Array>{
  const url=Object.prototype.hasOwnProperty.call(STANDARD_FONT_URLS,filename)?STANDARD_FONT_URLS[filename]:'';
  if(!url)throw new Error('Unknown standard font');
  const response=await fetch(url,{credentials:'same-origin'});
  if(!response.ok)throw new Error('Standard font '+response.status);
  return new Uint8Array(await response.arrayBuffer());
 }
}
