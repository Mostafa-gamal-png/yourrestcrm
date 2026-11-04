// A customer's signature for the tests (2026-11-04): a real PNG (IHDR, IDAT deflated, IEND, each chunk with its CRC) of a white background
// with a dark scribble across it, as the signature pad exports one. Synthetic pixels only; no real signature.
import {deflateSync} from 'node:zlib';

const CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};

/**
 * A signature PNG of width × height pixels (RGB, 8 bits). seed changes the scribble, so two signatures differ byte for byte.
 * @param {{width?: number, height?: number, seed?: number, blank?: boolean}} [options]
 */
export function signaturePng({width = 480, height = 200, seed = 1, blank = false} = {}) {
  const rows = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  const ink = (x, y) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const at = y * (width * 3 + 1) + 1 + x * 3; rows[at] = rows[at + 1] = rows[at + 2] = 0x11; };
  if (!blank) for (let x = 8; x < width - 8; x++) { const y = Math.round(height / 2 + Math.sin((x + seed * 17) / 23) * height / 4); for (let d = -1; d <= 1; d++) { ink(x, y + d); ink(x + d, y); } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
/** The signature as the form sends it: {signer, png} with the PNG in base64. */
export const signatureInput = (signer = 'م. خالد العتيبي', options = {}) => ({signer, png: signaturePng(options).toString('base64')});
/** A create or an update by a sales role (representative, supervisor, sales manager) as the form sends it: with the customer's signature,
 *  unless the body says `signature` itself (undefined: sent without one). Any other body, or role, as it is. */
export function withSignature(role, body) {
  if (!['rep', 'supervisor', 'manager'].includes(role) || !['create', 'update'].includes(body?.action) || Object.hasOwn(body, 'signature')) return body;
  return {...body, signature: signatureInput()};
}
