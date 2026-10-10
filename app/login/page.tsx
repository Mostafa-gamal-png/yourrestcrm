import {redirect} from 'next/navigation';
import {getApplicationUser} from '../application-auth';
import {safeAuthReturn} from '@/lib/email-auth';
import EmailLogin from '../email-login';
export const dynamic='force-dynamic';
export default async function LoginPage({searchParams}:{searchParams:Promise<{return_to?:string}>}){
 const returnTo=safeAuthReturn((await searchParams).return_to);
 if(await getApplicationUser())redirect(returnTo);
 return <EmailLogin returnTo={returnTo}/>;
}
