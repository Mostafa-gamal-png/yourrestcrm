import {redirect} from 'next/navigation';
import {getApplicationUser} from '../application-auth';
import {safeAuthReturn} from '@/lib/email-auth';
import EmailLogin from '../email-login';
export const dynamic='force-dynamic';
export default async function LoginPage(){
 const returnTo=safeAuthReturn();
 if(await getApplicationUser())redirect(returnTo);
 return <EmailLogin returnTo={returnTo}/>;
}
