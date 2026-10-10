declare namespace Cloudflare {
 interface Env {
 DB:D1Database;FILES:R2Bucket;
 YR_AUTH_MODE?:string;YR_APP_ORIGIN?:string;YR_AUTH_SECRET?:string;
 YR_NATIONAL_ADDRESS_API_KEY?:string;
 YR_SEND_OTP?: (message:{to:string;code:string;expiresInMinutes:number;signal:AbortSignal})=>Promise<void>;
 YR_AUTH_CLIENT_KEY?: (headers:Headers)=>string|null;
 }
}
