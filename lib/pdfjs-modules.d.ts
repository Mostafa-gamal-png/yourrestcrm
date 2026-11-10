// The two files of pdfjs-dist the signing screens load (lib/pdf-viewer-loader.ts): the legacy build and its worker's address (Vite's ?url).
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs'{export * from 'pdfjs-dist';}
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'{const src:string;export default src;}
declare module 'pdfjs-dist/standard_fonts/*'{const src:string;export default src;}
