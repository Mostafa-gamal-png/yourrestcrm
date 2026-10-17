'use client';
import {AlertTriangle,CheckCircle2,MapPin} from 'lucide-react';
import type {VisitPlaceView} from '@/lib/visit-place';

/** Where the visit about to be saved stands against the customer's place; nothing for a call or before the device's point arrives. */
export default function VisitPlaceStatus({view}:{view:VisitPlaceView}){
 if(view.status==='idle')return null;
 const warning=view.status==='far'||view.status==='uncertain',confirmed=view.status==='near'||view.status==='journey';
 return <div className="visit-place full" data-state={view.status} data-blocked={view.blocked?'true':'false'} role={view.blocked?'alert':'status'}>{warning?<AlertTriangle size={16} aria-hidden="true"/>:confirmed?<CheckCircle2 size={16} aria-hidden="true"/>:<MapPin size={16} aria-hidden="true"/>}<span>{view.message}</span></div>;
}
