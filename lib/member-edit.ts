import type {Member} from './crm';

/** Compare-and-swap snapshot, not an authorization credential. Include fields that
 * do not revoke sessions too: authVersion alone cannot detect a name/target edit. */
export function memberEditToken(member:Member):string{
 return JSON.stringify([member.id,member.email,member.name,member.role,member.branch,member.supervisorId||'',member.regionScope||'all',member.active,member.target,member.authVersion??0]);
}
