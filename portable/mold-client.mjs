// Calls the production application's mold requests API (contract version 1, §1): the address and the shared secret come from the
// private settings (YR_PRODUCTS_API_URL, YR_PRODUCTS_SECRET), every call is a signed HTTPS POST with a 10-second limit, and the bytes
// sent are the bytes signed. The secret is never returned, logged or put in an error. Used by the server and the import tool.
import {createHash, createHmac} from 'node:crypto';
import {MOLD_BODY_LIMIT, MOLD_TIMEOUT_MS, moldStatusObject, readMoldAnswer} from './mold-rules.mjs';

/** X-YR-Signature: lower-case hex HMAC-SHA256 of "<timestamp>\n<METHOD>\n<route>\n<sha256-hex(body as sent)>" with the secret. */
export function moldSignature(secret, timestamp, method, route, body) {
  const digest = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret).update(timestamp + '\n' + method + '\n' + route + '\n' + digest).digest('hex');
}

/**
 * The connection settings, or why there are none. reason: not_configured (a value is missing), invalid_url (not an exact HTTPS address
 * without credentials, query or fragment), short_secret (fewer than 32 characters). Nothing secret is in the answer.
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

const routes = new Set(['requests', 'status', 'cancel']);
/** The success body each route must carry; anything else is read as a failed call, to be tried again. */
function wellFormed(route, json) {
  if (!json || typeof json !== 'object') return false;
  if (route === 'status') return Array.isArray(json.requests) && Array.isArray(json.unknown);
  return !!moldStatusObject(json.request);
}

/**
 * One signed call. Resolves (never throws) with {kind, code, fields, http, request?, json?}: kind as readMoldAnswer says, plus
 * retry/network, retry/timeout and retry/bad_response for calls that did not get a contract answer.
 */
export async function callProducts(config, route, payload, {fetch: send = globalThis.fetch, now = Date.now, timeoutMs = MOLD_TIMEOUT_MS} = {}) {
  if (!config?.ok) return {kind: 'retry', code: config?.reason || 'not_configured', fields: [], http: 0};
  if (!routes.has(route)) throw new Error('unknown route');
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length > MOLD_BODY_LIMIT) return {kind: 'rejected', code: 'payload_too_large', fields: [], http: 0};
  const timestamp = String(Math.floor(now() / 1000));
  let response;
  try {
    response = await send(config.url + '?route=' + route, {
      method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: {'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json', 'X-YR-Timestamp': timestamp, 'X-YR-Signature': moldSignature(config.secret, timestamp, 'POST', route, body)},
    });
  } catch (error) {
    return {kind: 'retry', code: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network', fields: [], http: 0};
  }
  let json = null;
  try {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length <= 4 * 1024 * 1024) json = JSON.parse(bytes.toString('utf8'));
  } catch { json = null; }
  const answer = readMoldAnswer(response.status, json);
  if (answer.kind === 'ok' && !wellFormed(route, json)) return {kind: 'retry', code: 'bad_response', fields: [], http: response.status};
  return {...answer, http: response.status, json: answer.kind === 'ok' ? json : undefined};
}
