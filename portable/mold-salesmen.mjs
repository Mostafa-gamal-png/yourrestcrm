// The products application's `salesmen` route (agreed with the products team on 2026-11-12, their PR #54): the CRM's members who may
// file a mold request, so a request registered in the products application names its representative from this list. Pure functions,
// no I/O and no secret: the server (lib/mold-salesmen-server.ts), the stand-in production API (scripts/lib/products-mock.mjs) and the
// tests share them. The body: {"mode": "full"|"upsert", "salesmen": [{"crmMemberId", "name", "email"?, "active"}]}, up to 256 KB and
// 1000 salesmen a call; `upsert` touches only those sent, `full` deactivates (never deletes) every salesman it does not carry.
// The limits and the answer's reader live in mold-rules.mjs, so mold-client.mjs needs no other file (the hosting tools copy those two).
import {MOLD_ID, MOLD_LIMITS, MOLD_SALESMEN_BODY_LIMIT, MOLD_SALESMEN_MAX, moldSalesmenAnswer} from './mold-rules.mjs';
export {MOLD_SALESMEN_BODY_LIMIT, MOLD_SALESMEN_MAX, moldSalesmenAnswer};
/** The contract's limits: a name of 160 characters, an email of 190 (the CRM keeps its own 160, MOLD_LIMITS.email). */
export const MOLD_SALESMAN_NAME_MAX = 160;
export const MOLD_SALESMAN_EMAIL_MAX = MOLD_LIMITS.email;

/** Control characters, and the invisible marks a paste from a right-to-left screen brings (direction marks and embeddings, zero-width
 *  characters, the soft hyphen, the byte-order mark). */
const INVISIBLE = /[\u0000-\u001F\u007F­؜​-‏‪-‮⁠⁦-⁩﻿]/g;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A member's name as the route carries it: as the CRM's users screen shows it, with the invisible marks taken out (a new line or a tab is
 * a space), runs of spaces (no-break spaces too) as one, the ends trimmed, cut to 160 characters as production counts them (code
 * points). '' when nothing is left.
 * @param {unknown} value
 */
export function moldSalesmanName(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\t\n\r\v\f]/g, ' ').replace(INVISIBLE, '').replace(/[   -   　]+/g, ' ').trim();
  return [...text].slice(0, MOLD_SALESMAN_NAME_MAX).join('').trim();
}

/**
 * A member's email as the route carries it: the invisible marks and the spaces at the ends taken out, lower-case; '' (left out of the
 * entry) when it is not an address or is over 160 characters. Never cut: a cut address would be another one.
 * @param {unknown} value
 */
export function moldSalesmanEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.replace(INVISIBLE, '').trim().toLowerCase();
  return email && [...email].length <= MOLD_SALESMAN_EMAIL_MAX && EMAIL.test(email) ? email : '';
}

/**
 * One salesman of the route from a CRM member: {crmMemberId, name, email?, active}. null when it cannot be sent (an id outside
 * ^[A-Za-z0-9_-]{1,64}$, or no name left after cleaning).
 * @param {{id: unknown, name: unknown, email?: unknown, active?: boolean}} member
 * @returns {{crmMemberId: string, name: string, email?: string, active: boolean} | null}
 */
export function moldSalesmanEntry({id, name, email, active = true}) {
  if (typeof id !== 'string' || !MOLD_ID.test(id)) return null;
  const clean = moldSalesmanName(name);
  if (!clean) return null;
  /** @type {{crmMemberId: string, name: string, email?: string, active: boolean}} */
  const entry = {crmMemberId: id, name: clean};
  const address = moldSalesmanEmail(email);
  if (address) entry.email = address;
  entry.active = active !== false;
  return entry;
}

const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
/** Whether one call can carry these salesmen whole (1000 at most, 256 KB at most). */
export const moldSalesmenFit = (mode, salesmen) => salesmen.length <= MOLD_SALESMEN_MAX && jsonBytes({mode, salesmen}) <= MOLD_SALESMEN_BODY_LIMIT;

/**
 * The calls that carry these salesmen. `full`: one call when the list fits (overLimit false); a list over 1000 salesmen or 256 KB cannot
 * go as one full (the contract) and is never cut (a cut full would deactivate whoever was cut), so it goes as `upsert` batches, each
 * within the limits, with overLimit true: nobody is deactivated that time. `upsert`: batches within the limits.
 * @template T
 * @param {'full'|'upsert'} mode
 * @param {T[]} salesmen
 * @returns {{calls: {mode: 'full'|'upsert', salesmen: T[]}[], overLimit: boolean}}
 */
export function moldSalesmenCalls(mode, salesmen) {
  if (mode === 'full' && moldSalesmenFit('full', salesmen)) return {calls: [{mode: 'full', salesmen}], overLimit: false};
  /** @type {{mode: 'full'|'upsert', salesmen: T[]}[]} */
  const calls = [];
  let batch = [], size = 40;
  for (const entry of salesmen) {
    const one = jsonBytes(entry) + 1;
    if (batch.length && (batch.length >= MOLD_SALESMEN_MAX || size + one > MOLD_SALESMEN_BODY_LIMIT - 512)) { calls.push({mode: 'upsert', salesmen: batch}); batch = []; size = 40; }
    batch.push(entry); size += one;
  }
  if (batch.length) calls.push({mode: 'upsert', salesmen: batch});
  return {calls, overLimit: mode === 'full'};
}

/**
 * Whether a refusal is the products application before its release of the route: 400 invalid_payload with fields exactly ["route"] (its
 * answer to a route it does not know). Not an error: the CRM waits and tries again later.
 * @param {{kind: string, code: string, fields?: string[], http?: number}} answer
 */
export const moldSalesmenRouteMissing = answer => answer.kind === 'rejected' && answer.code === 'invalid_payload' && Array.isArray(answer.fields) && answer.fields.length === 1 && answer.fields[0] === 'route';
