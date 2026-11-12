// Calls the production application's mold requests API (contract version 1, §1): the address and the shared secret come from the
// private settings (YR_PRODUCTS_API_URL, YR_PRODUCTS_SECRET), every call is a signed HTTPS POST with a 10-second limit (120 seconds for
// the design files), and the bytes sent are the bytes signed. The secret is never returned, logged or put in an error. Used by the
// server and the import tool.
import {createHash, createHmac} from 'node:crypto';
import {MOLD_BODY_LIMIT, MOLD_CUSTOMERS_BODY_LIMIT, MOLD_SALESMEN_BODY_LIMIT, moldSalesmenAnswer, MOLD_TIMEOUT_MS, MOLD_DESIGN_MAX_BYTES, MOLD_DESIGN_LINE_LIMIT, MOLD_DESIGN_TIMEOUT_MS, moldDesignContentType, moldDesignFileEntry, moldDispositionName, moldStatusObject, readMoldAnswer} from './mold-rules.mjs';

/** X-YR-Signature: lower-case hex HMAC-SHA256 of "<timestamp>\n<METHOD>\n<route>\n<sha256-hex(body as sent)>" with the secret. */
export function moldSignature(secret, timestamp, method, route, body) {
  const digest = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret).update(timestamp + '\n' + method + '\n' + route + '\n' + digest).digest('hex');
}

/**
 * The connection settings, or why there are none. reason: not_configured (a value is missing), invalid_url (not an exact HTTPS address
 * without credentials, query or fragment), short_secret (fewer than 32 characters). Nothing secret is in the answer.
 * @param {Record<string, unknown> | null | undefined} source
 * @returns {{ok: true, url: string, secret: string} | {ok: false, reason: string}}
 */
export function moldConfig(source) {
  const url = typeof source?.YR_PRODUCTS_API_URL === 'string' ? source.YR_PRODUCTS_API_URL.trim() : '';
  const secret = typeof source?.YR_PRODUCTS_SECRET === 'string' ? source.YR_PRODUCTS_SECRET : '';
  if (!url || !secret) return {ok: false, reason: 'not_configured'};
  let parsed;
  try { parsed = new URL(url); } catch { return {ok: false, reason: 'invalid_url'}; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return {ok: false, reason: 'invalid_url'};
  if (secret.length < 32) return {ok: false, reason: 'short_secret'};
  return {ok: true, url: parsed.href, secret};
}

const routes = new Set(['requests', 'status', 'cancel', 'approval', 'pending', 'customers', 'salesmen', 'design-files', 'design-file-delete', 'design-file']);
/** How long a call may take: 120 seconds for the routes that carry a file (its upload, its download), 10 for the others (the customers
 *  route passes its own 60). */
export const moldRouteTimeout = route => ['design-files', 'design-file'].includes(route) ? MOLD_DESIGN_TIMEOUT_MS : MOLD_TIMEOUT_MS;
/** The success body each route must carry; anything else is read as a failed call, to be tried again. */
function wellFormed(route, json) {
  if (!json || typeof json !== 'object') return false;
  if (route === 'status') return Array.isArray(json.requests) && Array.isArray(json.unknown);
  if (route === 'pending') return Array.isArray(json.requests);
  if (route === 'customers') return ['received', 'inserted', 'updated', 'deactivated', 'activeCustomers'].every(key => Number.isInteger(json[key]));
  // The salesmen route (2026-11-12): the five counts and deactivatedIds (lib/mold-salesmen-server.ts).
  if (route === 'salesmen') return !!moldSalesmenAnswer(json);
  // An attached file answers with the file as production lists it and the request (its approvals undone).
  if (route === 'design-files') return typeof json.created === 'boolean' && !!moldDesignFileEntry(json.file) && !!moldStatusObject(json.request);
  // An approval of a request registered in the products application answers without a crmRequestId.
  return !!moldStatusObject(json.request, {manual: route === 'approval'});
}

/** A downloaded file's bytes, read as they arrive and given up (the rest never read) once past `limit`: null then. A reply without a
 *  readable body (a test double) is read whole and checked after. */
async function readCapped(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) { const bytes = Buffer.from(await response.arrayBuffer()); return bytes.length > limit ? null : bytes; }
  const parts = []; let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) return Buffer.concat(parts, total);
    total += value.byteLength;
    if (total > limit) { void reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
}

