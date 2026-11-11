// Synthetic documents for the tests of the ONE signed document (2026-11-11): PDFs made here with pdf-lib (A4 pages with a coloured band and
// their label, a page turned or cropped on request), two tiny real JPEG pictures (a wide one and an upright one, plain colours), a
// protected and a damaged PDF, and a signature page as a real PNG of an A4 sheet. No real document, no real signature.
import {PDFDocument, StandardFonts, degrees, rgb} from 'pdf-lib';
import {signaturePng} from './signature-png.mjs';

const COLORS = [rgb(0.85, 0.2, 0.15), rgb(0.1, 0.45, 0.8), rgb(0.15, 0.6, 0.3)];
/** A PDF of `pages` pages labelled «<label> - page n of m»; rotate: the given pages turned (/Rotate); crop: the given pages cropped to
 *  their upper half. */
export async function makePdf(label, pages = 2, {rotate = {}, crop = []} = {}) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({x: 40, y: 600, width: 515, height: 200, color: COLORS[i % 3]});
    page.drawText(label + ' - page ' + (i + 1) + ' of ' + pages, {x: 60, y: 560, size: 22, font});
    if (rotate[i + 1]) page.setRotation(degrees(rotate[i + 1]));
    if (crop.includes(i + 1)) page.setCropBox(0, 421, 595, 421);
  }
  return Buffer.from(await doc.save());
}
/** A PDF whose trailer names an encryption dictionary: pdf-lib refuses it as encrypted. */
export async function encryptedPdf() {
  const doc = await PDFDocument.create(); doc.addPage();
  doc.context.trailerInfo.Encrypt = doc.context.obj({Filter: 'Standard', V: 1, R: 2});
  return Buffer.from(await doc.save());
}
/** A file with a PDF's header and nothing of a PDF's body. */
export const DAMAGED_PDF = Buffer.from('%PDF-1.7\nthis is not a real PDF body, it was cut short\n');
/** Real JPEG pictures (made once with Pillow, plain colours): 64 × 40 (wide, blue) and 40 × 64 (upright, red). */
export const JPEG_WIDE = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAoAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDKooor6w+VCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9k=', 'base64');
export const JPEG_TALL = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABAACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDJooorxD7oKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/2Q==', 'base64');
/** A signature page as the browser composes one: a real PNG of an A4 sheet, 1240 × 1754. */
export const signaturePagePng = (seed = 3) => signaturePng({width: 1240, height: 1754, seed});
