import CRM from './crm-app';
import EmailSession from './email-session';
import {requireApplicationUser} from './application-auth';
export const dynamic='force-dynamic';
export default async function Page(){await requireApplicationUser('/');return <><EmailSession/><CRM/></>;}
