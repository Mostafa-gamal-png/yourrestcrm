'use client';

// «كود العميل في ERP» in the customer forms, read-only for everyone, the administrator too (the owner, 2026-11-12: «الغى امكانية تعديل كود
// erp لاى حد حتى مدير النظام»): «كود ERP: 103» or «لا يوجد كود ERP», with the note that the ERP customers file is what updates it
// («استيراد من ERP», lib/erp-customers-server.ts). The server refuses any other change (app/api/crm/route.ts, ERP_CODE_LOCKED).
import React from 'react';
import { Lock } from 'lucide-react';
import './erp-code-readonly.css';

type Say = (ar: string, en: string) => string;
export default function ErpCodeReadOnly({ code, say, className }: { code: unknown; say: Say; className?: string }) {
  const value = typeof code === 'string' ? code.trim() : typeof code === 'number' ? String(code) : '';
  return <div className={'field erp-code-readonly' + (className ? ' ' + className : '')} data-erp-code={value}>
    <span>{say('كود العميل في ERP', 'Customer ERP code')}</span>
    <p className="erp-code-readonly-value"><span>{value
      ? <>{say('كود ERP', 'ERP code')}: <bdi dir="ltr">{value}</bdi></>
      : say('لا يوجد كود ERP', 'No ERP code')}</span></p>
    <small className="erp-code-readonly-note"><Lock size={13} aria-hidden="true"/>{say('يُحدَّث من ملف عملاء ERP فقط', 'Updated from the ERP customers file only')}</small>
  </div>;
}
