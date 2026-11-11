// pdf.js for the signing screens only (2026-11-10): loaded the first time a document is shown (a chunk of its own, never part of the pages
// everyone opens), with its worker served from the CRM's own origin (an asset of the build, application/javascript). pdf.js runs the
// worker as a module worker; where a worker cannot start, pdf.js itself falls back to running the same file on the page (its «fake
// worker»): slower, still drawn. The legacy build: the Android app's WebView and older phones lack what the modern build assumes.
// The offline shell (scripts/build-offline-shell.mjs) replaces this module with lib/pdf-viewer-loader.offline.ts: no PDF is drawn there.
// The standard fonts (lib/pdf-viewer-fonts.ts) come with it, for a PDF that names a font without carrying it.
import type * as PdfjsModule from 'pdfjs-dist';
import type {PdfLibForPlan} from './mold-signed-document';

export type Pdfjs=typeof PdfjsModule;
export type PdfjsLoaded={pdfjs:Pdfjs;StandardFontDataFactory:new (options:{baseUrl:string|null})=>{fetch(data:{filename:string}):Promise<Uint8Array>}};
let loading:Promise<PdfjsLoaded>|null=null;
export function loadPdfjs():Promise<PdfjsLoaded>{
 if(!loading)loading=Promise.all([import('pdfjs-dist/legacy/build/pdf.min.mjs'),import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),import('./pdf-viewer-fonts')]).then(([pdfjs,worker,fonts])=>{
  const loaded=pdfjs as unknown as Pdfjs;
  loaded.GlobalWorkerOptions.workerSrc=worker.default;
  return {pdfjs:loaded,StandardFontDataFactory:fonts.StandardFontsFromBuild};
 }).catch(error=>{loading=null;throw error;});
 return loading;
}
/** pdf-lib for the signing screens (2026-11-11): it counts each PDF's pages the way the server builds the signed document (the same library
 *  and version: lib/mold-signed-document.ts pdfPageCount), so the page ranges printed on the signature page are the file's. A chunk of its
 *  own, loaded the first time a document is shown. */
export type PdfLibLoaded=PdfLibForPlan;
let loadingLib:Promise<PdfLibLoaded>|null=null;
export function loadPdfLib():Promise<PdfLibLoaded>{
 if(!loadingLib)loadingLib=import('pdf-lib').then(module=>({PDFDocument:module.PDFDocument})).catch(error=>{loadingLib=null;throw error;});
 return loadingLib;
}
