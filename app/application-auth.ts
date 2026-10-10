import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {authDatabase,emailAuthConfig} from '@/lib/auth-environment';
import {emailSession,safeAuthReturn} from '@/lib/email-auth';

export async function getApplicationUser(){
 // Identity is resolved solely from a validated session and current membership.
 // Incoming oai-authenticated-* headers are never used in this distribution.
 return emailSession(new Headers(await headers()),authDatabase(),emailAuthConfig());
}
export async function requireApplicationUser(){
 const user=await getApplicationUser();if(user)return user;
 redirect('/login?return_to='+encodeURIComponent(safeAuthReturn()));
}