/**
 * One signed call. Resolves (never throws) with {kind, code, fields, http, request?, json?, file?}: kind as readMoldAnswer says, plus
 * retry/network, retry/timeout and retry/bad_response for calls that did not get a contract answer. design-files takes its raw body
 * (moldDesignFileBody: the JSON line, a newline, the bytes), sent as application/octet-stream and signed exactly as sent; design-file
 * answers with the file itself: file = {bytes, contentType, name} (the type limited to a PDF, the four image types or plain bytes; the
 * name from Content-Disposition, made safe to show).
 * @typedef {{kind: 'ok'|'locked'|'not_found'|'rejected'|'retry', code: string, fields: string[], http: number, reason?: string, json?: any, request?: any, file?: {bytes: Buffer, contentType: string, name: string}}} MoldCallAnswer
 * @param {{ok: true, url: string, secret: string} | {ok: false, reason: string}} config
 * @param {'requests'|'status'|'cancel'|'approval'|'pending'|'customers'|'salesmen'|'design-files'|'design-file-delete'|'design-file'} route
 * @param {object | Uint8Array} payload
 * @param {{fetch?: typeof globalThis.fetch, now?: () => number, timeoutMs?: number}} [options]
 * @returns {Promise<MoldCallAnswer>}
 */
export async function callProducts(config, route, payload, {fetch: send = globalThis.fetch, now = Date.now, timeoutMs = moldRouteTimeout(route)} = {}) {
  if (!config?.ok) return {kind: 'retry', code: config?.reason || 'not_configured', fields: [], http: 0};
  if (!routes.has(route)) throw new Error('unknown route');
  const raw = route === 'design-files';
  if (raw !== (payload instanceof Uint8Array)) throw new Error(raw ? 'design-files takes its raw body' : 'a JSON route takes an object');
  const body = raw ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength) : Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length > (raw ? MOLD_DESIGN_MAX_BYTES + MOLD_DESIGN_LINE_LIMIT : route === 'customers' ? MOLD_CUSTOMERS_BODY_LIMIT : route === 'salesmen' ? MOLD_SALESMEN_BODY_LIMIT : MOLD_BODY_LIMIT)) return {kind: 'rejected', code: 'payload_too_large', fields: [], http: 0};
  const timestamp = String(Math.floor(now() / 1000));
  let response;
  try {
    response = await send(config.url + '?route=' + route, {
      method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: {'Content-Type': raw ? 'application/octet-stream' : 'application/json; charset=utf-8', Accept: route === 'design-file' ? '*/*' : 'application/json', 'X-YR-Timestamp': timestamp, 'X-YR-Signature': moldSignature(config.secret, timestamp, 'POST', route, body)},
    });
  } catch (error) {
    return {kind: 'retry', code: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network', fields: [], http: 0};
  }
  const header = name => { try { return response.headers?.get?.(name) ?? null; } catch { return null; } };
  if (route === 'design-file' && response.status === 200) {
    // The file itself: at most 25 MiB (a size declared above it is not read; one undeclared stops being read there), never a JSON
    // answer in its place.
    const declared = Number(header('content-length') ?? NaN), type = String(header('content-type') || '');
    if (declared > MOLD_DESIGN_MAX_BYTES || /^application\/json/i.test(type)) { try { await response.body?.cancel?.(); } catch { /* nothing left to read */ } return {kind: 'retry', code: 'bad_response', fields: [], http: 200}; }
    let bytes;
    try { bytes = await readCapped(response, MOLD_DESIGN_MAX_BYTES); } catch (error) { return {kind: 'retry', code: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network', fields: [], http: 200}; }
    if (!bytes) return {kind: 'retry', code: 'bad_response', fields: [], http: 200};
    return {kind: 'ok', code: '', fields: [], http: 200, file: {bytes, contentType: moldDesignContentType(type), name: moldDispositionName(header('content-disposition'))}};
  }
  let json = null;
  try {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length <= 4 * 1024 * 1024) json = JSON.parse(bytes.toString('utf8'));
  } catch { json = null; }
  const answer = readMoldAnswer(response.status, json, {manual: route === 'approval'});
  if (answer.kind === 'ok' && !wellFormed(route, json)) return {kind: 'retry', code: 'bad_response', fields: [], http: response.status};
  return {...answer, http: response.status, json: answer.kind === 'ok' ? json : undefined};
}
