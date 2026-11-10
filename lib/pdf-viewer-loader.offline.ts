// The offline shell's stand-in for lib/pdf-viewer-loader.ts (scripts/build-offline-shell.mjs): signing needs the internet, so the shell
// carries no pdf.js (its cache stays small) and a document shown there says it could not be drawn.
import type {Pdfjs,PdfjsLoaded} from './pdf-viewer-loader';
export type {Pdfjs,PdfjsLoaded};
export function loadPdfjs():Promise<PdfjsLoaded>{return Promise.reject(new Error('pdf.js is not part of the offline shell'));}
