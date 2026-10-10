import {env} from 'cloudflare:workers';
import type {EmailAuthConfig} from './email-auth';

/** This distribution never trusts platform identity headers. */
export function authMode(){return 'email-otp' as const;}
export function authDatabase(){if(!env.DB)throw Error('Authentication database unavailable');return env.DB;}
export function emailAuthConfig():EmailAuthConfig{
 return {origin:env.YR_APP_ORIGIN||'',secret:env.YR_AUTH_SECRET||'',deliveryReady:!!env.YR_SEND_OTP,
 clientKey:request=>env.YR_AUTH_CLIENT_KEY?.(request.headers)??null,
 send:async message=>{if(!env.YR_SEND_OTP)throw Error('Email delivery is not configured');await env.YR_SEND_OTP(message);}};
}
