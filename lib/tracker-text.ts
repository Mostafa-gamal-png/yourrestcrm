/** Return only a short human message, never a bridge payload, stack, link or credential. */
export function cleanTrackerText(failure:unknown,fallback:string,max=240):string{
 const message=typeof failure==='string'?failure:failure&&typeof failure==='object'&&'message' in failure&&typeof failure.message==='string'?failure.message:fallback;
 return message.split(/\r?\n/,1)[0].replace(/https?:\/\/[^\s]+/gi,'[link]').replace(/\bBearer\s+[^\s,;]+/gi,'Bearer [redacted]').replace(/((?:token|password|secret|api[_-]?key|authorization|cookie|session(?:_id)?|otp)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1[redacted]').replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g,'[redacted]').trim().slice(0,max)||fallback;
}
