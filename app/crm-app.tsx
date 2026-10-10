'use client';
import {lineCents} from '@/lib/decimal-money';
import {submitJson,SubmitError} from '@/lib/client-submit';
import {saveOfflineSnapshot,loadOfflineSnapshot,augmentOfflineSnapshot,subscribeOffline,lockOfflineSession,offlineSessionGeneration,offlineOwner,type OfflineSnapshot} from '@/lib/offline-store';
import {offlineSubmit,flushOutbox} from '@/lib/offline-submit';
import {isOfflineLogoutPending,finishPendingOfflineLogout} from '@/lib/offline-auth';
import OfflineStatus from './offline-status';
import {t,useLanguage,direction,getLanguage,setLanguage} from "@/lib/i18n";
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { MapPinned, ExternalLink, LayoutDashboard, Factory, Users, Shapes, ClipboardList, FileText, ShieldCheck, Plus, Search, ChevronLeft, Phone, MapPin, CalendarDays, Clock, RefreshCw, Download, Printer, Pencil, Trash2, CheckCircle2, ArrowUpRight, Target, BriefcaseBusiness, Loader2, LogOut, Layers, Building2, X, Menu, SlidersHorizontal, WifiOff } from 'lucide-react';
import { SidebarProvider, Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty as EmptySurface, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Toaster, toast } from 'sonner';
import ServiceWorkflow from './customer-service';
import {EmailLogout} from './email-login';
import {canViewPage,canUseSalesWorkspace,resolveCRMPage} from '@/lib/access';
import InstallApp from './install-app';
import AppUpdate from './app-update';
import MobileNavigation from './mobile-navigation';
import JourneyReport from './journey-report';
import {JourneyTrackerProvider,JourneyTrackingBanner} from './journey-tracker';
import {isServiceRole} from '@/lib/customer-service';
import { schemas, stages, stageLabels, roles, today, money, isOpen, isSalesRequest, followupTitle, quoteTotals, type Row, type Kind, type Member } from '@/lib/crm';
import {regionScope,regionLabel,regionValue} from '@/lib/regions';
import {MemberRegionField,CustomerRegionField} from './region-picker';
import CustomerLocationFields,{CustomerClassificationFields} from './customer-entry-fields';
import LanguageSwitch from './language-switch';
import ThemeToggle from './theme-toggle';
import {filterVisitRows} from '@/lib/visit-list';
import CustomerMap from './customer-journey-map';
import {normalizeMapSearch,searchMapCustomers} from '@/lib/customer-map-search';
import './map-workspace.css';
import './rep-mobile-shell.css';
import CustomerMachines from './customer-machines';
import CustomerIdentities from './customer-identities';
import SalesWorkspace from './sales-workspace';
import MyTargets from './my-targets';
import CompetitorsWorkspace from './competitors-workspace';
import VisitFields from './visit-fields';
import { VisitsPage, CustomerVisitDialog, CustomerVisitHistory } from './customer-visits';
import { visitCustomer, visitRequest, customerVisitDue, strengthLabels } from '@/lib/customer-visits';
import VisitsTable from './visits-table';
import {CustomerFollowupsPage,CustomerFollowupDialog} from './customer-followups';
import {isCustomerFollowup,latestCustomerContact,canExecuteCustomerFollowup} from '@/lib/customer-followups';
import { contactTypes, visitPurposes, visitResults, visitOutcomes, visitResult, formatVisitTime, durationLabel, durationNeedsReview, riyadhDate } from '@/lib/visits';
import { machineTypeLabels, completeMachineSpecs } from '@/lib/machines';
import { customerCoordinates, mapsLink } from '@/lib/customer-location';
import { normalizeMemberEmail } from '@/lib/member-email';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
const nav = [['dashboard', 'لوحة المتابعة', LayoutDashboard], ['customer', 'العملاء', Factory], ['map', 'خريطة المصانع', MapPinned], ['activity', 'الزيارات', ClipboardList], ['followup', 'المتابعات', CalendarDays], ['journeys', 'تقرير يوم المندوب', MapPinned], ['quote', 'عروض الأسعار', FileText], ['sales', 'المبيعات', BriefcaseBusiness], ['competitors', 'المنافسين', Users], ['targets', 'المستهدفات وتقييم الأداء', Target], ['team', 'الفريق والصلاحيات', ShieldCheck]] as const;
const kindNames: Record<string, string> = { customer: 'مصنع', factory: 'ماكينة / خط إنتاج', opportunity: 'طلب قالب', activity: 'زيارة', quote: 'عرض سعر', team: 'مستخدم' };
const activityTypes = contactTypes;
const outcomes = visitOutcomes;
const quoteStatus: Record<string, string> = { draft: 'مسودة', sent: 'مرسل', accepted: 'مقبول', rejected: 'مرفوض' };
function Pick({ value, onChange, options, placeholder = 'اختر', disabled = false, label }: {
    value: string;
    onChange: (s: string) => void;
    options: [
        string,
        string
    ][];
    placeholder?: string;
    disabled?: boolean;
    label?: string;
}) { useLanguage(); return <Select dir={direction()} value={value || undefined} onValueChange={onChange} disabled={disabled}><SelectTrigger className="pick" aria-label={t(label) || t(placeholder)}><SelectValue placeholder={t(placeholder)}/></SelectTrigger><SelectContent>{t(options.filter(x => x[0]).map(([v, l]) => <SelectItem key={v} value={v}>{t(l)}</SelectItem>))}</SelectContent></Select>; }
function Empty({ title, text, action, label = 'إضافة', Icon = Layers }: {
    title: string;
    text?: string;
    action?: () => void;
    label?: string;
    Icon?: any;
}) { useLanguage(); return <EmptySurface className="empty"><EmptyHeader><EmptyMedia className="empty-icon"><Icon size={27}/></EmptyMedia><EmptyTitle>{t(title)}</EmptyTitle>{text && <EmptyDescription>{t(text)}</EmptyDescription>}</EmptyHeader>{action && <button className="btn primary" onClick={action}><Plus size={17}/>{t(label)}</button>}</EmptySurface>; }
function Badge({ stage }: {
    stage: string;
}) { useLanguage(); return <span className={'badge ' + stage}>{t(stageLabels[stage]) || t(quoteStatus[stage]) || t(outcomes[stage]) || t(stage)}</span>; }
function NavMenu({ view, go, role }: {
    view: string;
    go: (s: string) => void;
    role?:string;
}) { useLanguage(); const { setOpenMobile } = useSidebar(); return <SidebarMenu>{t(nav.filter(n=>!!role&&canViewPage(role,n[0])).map(([id, label, Icon]) => <SidebarMenuItem key={id}><SidebarMenuButton className="nav-item" isActive={view === id} onClick={() => { go(id); setOpenMobile(false); }}><Icon size={20}/><span>{id==='targets'&&role==='rep'?(getLanguage()==='ar'?'مستهدفي':'My targets'):id==='journeys'&&getLanguage()==='en'?'Daily route':t(label)}</span>{view === id && <span className="nav-active"/>}</SidebarMenuButton></SidebarMenuItem>))}</SidebarMenu>; }
async function request(body?: any) { try{return await submitJson<any>('/api/crm',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'},{language:getLanguage()});}catch(error){if(error instanceof SubmitError)throw Object.assign(error,error.body||{},{status:error.status});throw error;} }
function downloadCsv(name: string, headers: string[], rows: any[][]) { const esc = (x: any) => { let s = String(x ?? ''); if (/^[=+\-@\t\r]/.test(s))
    s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }; const a = document.createElement('a'); const url = URL.createObjectURL(new Blob(['\ufeff' + [headers.map(t), ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' })); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function normalizeSearch(value:string){return value.normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).toLowerCase().trim();}
export default function CRM() {
    const {language}=useLanguage();const say=(ar:string,en:string)=>language==='ar'?ar:en;
    const [view, setView] = useState('dashboard'), [records, setRecords] = useState<Row[]>([]), [members, setMembers] = useState<Member[]>([]), [me, setMe] = useState<Member | null>(null), [audits, setAudits] = useState<any[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [auth, setAuth] = useState(false), [busy, setBusy] = useState(false);
    const [q, setQ] = useState(''), [staffFilter, setStaffFilter] = useState('all'), [stageFilter, setStageFilter] = useState('all'), [board, setBoard] = useState('board'), [month, setMonth] = useState(today().slice(0, 7)), [regionFilter, setRegionFilter] = useState('all'), [pageIndex, setPageIndex] = useState(1), [mapFocusId, setMapFocusId] = useState<string | null>(null);
    const [form, setForm] = useState<{
        kind: string;
        row?: Row;
        data: any;
        parentId: string;
        createKey?: string;
        memberSnapshot?: string;
        memberConflict?: boolean;
    } | null>(null), [formError, setFormError] = useState(''), [detailId, setRawDetailId] = useState<string | null>(null), [detailTab, setDetailTab] = useState('info'), [deleting, setDeleting] = useState<Row | null>(null), [printQuote, setPrintQuote] = useState<Row | null>(null);
    const [compactNavigation,setCompactNavigation]=useState(false),[mobileAccountOpen,setMobileAccountOpen]=useState(false);
    const [filtersOpen,setFiltersOpen]=useState(false),[offline,setOffline]=useState(false),[formDirty,setFormDirty]=useState(false),[discardForm,setDiscardForm]=useState(false);
    const [customerLocationPending,setCustomerLocationPending]=useState(false);
    // React state updates are asynchronous: lock before the first await so a
    // second submit from the same rendered form cannot issue another write.
    const masterSaveLock=useRef(false);
    const [customerIdentitiesOpen,setCustomerIdentitiesOpen]=useState(false);
    const canManageCustomerIdentities=me?.role==='admin'&&regionScope(me)==='all';
    const customerIdentitiesVisible=customerIdentitiesOpen&&canManageCustomerIdentities;
    useEffect(()=>{if(!canManageCustomerIdentities)setCustomerIdentitiesOpen(false);},[canManageCustomerIdentities]);
    const [offlineStorageError,setOfflineStorageError]=useState('');
    const snapshotRef=useRef<OfflineSnapshot|null>(null),loadGeneration=useRef(0),snapshotGeneration=useRef(0);
    const [serviceDetailId,setServiceDetailId]=useState(''),[serviceFilter,setServiceFilter]=useState('all');
    const [followupEditor,setFollowupEditor]=useState<{initial?:Row;customerId?:string;key:string}|null>(null);
    const [visitEditor, setVisitEditor] = useState<{
        initial?: Row;
        competitorName?: string;
        showCompetitor?: boolean;
        customerId?: string;
        requestId?: string;
        machineId?: string;
        editorKey: string;
    } | null>(null);
    const go = useCallback((v: string) => { v=resolveCRMPage(me?.role||'',v);setView(v); setFiltersOpen(false); setServiceFilter('all'); setQ(''); setStageFilter('all'); setRegionFilter('all'); setPageIndex(1); window.history.replaceState(null, '', '#' + v); }, [me?.role]);
    const applySnapshot=useCallback((d:OfflineSnapshot)=>{
        if(isOfflineLogoutPending())return;
        const previous=snapshotRef.current?.me;
        if(previous&&offlineOwner(previous).stamp!==offlineOwner(d.me).stamp){
            setVisitEditor(null);setFollowupEditor(null);setForm(null);setRawDetailId(null);setMobileAccountOpen(false);setCustomerIdentitiesOpen(false);setDeleting(null);setPrintQuote(null);setServiceDetailId('');setDiscardForm(false);setFormDirty(false);
        }
        snapshotRef.current=d;setRecords(d.records);setMembers(d.members);setMe(d.me);setAudits(d.audits);
        setView(current=>resolveCRMPage(d.me.role,current));setAuth(false);setError('');
    },[]);
    const clearSession=useCallback(()=>{
        ++snapshotGeneration.current;
        snapshotRef.current=null;setRecords([]);setMembers([]);setMe(null);setAudits([]);setVisitEditor(null);setFollowupEditor(null);setForm(null);setRawDetailId(null);setDeleting(null);setPrintQuote(null);setServiceDetailId('');setDiscardForm(false);setFormDirty(false);setMobileAccountOpen(false);setCustomerIdentitiesOpen(false);setAuth(true);
    },[]);
    const refreshLocal=useCallback(async()=>{
        const generation=++snapshotGeneration.current;
        if(isOfflineLogoutPending()){clearSession();setError(getLanguage()==='ar'?'سجّل الدخول لفتح بياناتك.':'Sign in to open your data.');return null;}
        const cached=await loadOfflineSnapshot();
        if(cached){const d=await augmentOfflineSnapshot(cached);if(generation!==snapshotGeneration.current||isOfflineLogoutPending())return null;applySnapshot(d);return d;}
        return null;
    },[applySnapshot,clearSession]);
    const load = useCallback(async () => {
        const generation=++loadGeneration.current,sessionGeneration=offlineSessionGeneration();setError('');
        try{
            if(isOfflineLogoutPending()){await finishPendingOfflineLogout().catch(()=>{});clearSession();setError(getLanguage()==='ar'?'سجّل الدخول لفتح بياناتك.':'Sign in to open your data.');return;}
            if(navigator.onLine===false){const cached=await refreshLocal();if(!cached)throw new Error(getLanguage()==='ar'?'افتح التطبيق وسجّل الدخول مرة بالإنترنت أولًا لتجهيز بياناتك للعمل بدون شبكة.':'Open the app and sign in online once to prepare offline data.');return;}
            const d=await request();
            if(generation!==loadGeneration.current||sessionGeneration!==offlineSessionGeneration()||isOfflineLogoutPending())return;
            try{await saveOfflineSnapshot(d,sessionGeneration);setOfflineStorageError('');}catch{setOfflineStorageError(getLanguage()==='ar'?'تعذر تجهيز الحفظ على الجهاز. تحقق من مساحة التخزين قبل العمل بدون شبكة.':'Device storage is unavailable. Check storage before working offline.');}
            if(generation!==loadGeneration.current||sessionGeneration!==offlineSessionGeneration()||isOfflineLogoutPending())return;
            const augmented=await augmentOfflineSnapshot(d);if(generation!==loadGeneration.current||sessionGeneration!==offlineSessionGeneration()||isOfflineLogoutPending())return;applySnapshot(augmented);
        }catch(e:any){
            if(generation!==loadGeneration.current)return;
            if(e.status===401||e.status===403){await lockOfflineSession();clearSession();setError(e.message);return;}
            const cached=await refreshLocal().catch(()=>null);
            if(!cached){setError(e.message);setAuth(e.status===401);}
        }finally{if(generation===loadGeneration.current)setLoading(false);}
    },[applySnapshot,clearSession,refreshLocal]);
    useEffect(()=>subscribeOffline(()=>{const generation=++snapshotGeneration.current;void (async()=>{
        const cached=await loadOfflineSnapshot().catch(()=>null);
        if(generation!==snapshotGeneration.current)return;
        if(isOfflineLogoutPending()||!cached&&snapshotRef.current){++loadGeneration.current;clearSession();setError(getLanguage()==='ar'?'سجّل الدخول مجددًا؛ الإدخالات المنتظرة محفوظة على الجهاز.':'Sign in again; pending entries remain on this device.');return;}
        if(cached){const d=await augmentOfflineSnapshot(cached);if(generation!==snapshotGeneration.current||isOfflineLogoutPending())return;applySnapshot(d);setLoading(false);}
    })().catch(()=>{});}),[applySnapshot,clearSession]);
    useEffect(()=>{
        if(!me)return;let disposed=false;
        const sync=()=>{if(!disposed&&navigator.onLine!==false&&!isOfflineLogoutPending())void flushOutbox(me).catch(()=>{});};
        const resume=()=>{if(!disposed&&navigator.onLine!==false)void load().then(sync).catch(()=>{});};
        const visible=()=>{if(document.visibilityState==='visible')resume();};
        sync();window.addEventListener('online',resume);window.addEventListener('focus',resume);document.addEventListener('visibilitychange',visible);
        const timer=window.setInterval(sync,30000);
        return()=>{disposed=true;window.clearInterval(timer);window.removeEventListener('online',resume);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',visible);};
    },[me?.id,me?.authVersion,me?.role,me?.regionScope,load]);
    const createdCustomer=useCallback(async(id:string)=>{
        let d=await refreshLocal();let customer=d?.records.find(r=>r.id===id&&r.kind==='customer');
        if(!customer){await load();d=snapshotRef.current;customer=d?.records.find(r=>r.id===id&&r.kind==='customer');}
        if(!customer)throw new Error(getLanguage()==='ar'?'تعذر تحميل العميل المحفوظ.':'Could not load the saved customer.');
        return customer;
    },[refreshLocal,load]);
    useEffect(()=>{const query=window.matchMedia('(max-width: 1023px)');const update=()=>{setCompactNavigation(query.matches);if(!query.matches)setMobileAccountOpen(false);};update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
    useEffect(()=>{const update=()=>setOffline(navigator.onLine===false);update();window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
    useEffect(() => { const after = () => setPrintQuote(null); window.addEventListener('afterprint', after); return () => window.removeEventListener('afterprint', after); }, []);
    useEffect(() => { load(); const hash = window.location.hash.slice(1); const v = hash === 'factory' ? 'customer' : (hash === 'opportunity'||hash === 'service') ? 'activity' : hash; if (v==='reports'||nav.some(n => n[0] === v))
        setView(v); }, [load]);
    useEffect(() => { const context = (document as any).modelContext; if (!context?.registerTool)
        return; const lifecycle = new AbortController(); for (const tool of [{ name: 'read_crm_summary', title: 'قراءة ملخص يورست', description: 'Read the currently authorized CRM totals without modifying data.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async (input: any) => { if (!input || Object.keys(input).length)
                throw new Error('No parameters accepted'); const d = await request(); const opp = d.records.filter((r: Row) => isSalesRequest(r)); const threads = customerVisitDue(d.records); return { customers: d.records.filter((r: Row) => r.kind === 'customer').length, openOpportunities: opp.filter(isOpen).length, openFollowups: threads.length, overdue: threads.filter((r: Row) => !!r.data.nextDate && r.data.nextDate && r.data.nextDate < today()).length }; } }, { name: 'navigate_crm', title: 'فتح قسم في يورست', description: 'Navigate to a CRM section. Does not create or modify any record.', inputSchema: { type: 'object', properties: { section: { type: 'string', enum: nav.filter(n=>!!me&&canViewPage(me.role,n[0])).map(n => n[0]) } }, required: ['section'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async (input: any) => { if (!input || Object.keys(input).some(k => k !== 'section') || !me||!nav.some(n => n[0] === input.section&&canViewPage(me.role,n[0])))
                throw new Error('Invalid section'); go(input.section); await new Promise(r => requestAnimationFrame(r)); return { section: input.section }; } }]) {
        try {
            Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => { });
        }
        catch { }
    } return () => lifecycle.abort(); }, [go,me?.role]);
    useEffect(()=>{if(!me)return;const next=resolveCRMPage(me.role,view);if(next!==view)go(view);else if(window.location.hash==='#reports')window.history.replaceState(null,'','#'+next);},[me,view,go]);
    const all = (kind: string) => records.filter(r => r.kind === kind);
    const row = (id: string | null | undefined) => records.find(r => r.id === id);
    const member = (id: string) => members.find(m => m.id === id)?.name || '—';
    const title = (r: Row | undefined): string => !r ? '—' : r.kind === 'opportunity' ? followupTitle(r) : r.kind === 'activity' ? r.data.summary : r.kind === 'quote' ? r.data.number : r.data.name;
    const customerFor = (r: Row | undefined): Row | undefined => { let cur = r; for (let i = 0; i < 5; i++) {
        if (!cur || cur.kind === 'customer')
            return cur;
        cur = row(cur.parentId);
    } return undefined; };
    const machineFor = (r: Row | undefined): Row | undefined => { let cur = r; for (let i = 0; i < 4; i++) {
        if (!cur || cur.kind === 'factory')
            return cur;
        cur = row(cur.parentId);
    } return undefined; };
    const manage = !!me && ['admin', 'manager'].includes(me.role);
    const salesWorkspace=!!me&&canUseSalesWorkspace(me.role),permittedView=!!me&&canViewPage(me.role,view);
    const regionalDirectory=me?.role==='rep'&&['customer','map'].includes(view);
    const effectiveStaffFilter=me?.role==='rep'?'all':staffFilter;
    const canSearch=me?.role!=='rep'||view==='customer';
    const searchQuery=canSearch?q:'';
    const canEditRecord=(record:Row)=>!record.data._offlineState&&!record.data._offlineAcknowledged&&!!me&&!record.data._readOnly&&!record.data._masterReadOnly&&(me.role==='rep'?record.kind==='customer':record.kind==='activity'||salesWorkspace);
    const canManageRecordRouting=(record:Row)=>canEditRecord(record)&&!record.data._masterRoutingReadOnly;
    const canDeleteRecord=(record:Row)=>!record.data._offlineState&&!record.data._offlineAcknowledged&&record.data.visitWorkflow!=='service-intake-v1'&&(me?.role==='admin'||me?.role!=='rep'&&canManageRecordRouting(record));
    const salesRecords=records.filter(r=>(!r.data._readOnly||r.data._offlineState||r.data._offlineAcknowledged)&&r.data.visitWorkflow!=='service-intake-v1');
    const customerSearchIds=view==='customer'&&normalizeMapSearch(searchQuery)
        ? new Set(searchMapCustomers(salesRecords,searchQuery,salesRecords.length).map(r=>r.id)) : null;
    const filtered = (view==='activity'?records:salesRecords).filter(r => (effectiveStaffFilter === 'all' || (r.kind === 'activity' ? (r.data.performedBy || r.data.responsibleId) : r.kind === 'opportunity' ? (r.data.responsibleId || r.assignedTo) : r.assignedTo) === effectiveStaffFilter) && (!['customer', 'map'].includes(view) || regionFilter === 'all' || (customerFor(r)?.data.region || 'unknown') === regionFilter) && (view==='map' || !searchQuery || (view==='customer'&&r.kind==='customer' ? !customerSearchIds||customerSearchIds.has(r.id) : normalizeSearch([title(r), customerFor(r)?.data.name, r.data.city, r.data.code, r.data.machineModel, r.data.phone, r.data.phone2, r.data.contact, r.data.contact2, r.data.product, r.data.region, r.data.address, r.data.machineTypes, r.data.visitNumber, r.data.result, r.data.recordedByEmail, ...(r.kind === 'customer' ? records.filter(x => x.kind === 'factory' && x.parentId === r.id).flatMap(x => [x.data.name, x.data.machineBrand, x.data.machineModel, x.data.machineSerial]) : [])].join(' ')).includes(normalizeSearch(searchQuery)))));
    const opps = filtered.filter(isSalesRequest);
    const open = opps.filter(isOpen);
    const due = customerVisitDue(salesRecords).filter(r => filtered.some(f => f.id === r.id) && (!r.data.nextDate || !r.data.nextAction || r.data.nextDate <= today())).sort((a, b) => (a.data.nextDate||'').localeCompare(b.data.nextDate||''));
    const won = opps.filter(r => r.data.stage === 'won');
    const list = filtered.filter(r => r.kind === view && (view !== 'activity' || stageFilter === 'all' || r.data.salesStage === stageFilter));
    const customers = filtered.filter(r => r.kind === 'customer');
    const regions = Array.from(new Set(all('customer').map(r => r.data.region || 'unknown'))).sort();
    const codeCounts = useMemo(() => { const m = new Map<string, number>(); for (const r of records)
        if (r.kind === 'customer' && r.data.code)
            m.set(r.data.code, (m.get(r.data.code) || 0) + 1); return m; }, [records]);
    useEffect(() => setPageIndex(1), [q, effectiveStaffFilter, stageFilter, regionFilter, view]);
    const detail = row(detailId);
    const currentTitle = view==='competitors'?say('المنافسين','Competitors'):view==='targets'&&me?.role==='rep'?(getLanguage()==='ar'?'مستهدفي':'My targets'):view==='journeys'&&getLanguage()==='en'?'Daily route':nav.find(n => n[0] === view)?.[1] || '';
    function openFollowup(customerId?:string,initial?:Row,sourceId?:string){if(initial?.data._offlineState){toast.info(say('المتابعة محفوظة على الجهاز. راجع حالة المزامنة.','This follow-up is saved on the device. Check sync status.'));return;}if(!initial){const source=latestCustomerContact(customerId||'',salesRecords);if(source?.data._offlineState||source?.data._offlineAcknowledged){toast.info(say('انتظر تأكيد رفع الزيارة السابقة قبل تنفيذ متابعتها.','Wait for the previous visit to sync before recording its follow-up.'));return;}if(!source||sourceId&&source.id!==sourceId||!canExecuteCustomerFollowup(source)){toast.error(t('افتح الزيارة السابقة وحدد الإجراء القادم وموعد المتابعة أولًا.'));return;}}setRawDetailId(null);setForm(null);setVisitEditor(null);setFollowupEditor({customerId,initial,key:crypto.randomUUID()});}
    function openVisit(initial?: Row, customerId?: string, requestId?: string, machineId?: string) { if(initial?.data._offlineState){toast.info(say('الزيارة محفوظة على الجهاز. راجع حالة المزامنة.','This visit is saved on the device. Check sync status.'));return;} if(isCustomerFollowup(initial)){openFollowup(undefined,initial);return;}setFollowupEditor(null); setRawDetailId(null); setForm(null); setVisitEditor({ initial, customerId, requestId, machineId, editorKey: crypto.randomUUID() }); }
    function openCompetitorVisit(competitorName?:string,customerId?:string) { setFollowupEditor(null); setRawDetailId(null); setForm(null); setVisitEditor({customerId,competitorName,showCompetitor:true,editorKey:crypto.randomUUID()}); }
    function setDetailId(id: string | null) { setFollowupEditor(null);const r = row(id);if(r?.kind==='quote'&&!salesWorkspace)return; if (r?.kind === 'activity')
        openVisit(r);
    else if (r?.kind === 'opportunity')
        openVisit(undefined, visitCustomer(r, records)?.id, isSalesRequest(r) ? r.id : undefined);
    else {
        setVisitEditor(null);
        setDetailTab('info');
        setRawDetailId(id);
    } }
    function start(kind: string, r?: Row, parent?: string, specifications = false) {
        setFormDirty(false); setDiscardForm(false); setCustomerLocationPending(false);
        const repCustomerCreate=me?.role==='rep'&&kind==='customer'&&!parent;
        if(!me||(r&&!canEditRecord(r))||(kind==='team'&&!canViewPage(me.role,'team'))||(!['activity','followup','opportunity'].includes(kind)&&!salesWorkspace&&!repCustomerCreate)||(kind==='opportunity'&&specifications&&!salesWorkspace))return;
        if(kind==='factory'&&!r&&parent&&row(parent)?.data._masterRoutingReadOnly)return;
        if(kind==='followup'){openFollowup(parent,r);return;}setFollowupEditor(null);
        if (kind === 'opportunity'&&!specifications || kind === 'activity') {
            const target = r || row(parent), request = target?.kind === 'opportunity' && isSalesRequest(target) ? target : visitRequest(target, records);
            openVisit(kind === 'activity' && r?.kind === 'activity' ? r : undefined, visitCustomer(target, records)?.id, request?.id, target?.kind === 'factory' ? target.id : undefined);
            return;
        }
        setFormError('');
        let data: any = r ? {...structuredClone(r.data),...(kind==='customer'?{assignedTo:r.assignedTo,branch:r.branch}:{})} : { notes: '' };
        let parentId = r?.parentId || parent || '';
        if (!r) {
            if (kind === 'customer')
                data = { ...data, name: '', code: '', region: me?regionValue(me):'', customerType: '', customerStatus: '', category: '', location: '', shortAddress: '', address: '', city: '', contact: '', phone: '', email: '', branch: me?.branch || 'الرئيسي', assignedTo: me?.id || '' };
            if (kind === 'factory')
                data = { ...data, name: '', recordType: 'machine', quantity: 1, machineBrand: '', machineModel: '', machineType: 'unknown', machineSerial: '', boardDimensions: '', location: '' };
            if (kind === 'opportunity')
                data = { ...data, moldType: '', product: '', dimensions: '', cavities: 0, quantity: 1, requiredAt: '', value: null, stage: 'new', nextAction: '', nextDate: today(), technicalStatus: 'pending', technicalNotes: '', lossReason: '', orderRef: '', closedAt: '' };
            if (kind === 'activity')
                data = { ...data, type: 'visit', date: today(), summary: '', result: '', outcome: 'pending', nextAction: '', nextDate: '', location: '', startedAt: '', endedAt: '', syncFollowup: true };
            if (kind === 'quote') {
                const p = row(parentId);
                data = { date: today(), validUntil: today(), status: 'draft', items: [{ description: p ? `${p.data.moldType} — ${p.data.dimensions}` : '', quantity: p?.data.quantity || 1, price: 0 }], discount: 0, taxRate: 15, terms: '' };
            }
            if (kind === 'team')
                data = { name: '', email: '', role: 'rep', branch: 'الرئيسي', regionScope: '', supervisorId: 'none', active: 1, target: 0 };
        }
        if (r && kind === 'activity')
            data = { ...data, result: visitResult(data), syncFollowup: !!data.startedAt && !data.endedAt && !!row(r.parentId) && isOpen(row(r.parentId)!) };
        setForm({ kind, row: r, data, parentId, createKey: r ? undefined : crypto.randomUUID() });
    }
    async function save(e: React.FormEvent) { e.preventDefault(); if (!form || masterSaveLock.current || busy || form.memberConflict || (form.kind==='customer'&&customerLocationPending))
        return; masterSaveLock.current=true; setBusy(true); setFormError(''); const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; const clockAction = submitter?.name === 'clockAction' ? submitter.value : undefined; try {
        const d = form.kind === 'team' ? { ...form.data, email: normalizeMemberEmail(form.data.email || ''), supervisorId: form.data.supervisorId === 'none' ? '' : form.data.supervisorId || '' } : form.data;
        const payload={ action: form.kind === 'team' ? 'member' : 'save', kind: form.kind, id: form.row?.id, version: form.row?.version, parentId: form.parentId, data: d, createKey: form.createKey, memberSnapshot: form.kind==='team'?form.memberSnapshot:undefined, clockAction, syncFollowup: form.data.syncFollowup };
        if(form.kind==='customer'&&!form.row){const parsed=schemas.customer.safeParse(d);if(!parsed.success)throw new Error(parsed.error.issues.map(issue=>t(issue.message)).join(' • '));payload.data=parsed.data;}
        const result:any = form.kind==='customer'&&!form.row&&me ? await offlineSubmit('/api/crm',JSON.stringify(payload),{me,language,label:d.name||say('عميل جديد','New customer'),kind:'customer'}) : await request(payload);
        setForm(null);
        await load();
        toast.success(result.queued ? say('محفوظ على الجهاز — بانتظار المزامنة','Saved on this device — waiting to sync') : result.alreadySaved ? t('السجل محفوظ بالفعل') : clockAction === 'start' ? t('تم بدء الزيارة وحفظ وقت البداية') : clockAction === 'finish' ? t('تم إنهاء الزيارة وحساب مدتها') : t('تم الحفظ بنجاح'));
    }
    catch (e: any) {
        if (form.kind === 'team' && e.code === 'MEMBER_CONFLICT') setForm(current=>current ? {...current,memberConflict:true} : null);
        if (form.kind === 'activity' && e.existingId) {
            try {
                const fresh = await request();
                setRecords(fresh.records);
                const saved = fresh.records.find((r: Row) => r.id === e.existingId);
                if (saved)
                    setForm(f => f ? { ...f, row: saved, createKey: undefined, parentId: saved.parentId, data: { ...f.data, ...(clockAction ? { startedAt: saved.data.startedAt, endedAt: saved.data.endedAt, date: saved.data.date } : {}), visitNumber: saved.data.visitNumber, performedBy: saved.data.performedBy, recordedByEmail: saved.data.recordedByEmail, syncFollowup: false } } : null);
            }
            catch { }
        }
        setFormError(e.message);
    }
    finally {
        masterSaveLock.current=false;
        setBusy(false);
    } }
    async function reloadMemberForm(){
        if(busy||form?.kind!=='team'||!form.data.id)return;
        const opened=form;setBusy(true);
        try{
            const fresh=await request();setRecords(fresh.records);setMembers(fresh.members);setMe(fresh.me);setAudits(fresh.audits);setView(current=>resolveCRMPage(fresh.me.role,current));
            const member=fresh.members.find((value:Member)=>value.id===opened.data.id);
            if(fresh.me.role!=='admin'||regionScope(fresh.me)!=='all'||!member?.editToken){setForm(null);toast.error(say('لم يعد تعديل هذا المستخدم متاحًا لحسابك.','You can no longer edit this member.'));return;}
            setForm(current=>current===opened?{kind:'team',data:{...member,regionScope:regionScope(member),supervisorId:member.supervisorId||'none'},parentId:'',memberSnapshot:member.editToken}:current);
            setFormDirty(false);setFormError('');
        }catch(e:any){
            if(e.status===401||e.status===403){setForm(null);setMe(null);setAuth(e.status===401);setError(e.message);}else setFormError(e.message);
        }finally{setBusy(false);}
    }
    function closeMasterForm(){if(masterSaveLock.current||busy)return;if(form?.kind==='customer'&&formDirty)setDiscardForm(true);else setForm(null);}
    async function remove() { if (!deleting)
        return; if(!canDeleteRecord(deleting))return;setBusy(true); try {
        await request({ action: 'delete', kind: deleting.kind, id: deleting.id, version: deleting.version });
        setDeleting(null);
        if (detailId === deleting.id)
            setDetailId(null);
        await load();
        toast.success(t('تم حذف السجل'));
    }
    catch (e: any) {
        toast.error(t(e.message));
    }
    finally {
        setBusy(false);
    } }
    function print(r?: Row) { if(!salesWorkspace)return;setPrintQuote(r || null); setTimeout(() => window.print(), 100); }
    function exportCurrent(mode?: string) { if(!me||me.role==='rep')return; if (mode === 'activity' || view === 'activity') {
        downloadCsv('YourRest-visits-' + today() + '.csv', ['رقم الزيارة', 'اسم العميل', 'نوع التواصل', 'الهدف من الزيارة', 'نتيجة الزيارة', 'الملاحظات', 'لوكيشن الزيارة', 'موعد المتابعة', 'بداية الزيارة', 'نهاية الزيارة', 'مدة الزيارة', 'Email', 'مرحلة البيع', 'قوة الفرصة', 'الأصناف', 'الإجراء القادم', 'احتياج العميل', 'المنافس', 'ملاحظات المنافس'], filterVisitRows(records,{query:q,staff:effectiveStaffFilter,stage:stageFilter,workflow:serviceFilter}).map(r => [r.data.visitNumber || '', customerFor(r)?.data.name, t(activityTypes[r.data.type]), visitPurposes.includes(r.data.summary)?t(r.data.summary):r.data.summary, visitResults.includes(visitResult(r.data))?t(visitResult(r.data)):visitResult(r.data), r.data.notes, r.data.location, r.data.nextDate, r.data.startedAt ? formatVisitTime(r.data.startedAt) : '', r.data.endedAt ? formatVisitTime(r.data.endedAt) : '', t(durationLabel(r.data)), r.data.recordedByEmail || '', t(stageLabels[r.data.salesStage] || ''), t(strengthLabels[r.data.strength] || ''), (r.data.requestedProducts || []).map((product:string)=>t(product)).join(getLanguage()==='ar'?'، ':', '), r.data.nextAction, r.data.customerNeeds, r.data.hasCompetitor ? r.data.competitorName : '', r.data.competitorNotes]));
        return;
    } if (view === 'customer' || view === 'map') {
        const fields = ['internalCode', 'code', 'name', 'contact', 'phone', 'email', 'contact2', 'phone2', 'email2', 'customerType', 'customerStatus', 'machineCount', 'machineTypes', 'supplier', 'category', 'region', 'city', 'address', 'shortAddress', 'location', 'notes'];
        downloadCsv('YourRest-customers-' + today() + '.csv', [say('كود يورست','Yourrest code'), say('كود ERP','ERP code'), 'المصنع (العميل)', 'المسؤول الأول', 'هاتف المسؤول الأول', 'بريد المسؤول الأول', 'المسؤول الثاني', 'هاتف المسؤول الثاني', 'بريد المسؤول الثاني', 'نوع العميل', 'حالة العميل', 'عدد الماكينات حسب المصدر', 'أنواع الماكينات حسب المصدر', 'المورد', 'التصنيف', 'المنطقة', 'المدينة', 'العنوان', 'العنوان الوطني المختصر', 'الإحداثيات', 'الملاحظات', 'مسؤول المبيعات', 'فرع يورست المسؤول', 'سجلات الماكينات الحالية'], customers.map(r => [...fields.map(f => r.data[f] ?? ''), member(r.assignedTo), r.branch, all('factory').filter(m => m.parentId === r.id).map(m => [m.data.name, 'العدد: ' + (m.data.quantity ?? 'غير مسجل'), m.data.machineBrand, m.data.machineModel, machineTypeLabels[m.data.machineType]].filter(Boolean).join(' / ')).join(' | ')]));
        return;
    } const out = (view === 'dashboard' || view === 'reports') ? opps : list; downloadCsv('YourRest-' + view + '-' + today() + '.csv', ['النوع', 'السجل', 'المصنع (العميل)', 'المسؤول', 'فرع يورست المسؤول', 'المرحلة / الحالة', 'القيمة', 'الإجراء القادم', 'موعد المتابعة', 'تاريخ الإنشاء'], out.map(r => [t(kindNames[r.kind]), title(r), customerFor(r)?.data.name, member(r.data.responsibleId || r.assignedTo), r.branch, t(stageLabels[r.data.stage] || quoteStatus[r.data.status] || ''), r.data.value ?? r.data.total ?? '', r.data.nextAction, r.data.nextDate, r.createdAt.slice(0, 10)])); }
    function setField(k: string, v: any) { if(masterSaveLock.current)return; setFormDirty(true); if (form?.kind === 'team' && k === 'email') { v = normalizeMemberEmail(v); setFormError(''); } setForm(f => f ? { ...f, data: { ...f.data, [k]: v, ...(f.kind === 'activity' && k === 'startedAt' && v ? { date: riyadhDate(v) } : {}) } } : null); }
    const field = (k: string, label: string, type = 'text', required = false, full = false) => form ? <label className={full ? 'field full' : 'field'}><span>{t(label)}{required && <b> *</b>}</span>{type === 'textarea' ? <textarea value={form.data[k] ?? ''} onChange={e => setField(k, e.target.value)} rows={3}/> : <input type={type} required={required} dir={type === 'email' ? 'ltr' : undefined} autoCapitalize={type === 'email' ? 'none' : undefined} spellCheck={type === 'email' ? false : undefined} value={form.data[k] ?? ''} onChange={e => setField(k, type === 'number' ? (e.target.value === '' ? ((k === 'value' || k === 'machineCount' || (k === 'quantity' && form.kind === 'factory')) ? null : '') : Number(e.target.value)) : e.target.value)} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined}/>}</label> : null;
    const pickField = (k: string, label: string, options: [
        string,
        string
    ][], disabled = false) => <label className="field"><span>{t(label)}</span><Pick value={String(form?.data[k] ?? '')} onChange={v => setField(k, v)} options={options} label={t(label)} disabled={disabled}/></label>;
    const customerRoutingLocked=!!form?.row&&(!manage||!!form.row.data._masterRoutingReadOnly);
    const customerAssignees:[string,string][]=members.filter(m=>(m.active||form?.row?.assignedTo===m.id)&&(!isServiceRole(m.role)||form?.row?.assignedTo===m.id)).map(m=>[m.id,m.name]);
    if(form?.kind==='customer'&&form.row&&!customerAssignees.some(([id])=>id===form.row!.assignedTo))customerAssignees.push([form.row.assignedTo,form.row.assignedTo?say('المسؤول الحالي','Current assignee'):say('غير محدد','Not assigned')]);
    function parentField(kind: string, label: string) { const legacyCustomer=kind==='factory'&&form?.kind==='opportunity'&&form.row&&row(form.row.parentId)?.kind==='customer'?form.row.parentId:null; return <label className="field full"><span>{t(label)} *</span><Pick disabled={!!form?.row&&!legacyCustomer} value={form?.parentId || ''} onChange={v => setForm(f => f ? { ...f, parentId: v, ...(legacyCustomer?{data:{...f.data,technicalStatus:'pending',technicalBy:'',technicalAt:''}}:{}) } : null)} options={salesRecords.filter(r=>r.kind===kind&&(!legacyCustomer||r.parentId===legacyCustomer)).filter(r => kind !== 'opportunity' || isSalesRequest(r)&&(form?.kind!=='quote'||r.data.technicalStatus==='approved')).map(r => [r.id, kind === 'customer' ? title(r) : `${customerFor(r)?.data.name || ''} / ${title(r)}${kind === 'factory' ? ' / ' + r.data.machineModel : ''}`])} placeholder={t(label)}/>{form?.kind==='quote'&&!salesRecords.some(r=>isSalesRequest(r)&&r.data.technicalStatus==='approved')?<small className="warn">{t('أضف مواصفات القالب واعتمدها من قسم المواصفات في صفحة عروض الأسعار.')}</small>:!all(kind).length && <small className="warn">{t("أضف ")}{t(kindNames[kind])}{t(" أولًا من القائمة الجانبية.")}</small>}</label>; }
    const quickActions = (r: Row) => <div className="row-actions">{r.kind === 'customer' && customerCoordinates(r.data) && <button title={t("عرض على الخريطة")} aria-label={t('موقع ') + t(title(r))} onClick={() => { go('map'); setMapFocusId(r.id); }}><MapPinned size={17}/></button>}<button title={t("عرض السجل")} aria-label={t('عرض ') + t(title(r))} onClick={() => setDetailId(r.id)}><ChevronLeft size={18}/></button>{me?.role==='admin'&&canDeleteRecord(r)&&<button className="danger" title={t("حذف السجل")} aria-label={t("حذف ")+t(title(r))} onClick={()=>setDeleting(r)}><Trash2 size={16}/></button>}{canEditRecord(r)&&<button title={t("تعديل")} aria-label={t('تعديل ') + t(title(r))} onClick={() => start(r.kind, r)}><Pencil size={16}/></button>}{r.kind === 'quote' && <button title={t("طباعة")} onClick={() => print(r)}><Printer size={16}/></button>}</div>;
    function dataTable(rows: Row[], type: string) { if (!rows.length)
        return <Empty title={searchQuery ? t('لا توجد نتائج مطابقة') : t(`لا توجد ${type === 'customer' ? 'مصانع مسجلة' : type === 'factory' ? 'ماكينات أو خطوط إنتاج' : type === 'opportunity' ? 'فرص بيع' : type === 'activity' ? 'زيارات أو متابعات' : 'عروض أسعار'} حتى الآن`)} text={searchQuery ? t('جرّب كلمة بحث أخرى.') : t('ابدأ بإضافة أول سجل، وسيظهر هنا مع تفاصيله.')} action={searchQuery ? undefined : () => start(type)} label={t('إضافة ') + t(kindNames[type])}/>; if (type === 'activity')
        return <VisitsTable onDelete={me?.role==='admin'?setDeleting:undefined} canEdit={me?.role!=='rep'} rows={rows.slice((Math.min(pageIndex, Math.ceil(rows.length / 50)) - 1) * 50, Math.min(pageIndex, Math.ceil(rows.length / 50)) * 50)} customerFor={customerFor} onOpen={setDetailId} onEdit={r => start('activity', r)}/>; return <Table><TableHeader><TableRow>{t((type === 'customer' ? ['المصنع (العميل)', 'المدينة', 'مسؤول التواصل', 'المندوب', 'الماكينات / الخطوط', ''] : type === 'factory' ? ['الماكينة / خط الإنتاج', 'المصنع', 'الشركة / الموديل', 'نوع الماكينة', 'الفرص', ''] : type === 'opportunity' ? ['القالب المطلوب', 'المصنع / الماكينة', 'المرحلة', 'القيمة · ر.س', 'المتابعة القادمة', ''] : type === 'activity' ? ['الزيارة / المتابعة', 'المصنع', 'التاريخ', 'النتيجة', 'المندوب', ''] : ['رقم العرض', 'المصنع', 'تاريخ الإصدار', 'الإجمالي · ر.س', 'الحالة', '']).map((h, i) => <TableHead key={i}>{t(h)}</TableHead>))}</TableRow></TableHeader><TableBody>{t((type === 'opportunity' ? rows : rows.slice((Math.min(pageIndex, Math.ceil(rows.length / 50)) - 1) * 50, Math.min(pageIndex, Math.ceil(rows.length / 50)) * 50)).map(r => <TableRow key={r.id}><TableCell><button className="name-cell" onClick={() => setDetailId(r.id)}><span className="row-icon">{type === 'customer' ? <Building2 size={18}/> : type === 'factory' ? <Factory size={18}/> : type === 'opportunity' ? <Shapes size={18}/> : type === 'activity' ? <ClipboardList size={18}/> : <FileText size={18}/>}</span><span><strong>{t(title(r))}</strong><small>{type === 'customer' ? (([r.data.internalCode, r.data.code&&'ERP: '+r.data.code].filter(Boolean).join(' · ') || t('بدون رقم نظام')) + ((codeCounts.get(r.data.code) || 0) > 1 ? t(' · رقم مكرر في المصدر') : t(''))) : type === 'factory' ? t(r.data.location) : type === 'opportunity' ? r.data.dimensions : type === 'activity' ? t(activityTypes[r.data.type]) : r.data.validUntil ? t('صالح حتى ') + t(r.data.validUntil) : t('')}</small></span></button></TableCell>{type === 'customer' ? <><TableCell>{r.data.city || t(r.data.region) || t('—')}<small>{r.data.address}</small></TableCell><TableCell><strong>{r.data.contact || r.data.contact2 || t('—')}</strong><small dir="ltr">{r.data.phone || r.data.phone2}</small></TableCell><TableCell>{t(member(r.assignedTo))}</TableCell><TableCell>{t(records.filter(x => x.parentId === r.id && x.kind === 'factory').length)}</TableCell></> : type === 'factory' ? <><TableCell>{customerFor(r)?.data.name}</TableCell><TableCell><strong>{r.data.machineBrand}</strong><small>{r.data.machineModel}</small></TableCell><TableCell>{t(machineTypeLabels[r.data.machineType]) || t('غير محدد')}</TableCell><TableCell>{t(records.filter(x => x.parentId === r.id && x.kind === 'opportunity').length)}</TableCell></> : type === 'opportunity' ? <><TableCell><strong>{customerFor(r)?.data.name}</strong><small>{machineFor(r)?.data.name}</small></TableCell><TableCell><Badge stage={r.data.stage}/></TableCell><TableCell className="numeric">{r.data.value === null ? t('غير مسعّرة') : t(money(r.data.value))}</TableCell><TableCell><strong className={isOpen(r) && !!r.data.nextDate && r.data.nextDate < today() ? 'overdue' : ''}>{isOpen(r) ? t(r.data.nextDate) : t(r.data.closedAt)}</strong><small>{isOpen(r) ? r.data.nextAction : r.data.stage === 'won' ? r.data.orderRef : r.data.lossReason}</small></TableCell></> : type === 'activity' ? <><TableCell>{customerFor(r)?.data.name}</TableCell><TableCell className="numeric">{t(r.data.date)}</TableCell><TableCell><Badge stage={r.data.outcome}/></TableCell><TableCell>{t(member(r.assignedTo))}</TableCell></> : <><TableCell>{customerFor(r)?.data.name}</TableCell><TableCell className="numeric">{t(r.data.date)}</TableCell><TableCell className="numeric">{t(money(r.data.total))}</TableCell><TableCell><Badge stage={r.data.status}/></TableCell></>}<TableCell>{t(quickActions(r))}</TableCell></TableRow>))}</TableBody></Table>; }
    const monthOpp = opps.filter(r => r.data.closedAt?.startsWith(month));
    const monthWon = monthOpp.filter(r => r.data.stage === 'won');
    const monthLost = monthOpp.filter(r => r.data.stage === 'lost');
    const monthActs = filtered.filter(r => r.kind === 'activity' && r.data.date?.startsWith(month));
    const mapScopeKey=[me?.id,me?.role,me?.branch,me?.regionScope,me?.supervisorId,me?.authVersion].join(':');
    const pageActions = <div className="heading-actions no-print" hidden={!permittedView}>{view==='customer'&&canManageCustomerIdentities&&<button type="button" className="btn subtle" onClick={()=>setCustomerIdentitiesOpen(true)}>{say('ربط عملاء ERP','Link ERP customers')}</button>}{regionalDirectory&&<button className="btn subtle" onClick={()=>start('customer')}><Plus size={18}/>{t('إضافة عميل')}</button>}{me?.role!=='rep'&&!['dashboard', 'team', 'sales', 'reports', 'targets', 'followup', 'journeys', 'competitors'].includes(view) && <button className="btn subtle page-export-action" onClick={() => exportCurrent()} disabled={!me}><Download size={17}/>{t("تصدير")}</button>}{!['sales', 'reports', 'targets', 'journeys', 'followup', 'competitors'].includes(view) && <button className="btn primary" onClick={() => start(regionalDirectory || view === 'dashboard' ? 'activity' : view === 'map' ? 'customer' : view)} disabled={!me || (view === 'team' && (me.role !== 'admin'||regionScope(me)!=='all'))}><Plus size={19}/>{regionalDirectory || ['dashboard', 'activity'].includes(view) ? t('زيارة جديدة') : t('إضافة ') + t(kindNames[view === 'map' ? 'customer' : view])}</button>}</div>;
    const appliedFilters=(regionFilter!=='all'?1:0)+(me?.role!=='rep'&&staffFilter!=='all'?1:0)+(stageFilter!=='all'?1:0);
    const pageFilters = <div className="filterbar mobile-friendly-filters no-print"><div className="mobile-search-row">{canSearch&&<label className="search"><Search size={18}/><input type="search" enterKeyHint="search" autoComplete="off" aria-label={t("بحث في السجلات")} value={q} onChange={e => setQ(e.target.value)} placeholder={['customer','map'].includes(view)?say('ابحث باسم العميل أو رقمه أو الجوال أو المدينة','Search customer name, code, phone or city'):say('ابحث باسم العميل أو نتيجة التواصل','Search customer or contact result')}/>{q && <button type="button" onClick={() => setQ('')} aria-label={t("مسح البحث")}><X size={18}/></button>}</label>}<button type="button" className={'btn subtle mobile-filter-toggle'+(appliedFilters?' has-filters':'')} aria-expanded={filtersOpen} aria-controls="crm-page-filters" onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={18}/><span>{say('فلترة','Filters')}</span>{appliedFilters>0&&<b>{appliedFilters}</b>}</button></div><div className="filters" id="crm-page-filters" hidden={compactNavigation&&!filtersOpen}>{['customer', 'map'].includes(view) && <Pick value={regionFilter} onChange={setRegionFilter} label={t("المنطقة")} options={[["all", "كل المناطق"], ...regions.map(r => [r, r === 'unknown' ? 'المنطقة غير محددة' : r] as [string,string])]}/>}{me?.role!=='rep'&&<Pick value={staffFilter} onChange={setStaffFilter} label={t("المندوب")} options={[["all", "كل المندوبين"], ...members.map(m => [m.id, m.name] as [string,string])]}/>} {['activity','followup'].includes(view) && <Pick value={stageFilter} onChange={setStageFilter} options={[["all", "كل مراحل البيع"], ...Object.entries(stageLabels)]} label={t("مرحلة البيع")}/>}{view === 'reports' && <input type="month" aria-label={t("شهر التقرير")} value={month} onChange={e => setMonth(e.target.value)}/>}<button type="button" className="btn subtle small mobile-refresh" title={t("تحديث البيانات")} onClick={load}><RefreshCw size={17}/><span>{say('تحديث','Refresh')}</span></button>{appliedFilters>0&&<button type="button" className="btn subtle small" onClick={()=>{setRegionFilter('all');setStaffFilter('all');setStageFilter('all');}}>{say('مسح الفلاتر','Clear filters')}</button>}</div></div>;
    const mapFilters=<div className="cm-scope-filters"><Pick value={regionFilter} onChange={setRegionFilter} label={t('المنطقة')} options={[["all","كل المناطق"],...regions.map(r=>[r,r==='unknown'?'المنطقة غير محددة':r] as [string,string])]}/>{me?.role!=='rep'&&<Pick value={staffFilter} onChange={setStaffFilter} label={t('المندوب')} options={[["all","كل المندوبين"],...members.map(m=>[m.id,m.name] as [string,string])]}/>}<button type="button" className="btn subtle" title={t('تحديث البيانات')} onClick={load}><RefreshCw size={17}/>{say('تحديث','Refresh')}</button>{(regionFilter!=='all'||effectiveStaffFilter!=='all')&&<button type="button" className="btn subtle" onClick={()=>{setRegionFilter('all');setStaffFilter('all');}}>{say('مسح الفلاتر','Clear filters')}</button>}</div>;
    return <JourneyTrackerProvider me={me}><Toaster position="top-center" richColors dir={direction()}/><SidebarProvider style={{ '--sidebar-width': '248px' } as React.CSSProperties} className={view==='map'?'app-shell app-shell--map':'app-shell'}>
 {!compactNavigation&&<div className="crm-desktop-navigation"><Sidebar side={direction()==='rtl'?'right':'left'} className="app-sidebar"><SidebarHeader className="brand"><img src="/yourrest-logo.png" alt={t("YOUR REST INDUSTRIES")}/><div className="brand-divider"/><span>{t("إدارة علاقات العملاء")}</span></SidebarHeader><SidebarContent className="nav-content"><p className="nav-label">{t("مساحة العمل")}</p><NavMenu view={view} go={go} role={me?.role}/></SidebarContent><SidebarFooter><div className="sidebar-footnote"><ShieldCheck size={17}/><span>{t("يورست للصناعات")}</span><small>CRM</small></div><div className="profile"><span className="avatar">{t(me?.name?.slice(0, 1)) || (getLanguage()==='ar'?'ي':'Y')}</span><div><strong>{me?.name || t('يورست للصناعات')}</strong><small>{me ? t(roles[me.role]) : t('تسجيل دخول آمن')}</small></div>{me && <EmailLogout/>}</div></SidebarFooter></Sidebar></div>}
 <main className={(view==='map'?'workspace map-workspace':'workspace')+(me?.role==='rep'?' representative-workspace':'')}><header className="topbar no-print"><div className="breadcrumb"><span>{t("يورست للصناعات")}</span><ChevronLeft size={15}/><strong>{t(currentTitle)}</strong></div><div className="topbar-tools"><JourneyTrackingBanner compact/><LanguageSwitch/><span className="today"><CalendarDays size={16}/>{t(today())}</span><ThemeToggle/><span className="desktop-top-avatar" hidden={compactNavigation}><span className="top-avatar">YR</span></span>{compactNavigation&&me&&<button type="button" className="top-avatar mobile-profile-trigger" aria-label={getLanguage()==='ar'?'حسابي':'My account'} aria-haspopup="dialog" aria-expanded={mobileAccountOpen} onClick={()=>setMobileAccountOpen(true)}>{me.name?.slice(0,1)||'Y'}</button>}</div></header>
 <div className={view==='map'?'page map-page':'page'}><div className="workspace-notices"><AppUpdate/><InstallApp/><JourneyTrackingBanner/>{me&&<OfflineStatus me={me} offline={offline}/>} {offlineStorageError&&<p className="mobile-offline-notice" role="alert">{offlineStorageError}</p>}</div>{view!=='map'&&<section className="page-heading"><div><span className="eyebrow">YOUR REST INDUSTRIES</span><h1>{t(currentTitle)}</h1></div>{pageActions}</section>}
 {error ? <div className="error-banner"><strong>{t(error)}</strong>{auth ? <a className="btn primary" href="/login" target="_top">{t("تسجيل الدخول")}</a> : <button className="btn subtle" onClick={() => { setLoading(true); load(); }}>{t("إعادة المحاولة")}</button>}</div> : loading || !permittedView ? <div className="metrics">{t([1, 2, 3, 4].map(n => <Skeleton className="h-36 rounded-xl" key={n}/>))}</div> : <>
 {!['map','team','sales','reports','targets','journeys','competitors'].includes(view) && pageFilters}
 {view==='competitors'&&salesWorkspace&&me&&<CompetitorsWorkspace key={[me.id,me.role,me.regionScope,me.supervisorId,me.authVersion].join(':')} records={salesRecords.filter(r=>!r.data._offlineState&&!r.data._offlineAcknowledged)} members={members} onCustomer={setDetailId} onVisit={r=>openVisit(r)} onNew={openCompetitorVisit} onRefresh={load}/>}
 {view==='journeys'&&salesWorkspace&&me&&<JourneyReport key={[me.id,me.role,me.regionScope,me.supervisorId,me.authVersion].join(':')} me={me}/>}
 {view === 'map' && me && <CustomerMap key={mapScopeKey} customers={customers} me={me} focusId={mapFocusId} filters={mapFilters} scopeKey={mapScopeKey}/>}
 {view === 'dashboard' && <>
 <div className="metrics"><Metric label={t("طلبات القوالب المفتوحة")} value={String(open.length)} note={`${filtered.filter(r => r.kind === 'customer').length} مصنع مسجل`} Icon={Shapes}/><Metric label={t("قيمة الطلبات المفتوحة")} value={money(open.reduce((s, r) => s + (r.data.value || 0), 0))} unit="ر.س" note={`${open.filter(r => r.data.value === null).length} طلب لم يُسعّر بعد`} Icon={BriefcaseBusiness}/><Metric label={t("متابعات مستحقة")} value={String(due.length)} note={`${due.filter(r => r.data.nextDate && r.data.nextDate < today()).length} متأخرة عن موعدها`} Icon={Clock} accent="amber"/><Metric label={t("قيمة الصفقات الفائزة")} value={money(won.reduce((s, r) => s + r.data.value, 0))} unit="ر.س" note={`${won.length} صفقة فائزة · كل الفترات`} Icon={Target} accent="green"/></div>
 <section className="panel pipeline-summary"><div className="panel-heading"><div><h2>{t("مراحل طلبات القوالب")}</h2></div><button className="text-button" onClick={() => go('opportunity')}>{t("عرض الزيارات ")}<ChevronLeft size={16}/></button></div><div className="stage-strip">{t(stages.map((s, i) => { const a = opps.filter(r => r.data.stage === s); return <button key={s} className={'stage-block ' + s} onClick={() => { go('opportunity'); setStageFilter(s); }}><span className="stage-marker">{t(String(i + 1).padStart(2, '0'))}</span><span>{t(stageLabels[s])}</span><b>{t(a.length)}</b><small>{t(money(a.reduce((t, r) => t + (r.data.value || 0), 0)))}{t(" ر.س")}</small></button>; }))}</div></section>
 <div className="dashboard-bottom"><section className="panel followups"><div className="panel-heading"><div><h2>{t("يستحق المتابعة")}</h2></div><span className="count-badge">{t(due.length)}</span></div>{!due.length ? <Empty Icon={CheckCircle2} title={t("لا توجد متابعات مستحقة")} text={t("ستظهر هنا المتابعات التي تحتاج خطوة منك اليوم.")}/> : <div className="due-list">{t(due.slice(0, 6).map(r => <div className="due-item" key={r.id}><span className={'due-symbol ' + (r.data.nextDate < today() ? 'late' : '')}><Clock size={18}/></span><button onClick={() => setDetailId(r.id)}><strong>{customerFor(r)?.data.name}</strong><small>{r.data.nextAction} · {t(followupTitle(r))}</small></button><span className={r.data.nextDate < today() ? 'overdue' : 'muted'}>{r.data.nextDate||t('تحتاج تحديد الخطوة القادمة')}</span>{canExecuteCustomerFollowup(r)&&<button className="btn subtle small" onClick={() => openFollowup(customerFor(r)?.id,undefined,r.id)}>{t("تنفيذ المتابعة")}</button>}</div>))}</div>}</section>
 {!records.length ? <section className="start-card"><span className="start-symbol"><Factory size={32}/></span><span className="eyebrow">{t("أول متابعة تبدأ بمعرفة المصنع")}</span><h2>{t("ابدأ بناء قاعدة")}<br />{t("مصانعك.")}</h2><button className="btn white" onClick={() => start('customer')}><Plus size={18}/>{t("إضافة أول مصنع")}</button><div className="steps"><span>{t("01 المصنع")}</span><span>{t("02 الماكينة")}</span><span>{t("03 القالب")}</span></div></section> : <section className="panel recent"><div className="panel-heading"><h2>{t("آخر التحديثات")}</h2><Clock size={18}/></div>{t(audits.slice(0, 5).map(a => <div className="audit-item" key={a.id}><span className="audit-dot"/><div><strong>{t(a.action)} · {t(a.detail.split(' • ')[0])}</strong><small>{t(a.actor)} · {t(new Date(a.createdAt).toLocaleDateString('en-GB'))}</small></div></div>))}{!audits.length && <Empty title={t("لا توجد تحديثات")}/>}</section>}</div></>}
 {view === 'customer' && <CustomerMachines canEdit={me?.role!=='rep'} customers={customers} records={records} members={members} page={pageIndex} onPage={setPageIndex} onOpen={setDetailId} onHistory={id => { setDetailId(id); setDetailTab('visits'); }} onEdit={r => start(r.kind, r)} onAddMachine={id => start('factory', undefined, id)} onAddOpportunity={id => start('opportunity', undefined, id)} onMap={id => { go('map'); setMapFocusId(id); }}/>}
 {view==='quote'&&<section className="panel"><details className="previous-requests"><summary>{t('مواصفات القوالب والاعتماد الفني')}</summary><button className="btn primary small" onClick={()=>start('opportunity',undefined,undefined,true)}><Plus size={17}/>{t('إضافة مواصفات قالب')}</button>{salesRecords.filter(isSalesRequest).map(r=><article key={r.id}><strong>{customerFor(r)?.data.name} · {r.data.moldType}</strong><span className="badge">{t(r.data.technicalStatus==='approved'?'معتمد فنيًا':'بانتظار المراجعة')}</span><button className="btn subtle small" onClick={()=>start('opportunity',r,undefined,true)}>{t('المواصفات والاعتماد')}</button>{r.data.technicalStatus==='approved'&&<button className="btn primary small" onClick={()=>start('quote',undefined,r.id)}>{t('إضافة عرض سعر')}</button>}</article>)}</details></section>}
 {view === 'quote' && <section className="panel"><div className="panel-heading"><h2>{t(currentTitle)} <span className="inline-count">{t(list.length)}</span></h2></div>{t(dataTable(list, view))}{list.length > 50 && <Pagination className="table-paging"><PaginationContent><PaginationItem><button className="btn subtle small" disabled={pageIndex <= 1} onClick={() => setPageIndex(p => p - 1)}>{t("السابق")}</button></PaginationItem><PaginationItem><span>{t("صفحة ")}{t(Math.min(pageIndex, Math.ceil(list.length / 50)))}{t(" من ")}{t(Math.ceil(list.length / 50))} · {t(list.length)}{t(" سجل")}</span></PaginationItem><PaginationItem><button className="btn subtle small" disabled={pageIndex >= Math.ceil(list.length / 50)} onClick={() => setPageIndex(p => p + 1)}>{t("التالي")}</button></PaginationItem></PaginationContent></Pagination>}</section>}
 {serviceDetailId&&me&&<ServiceWorkflow id={serviceDetailId} me={me} onClose={()=>setServiceDetailId('')} onRefresh={load} onEdit={()=>{const row=records.find(r=>r.id==='intake-'+serviceDetailId);setServiceDetailId('');if(row)openVisit(row);}} onFollowup={id=>{setServiceDetailId('');openFollowup(id);}} onVisit={id=>{setServiceDetailId('');openVisit(undefined,id);}}/>}
 {view === 'followup' && <CustomerFollowupsPage onDelete={me?.role==='admin'?setDeleting:undefined} records={salesRecords} members={members} query={searchQuery} staff={effectiveStaffFilter} stage={stageFilter} onNew={(id,sourceId)=>openFollowup(id,undefined,sourceId)} onOpen={r=>openFollowup(undefined,r)} onCustomer={setDetailId}/>}
 {view === 'activity' && <VisitsPage onDelete={me?.role==='admin'?setDeleting:undefined} canEdit={me?.role!=='rep'} workflow={serviceFilter} onWorkflowFilter={setServiceFilter} records={records} members={members} query={searchQuery} staff={effectiveStaffFilter} stage={stageFilter} onOpen={r => openVisit(r)} onNew={() => start('activity')} onCustomer={setDetailId} onWorkflow={id=>{setVisitEditor(null);setServiceDetailId(id);}}/>}
 {me?.role==='rep'&&view==='targets'&&<MyTargets me={me} month={month} onMonthChange={setMonth}/>}
 {salesWorkspace&&['sales','targets'].includes(view) && me && <SalesWorkspace key={view+':'+me.id+':'+me.role+':'+regionScope(me)} mode={view === 'sales' ? 'sales' : 'targets-performance'} month={month} onMonthChange={setMonth} records={salesRecords} me={me} onRefresh={load} onCustomer={setDetailId} onCustomerCreated={createdCustomer}/>}
 {view === 'team' && <><div className="info-line"><ShieldCheck size={19}/>{t("المنطقة تحدد نطاق البيانات أولًا، ثم يُطبق الدور والإسناد: المندوب يرى عملاءه داخلها، والمشرف فريقه، والمدير بيانات المنطقة المسموح بها.")}</div><section className="panel"><Table><TableHeader><TableRow>{t(['المستخدم', 'الدور', 'منطقة البيانات المسموح بها', 'الفرع', 'المشرف', 'الحالة', ''].map((s, i) => <TableHead key={i}>{t(s)}</TableHead>))}</TableRow></TableHeader><TableBody>{t(members.map(m => <TableRow key={m.id}><TableCell><strong>{m.name}</strong><small dir="ltr">{m.email}</small></TableCell><TableCell>{t(roles[m.role])}</TableCell><TableCell>{t(regionLabel(regionScope(m)))}</TableCell><TableCell>{t(m.branch)}</TableCell><TableCell>{t(member(m.supervisorId || ''))}</TableCell><TableCell><span className={'badge ' + (m.active ? 'accepted' : 'lost')}>{m.active ? t('نشط') : t('معطل')}</span></TableCell><TableCell>{me?.role === 'admin' && regionScope(me)==='all' && <button className="icon-button" title={t("تعديل المستخدم")} onClick={() => { setFormError(''); setFormDirty(false); setForm({ kind: 'team', data: { ...m, regionScope: regionScope(m), supervisorId: m.supervisorId || 'none' }, parentId: '', memberSnapshot: m.editToken }); }}><Pencil size={16}/></button>}</TableCell></TableRow>))}</TableBody></Table></section></>}
 </>}
 {view!=='map'&&<footer className="page-footer"><span>YOUR REST <b>INDUSTRIES</b></span><span>{t("علاقات أقوى. متابعة أدق.")}</span></footer>}</div></main>{compactNavigation&&me&&<MobileNavigation me={me} view={view} onNavigate={go} accountOpen={mobileAccountOpen} onAccountOpenChange={setMobileAccountOpen} blocked={!!(customerIdentitiesVisible||form||visitEditor||followupEditor||detailId||deleting||printQuote||serviceDetailId)}/>}</SidebarProvider>
 {customerIdentitiesVisible&&me&&<CustomerIdentities key={[me.id,me.role,me.regionScope,me.authVersion].join(':')} onClose={()=>setCustomerIdentitiesOpen(false)} onSaved={load}/>}
 <Dialog open={!!form} onOpenChange={o => { if (!o) closeMasterForm(); }}><DialogContent className="crm-dialog crm-master-dialog" dir={direction()}><DialogTitle>{form?.row || form?.kind==='team'&&form.data.id ? t('تعديل') : t('إضافة')} {t(kindNames[form?.kind || ''])}</DialogTitle><DialogDescription>{form?.kind === 'opportunity' ? t('حدد القالب المطلوب وخطوتك القادمة مع المصنع.') : form?.kind === 'quote' ? t('راجع البنود والضريبة والشروط قبل إرسال العرض.') : t('الحقول المميزة بـ * مطلوبة.')}</DialogDescription>{form && <form onSubmit={save} aria-busy={busy} onInvalidCapture={e=>{let parent=(e.target as HTMLElement).parentElement;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}}}><fieldset disabled={busy} className="form-grid" style={{border:0,margin:0,padding:0,minWidth:0}}>
 {form.kind === 'customer' && <>
 {t(field('name', 'اسم المصنع', 'text', true))}
 <label className="field"><span>{say('كود يورست','Yourrest code')}</span><input readOnly dir="ltr" value={form.row?.data.internalCode||''} placeholder={say('يُنشأ تلقائيًا بعد المزامنة','Assigned automatically after synchronization')}/></label>
 {me&&<CustomerRegionField value={form.data.region||''} me={me} disabled={busy||!!form.row?.data._masterRoutingReadOnly} onChange={v=>setField('region',v)}/>}
 <CustomerClassificationFields data={form.data} disabled={busy} onChange={setField}/>
 {t(field('phone', 'الجوال', 'tel'))}{t(field('contact', 'مسؤول التواصل'))}{t(field('city', 'المدينة'))}
 {me?.role!=='rep'&&(customerRoutingLocked?<><label className="field"><span>{t('فرع يورست المسؤول')}</span><input readOnly value={form.data.branch||''}/></label><label className="field"><span>{t('المندوب المسؤول')}</span><input readOnly value={customerAssignees.find(([id])=>id===form.data.assignedTo)?.[1]||say('غير محدد','Not assigned')}/></label></>:<>{t(field('branch', 'فرع يورست المسؤول', 'text', true))}{t(pickField('assignedTo', 'المندوب المسؤول', customerAssignees, !manage))}</>)}
 <CustomerLocationFields key={form.row?.id||form.createKey} data={form.data} editing={!!form.row} disabled={busy}
  onUpdate={update=>{if(masterSaveLock.current)return;setFormDirty(true);const key=form.row?.id||form.createKey;setForm(current=>current?.kind==='customer'&&(current.row?.id||current.createKey)===key?{...current,data:update(current.data)}:current);}}
  onPendingChange={setCustomerLocationPending}/>
 <details className="customer-extra-fields full" open={!!form.row||me?.role!=='rep'}><summary>{say('بيانات إضافية للعميل','Additional customer details')}</summary><div className="form-grid">{field('code', say('كود العميل في ERP','Customer ERP code'))}{t(field('address', 'العنوان'))}{t(field('email', 'إيميل المسؤول الأول', 'email'))}{t(field('contact2', 'اسم المسؤول الثاني'))}{t(field('phone2', 'جوال المسؤول الثاني', 'tel'))}{t(field('email2', 'إيميل المسؤول الثاني', 'email'))}{form.row && all('factory').some(r => r.parentId === form.row!.id && r.data.sourceFile) ? <div className="form-note full">{t("الماكينات متاحة تحت صف المصنع في صفحة العملاء. العدد الأصلي في الشيت: ")}{t(form.data.machineCount) ?? t('غير مسجل')}{t(" · الأنواع: ")}{t(form.data.machineTypes) || t('غير مسجلة')}</div> : <>{t(field('machineCount', 'عدد الماكينات في الشيت', 'number'))}{t(field('machineTypes', 'أنواع الماكينات في الشيت'))}</>}{t(field('supplier', 'مورد القوالب والقطع'))}{t(field('notes', 'ملاحظات المصنع', 'textarea', false, true))}</div></details></>}
 {form.kind === 'factory' && <>{t(parentField('customer', 'المصنع (العميل)'))}{t(field('name', 'اسم / رقم الماكينة أو خط الإنتاج', 'text', true))}{t(field('location', 'موقع الماكينة داخل المصنع'))}{form.data.recordType === 'group' && <>{t(field('quantity', 'إجمالي عدد الماكينات بالمجموعة', 'number'))}<p className="form-note">{t("بيانات مجموعة من الشيت. العدد إجمالي، ولا يحدد كمية كل نوع عند وجود أكثر من نوع.")}</p></>}{t(field('machineBrand', 'الشركة المصنعة للماكينة', 'text', form.data.recordType !== 'group'))}{t(field('machineModel', 'موديل الماكينة', 'text', form.data.recordType !== 'group'))}{t(pickField('machineType', 'نوع الماكينة', [['unknown', 'غير محدد'], ['stationary', 'ثابتة'], ['mobile', 'متحركة']]))}{t(field('machineSerial', 'رقم الماكينة / الخط'))}{t(field('boardDimensions', 'مقاس الباليت / اللوح (مم)', 'text', false, true))}{t(field('notes', 'ملاحظات التشغيل والمواصفات', 'textarea', false, true))}<p className="form-note full">{say('تسجيل الماكينة لا يعني اعتماد توافق القالب.','Recording a machine does not approve mold compatibility.')}</p></>}
 {form.kind === 'opportunity' && <>{t(parentField('factory', 'الماكينة / خط الإنتاج'))}{form.parentId && !completeMachineSpecs(row(form.parentId)?.data) && <p className="form-note full">{t("مواصفات الماكينة غير مكتملة. يمكنك تسجيل الفرصة ومتابعتها، واستكمال الشركة والموديل ونوع التشغيل قبل الاعتماد الفني.")}</p>}{t(field('moldType', 'نوع / اسم القالب', 'text', true))}{t(field('product', 'المنتج المراد تصنيعه', 'text', true))}{t(field('dimensions', 'أبعاد المنتج (طول × عرض × ارتفاع) مم', 'text', true))}{t(field('cavities', 'عدد التجاويف (0 إذا غير معلوم)', 'number'))}{t(field('quantity', 'عدد القوالب المطلوبة', 'number', true))}{t(field('requiredAt', 'تاريخ الاحتياج', 'date'))}{t(field('value', form.data.stage === 'won' ? 'القيمة النهائية للصفقة · ر.س' : 'القيمة التقديرية · ر.س', 'number'))}{t(pickField('stage', 'مرحلة البيع', Object.entries(stageLabels)))}<div className="form-section full"><ShieldCheck size={18}/>{t("المراجعة الفنية")}</div>{t(pickField('technicalStatus', 'حالة الاعتماد الفني', [['pending', 'بانتظار المراجعة'], ['approved', 'معتمد فنيًا']], !manage))}{t(field('technicalNotes', 'ملاحظات المراجعة الفنية', 'textarea', form.data.technicalStatus === 'approved'))}{form.data.technicalBy && <p className="form-note full">{t("اعتمد بواسطة ")}{t(form.data.technicalBy)}</p>}{['won', 'lost'].includes(form.data.stage) ? <>{t(field('closedAt', 'تاريخ الإغلاق', 'date', true))}{form.data.stage === 'won' ? t(field('orderRef', 'مرجع طلب الشراء / التعاقد', 'text', true)) : t(field('lossReason', 'سبب فقد الفرصة', 'text', true))}</> : <><div className="form-section full"><CalendarDays size={18}/>{t("المتابعة القادمة")}</div>{t(field('nextAction', 'الإجراء القادم', 'text', true))}{t(field('nextDate', 'موعد المتابعة', 'date', true))}</>}{t(field('notes', 'تفاصيل إضافية', 'textarea', false, true))}</>}
 {form.kind === 'activity' && <VisitFields data={form.data} parentId={form.parentId} records={records} editing={!!form.row} busy={busy} email={me?.email || ''} onChange={setField} onParent={id => setForm(f => f ? { ...f, parentId: id } : null)}/>}
 {form.kind === 'quote' && <>{t(parentField('opportunity', 'طلب القالب المعتمد فنيًا'))}{t(field('date', 'تاريخ الإصدار', 'date', true))}{t(field('validUntil', 'صالح حتى', 'date', true))}{t(pickField('status', 'حالة العرض', Object.entries(quoteStatus)))}<div className="full quote-items"><div className="form-section">{t("بنود عرض السعر")}</div>{t(form.data.items.map((it: any, i: number) => <div className="quote-item" key={i}><label><span>{t("البند ")}{t(i) + 1}</span><input required value={it.description} onChange={e => setField('items', form.data.items.map((a: any, j: number) => j === i ? { ...a, description: e.target.value } : a))}/></label><label><span>{t("الكمية")}</span><input type="number" required min="0.001" step="any" value={it.quantity} onChange={e => setField('items', form.data.items.map((a: any, j: number) => j === i ? { ...a, quantity: Number(e.target.value) } : a))}/></label><label><span>{t("سعر الوحدة")}</span><input type="number" required min="0" step="0.01" value={it.price} onChange={e => setField('items', form.data.items.map((a: any, j: number) => j === i ? { ...a, price: Number(e.target.value) } : a))}/></label><button type="button" className="icon-button danger" aria-label={t("حذف البند")} disabled={form.data.items.length === 1} onClick={() => setField('items', form.data.items.filter((_: any, j: number) => j !== i))}><Trash2 size={17}/></button></div>))}<button type="button" className="text-button" onClick={() => setField('items', [...form.data.items, { description: '', quantity: 1, price: 0 }])}><Plus size={16}/>{t("إضافة بند")}</button></div>{t(field('discount', 'الخصم · ر.س', 'number'))}{t(field('taxRate', 'نسبة الضريبة %', 'number', true))}<div className="quote-total full"><span>{t("الإجمالي شامل الضريبة")}</span><strong>{t(money(quoteTotals(form.data.items, Number(form.data.discount), Number(form.data.taxRate)).total))}{t(" ر.س")}</strong></div>{t(field('terms', 'شروط الدفع والتوريد', 'textarea', false, true))}<p className="form-note full">{say("قبول العرض لا يغلق البيع. عند الفوز، سجّل مرجع الطلب والقيمة النهائية في الزيارة.","Accepting the quote does not close the sale. When won, record the order reference and final value in the visit.")}</p></>}
 {form.kind === 'team' && <>{t(field('name', 'اسم المستخدم', 'text', true))}{t(field('email', 'البريد المستخدم للدخول', 'email', true))}{t(pickField('role', 'الدور', Object.entries(roles)))}<MemberRegionField value={form.data.regionScope??'all'} onChange={v=>setField('regionScope',v)} disabled={form.data.id==='owner'}/><p className="form-note full">{say("الصلاحية تتيح عرض البيانات والعمل داخل المنطقة المحددة فقط.","Access is limited to viewing and working within the selected region.")}</p>{t(field('branch', 'الفرع', 'text', true))}{t(pickField('supervisorId', form.data.role==='customer_service'?'مدير خدمة العملاء المسؤول':form.data.role==='customer_service_manager'?'مدير المبيعات المستلم':'المشرف', [['none', 'بدون مشرف'], ...members.filter(m => m.id !== form.data.id && (form.data.role==='customer_service'?['customer_service_manager']:form.data.role==='customer_service_manager'?['manager']:['admin','manager','supervisor']).includes(m.role)).map(m => [m.id, m.name] as [
                string,
                string
            ])]))}{t(pickField('active', 'الحالة', [['1', 'نشط'], ['0', 'معطل']]))}</>}
 </fieldset>{formError && <div className="form-error" role="alert">{t(formError)}</div>}{form.kind==='team'&&form.memberConflict&&<p className="form-note" role="status">{say('تعديلاتك ما زالت ظاهرة ولم تُحفظ. تحميل أحدث البيانات سيستبدلها بآخر نسخة محفوظة لتراجعها قبل إعادة التعديل.','Your unsaved edits are still shown. Loading the latest data will replace them with the saved version for review before editing again.')}</p>}<div className="form-footer"><button type="button" className="btn subtle" disabled={busy} onClick={closeMasterForm}>{t("إلغاء")}</button>{form.kind==='team'&&form.memberConflict&&<button type="button" className="btn subtle" disabled={busy} onClick={reloadMemberForm}>{say('تحميل أحدث بيانات المستخدم','Load latest member data')}</button>}<button type="submit" className="btn primary" aria-busy={busy} disabled={busy||!!form.memberConflict||(form.kind==='customer'&&customerLocationPending)}>{busy ? <Loader2 className="spin" size={18}/> : <CheckCircle2 size={18}/>}{t("حفظ ")}{t(kindNames[form.kind])}</button></div></form>}</DialogContent></Dialog>
 <AlertDialog open={discardForm} onOpenChange={setDiscardForm}><AlertDialogContent className="discard-customer-dialog" dir={direction()}><AlertDialogTitle>{say('الخروج بدون حفظ؟','Leave without saving?')}</AlertDialogTitle><AlertDialogDescription>{say('بيانات العميل التي كتبتها لم تُحفظ بعد.','The customer details you entered have not been saved yet.')}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>{say('استكمال التسجيل','Keep editing')}</AlertDialogCancel><AlertDialogAction onClick={()=>{setDiscardForm(false);setFormDirty(false);setForm(null);}}>{say('تجاهل التعديلات','Discard changes')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 <Sheet open={!!detail} onOpenChange={o => { if (!o)
        setDetailId(null); }}><SheetContent side={direction()==='rtl'?'left':'right'} className="crm-sheet" dir={direction()}><SheetTitle>{t(title(detail))}</SheetTitle><SheetDescription>{detail ? t(kindNames[detail.kind]) + t(' · ') + customerFor(detail)?.data.name : t('')}</SheetDescription>{detail && <><div className="detail-actions">{canEditRecord(detail)&&<button className="btn primary small" onClick={() => start(detail.kind, detail)}><Pencil size={15}/>{t("تعديل")}</button>}{me&&canViewPage(me.role,'map')&&!detail.data._readOnly && detail.kind === 'customer' && customerCoordinates(detail.data) && <button className="btn subtle small" onClick={() => { const id = detail.id; setDetailId(null); go('map'); setMapFocusId(id); }}><MapPinned size={16}/>{t("الخريطة")}</button>}{salesWorkspace && canManageRecordRouting(detail) && detail.kind === 'customer' && <button className="btn subtle small" onClick={() => start('factory', undefined, detail.id)}><Plus size={15}/>{t("إضافة ماكينة / خط إنتاج")}</button>}{(!detail.data._readOnly||me&&isServiceRole(me.role)) && detail.kind === 'customer' && <button className="btn subtle small" onClick={() => start('activity', undefined, detail.id)}><Plus size={15}/>{t("تسجيل زيارة")}</button>}{detail.kind === 'factory' && <button className="btn subtle small" onClick={() => start('opportunity', undefined, detail.id)}><Plus size={15}/>{t("زيارة جديدة")}</button>}{detail.kind === 'opportunity' && <><button className="btn subtle small" onClick={() => start('activity', undefined, detail.id)}>{t("تسجيل زيارة")}</button>{salesWorkspace&&<button className="btn subtle small" onClick={() => start('quote', undefined, detail.id)}>{t("عرض سعر")}</button>}</>}{detail.kind === 'quote' && <button className="btn subtle small" onClick={() => print(detail)}><Printer size={15}/>{t("طباعة")}</button>}{canDeleteRecord(detail)&&<button className="icon-button danger" title={t("حذف السجل")} onClick={() => setDeleting(detail)}><Trash2 size={17}/></button>}</div>
 <Tabs value={detailTab} onValueChange={setDetailTab} key={detail.id}><TabsList className="detail-tabs"><TabsTrigger value="info">{t("البيانات")}</TabsTrigger><TabsTrigger value="related">{detail.kind === 'customer' ? t('الماكينات') : t('السجلات المرتبطة')}</TabsTrigger>{detail.kind === 'customer' && <TabsTrigger value="visits">{t("سجل الزيارات")}</TabsTrigger>}<TabsTrigger value="history">{t("سجل التغييرات")}</TabsTrigger></TabsList><TabsContent value="info"><div className="detail-grid">
 {t(Object.entries(detail.kind === 'customer' ? { [say('كود يورست','Yourrest code')]: detail.data.internalCode, [say('كود العميل في ERP','Customer ERP code')]: detail.data.code, المنطقة: detail.data.region, المدينة: detail.data.city, العنوان: detail.data.address, 'العنوان الوطني المختصر': detail.data.shortAddress, اللوكيشن: detail.data.location, 'المسؤول الأول': detail.data.contact, 'جوال المسؤول الأول': detail.data.phone, 'إيميل المسؤول الأول': detail.data.email, 'المسؤول الثاني': detail.data.contact2, 'جوال المسؤول الثاني': detail.data.phone2, 'إيميل المسؤول الثاني': detail.data.email2, 'نوع العميل': detail.data.customerType, 'حالة التعامل / السحب': detail.data.customerStatus, 'عدد الماكينات حسب الشيت': detail.data.machineCount ?? '', 'أنواع الماكينات حسب الشيت': detail.data.machineTypes, 'مورد القوالب والقطع': detail.data.supplier, 'فئة المصنع': detail.data.category } : detail.kind === 'factory' ? { المصنع: customerFor(detail)?.data.name, 'الماكينة / خط الإنتاج': detail.data.name, 'نوع السجل': detail.data.recordType === 'group' ? 'مجموعة ماكينات' : 'ماكينة', 'إجمالي العدد': detail.data.quantity ?? (detail.data.recordType === 'group' ? 'غير مسجل' : 1), 'الأنواع الأصلية في الشيت': detail.data.sourceMachineTypes, 'شركة الماكينة': detail.data.machineBrand, الموديل: detail.data.machineModel, 'نوع الماكينة': machineTypeLabels[detail.data.machineType] || 'غير محدد', 'رقم الماكينة': detail.data.machineSerial, 'مقاس اللوح': detail.data.boardDimensions, الموقع: detail.data.location } : detail.kind === 'opportunity' ? { المصنع: customerFor(detail)?.data.name, 'الماكينة / الخط': machineFor(detail)?.data.name, 'موديل الماكينة': machineFor(detail)?.data.machineModel, القالب: detail.data.moldType, المنتج: detail.data.product, الأبعاد: detail.data.dimensions, 'عدد التجاويف': detail.data.cavities || 'غير محدد', الكمية: detail.data.quantity, المرحلة: stageLabels[detail.data.stage], القيمة: detail.data.value === null ? 'غير مسعّرة' : money(detail.data.value) + ' ر.س', 'تاريخ الاحتياج': detail.data.requiredAt, 'الإجراء القادم': detail.data.nextAction, 'موعد المتابعة': detail.data.nextDate, 'الاعتماد الفني': detail.data.technicalStatus === 'approved' ? 'معتمد بواسطة ' + detail.data.technicalBy : 'بانتظار المراجعة', 'ملاحظات فنية': detail.data.technicalNotes, 'مرجع الطلب': detail.data.orderRef, 'سبب الفقد': detail.data.lossReason, 'تاريخ الإغلاق': detail.data.closedAt } : detail.kind === 'activity' ? { 'رقم الزيارة': detail.data.visitNumber, 'اسم العميل': customerFor(detail)?.data.name, 'نوع التواصل': activityTypes[detail.data.type], التاريخ: detail.data.date, 'الهدف من الزيارة': detail.data.summary, 'نتيجة الزيارة': visitResult(detail.data), 'تصنيف النتيجة': outcomes[detail.data.outcome], 'لوكيشن الزيارة': detail.data.location, 'موعد المتابعة': detail.data.nextDate, 'الإجراء القادم': detail.data.nextAction, 'بداية الزيارة': formatVisitTime(detail.data.startedAt), 'نهاية الزيارة': formatVisitTime(detail.data.endedAt), 'مدة الزيارة': durationLabel(detail.data) + (durationNeedsReview(detail.data) ? ' · تحتاج مراجعة' : ''), Email: detail.data.recordedByEmail } : { 'رقم العرض': detail.data.number, الحالة: quoteStatus[detail.data.status], الإصدار: detail.data.date, 'صالح حتى': detail.data.validUntil, 'الإجمالي': money(detail.data.total) + ' ر.س', 'الضريبة': money(detail.data.tax) + ' ر.س', الشروط: detail.data.terms }).map(([k, v]) => <div key={k}><span>{t(k)}</span><strong>{t(String(v === null || v === undefined || v === '' ? '—' : v))}</strong></div>))}<div><span>{t("المسؤول")}</span><strong>{t(member(detail.assignedTo))}</strong></div><div><span>{t("فرع يورست المسؤول")}</span><strong>{t(detail.branch)}</strong></div></div>{detail.kind === 'customer' && detail.data.code && (codeCounts.get(detail.data.code) || 0) > 1 && <p className="form-note">{t("رقم العميل ")}{detail.data.code}{t(" مكرر في ملف المصدر لأسماء ومواقع مختلفة. لكل مصنع سجل مستقل.")}</p>}{detail.data.notes && <p className="detail-note">{detail.data.notes}</p>}{detail.kind === 'quote' && <div className="panel">{t(detail.data.items.map((it: any, i: number) => <div className="detail-quote-item" key={i}><strong>{it.description}</strong><span>{t(it.quantity)} × {t(money(it.price))}{t(" ر.س")}</span></div>))}</div>}</TabsContent><TabsContent value="related"><div className="related-list">{t(records.filter(r => r.parentId === detail.id && (detail.kind !== 'customer' || r.kind === 'factory')).map(r => <button key={r.id} onClick={() => setDetailId(r.id)}><span><small>{t(kindNames[r.kind])}</small><strong>{t(title(r))}</strong></span><ChevronLeft size={17}/></button>))}{!records.some(r => r.parentId === detail.id && (detail.kind !== 'customer' || r.kind === 'factory')) && <Empty title={t("لا توجد سجلات مرتبطة")} text={t("أضف السجل التالي من الأزرار بالأعلى.")}/>}</div></TabsContent>{detail.kind === 'customer' && <TabsContent value="visits"><CustomerVisitHistory onDelete={me?.role==='admin'?setDeleting:undefined} canEdit={me?.role!=='rep'} key={detail.id} customer={detail} records={records} members={members} audits={audits} onVisit={r => openVisit(r)} onNew={detail.data._readOnly&&!(me&&isServiceRole(me.role))?undefined:request => openVisit(undefined, detail.id, request?.id)} onQuote={salesWorkspace?setDetailId:undefined}/></TabsContent>}<TabsContent value="history">{t(audits.filter(a => a.recordId === detail.id).map(a => <div className="audit-item" key={a.id}><span className="audit-dot"/><div><strong>{t(a.action)} · {t(a.detail)}</strong><small>{t(a.actor)} · {t(new Date(a.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' }))}</small></div></div>))}</TabsContent></Tabs></>}</SheetContent></Sheet>
 {followupEditor&&me&&<CustomerFollowupDialog key={followupEditor.key} initial={followupEditor.initial} customerId={followupEditor.customerId} records={followupEditor.initial?records:salesRecords} me={me} onClose={()=>setFollowupEditor(null)} onSaved={async queued=>{if(queued)await refreshLocal();else await load();toast.success(queued?say('محفوظ على الجهاز — بانتظار المزامنة','Saved on this device — waiting to sync'):t('تم حفظ المتابعة'));}}/>}
 {visitEditor && me && <CustomerVisitDialog key={visitEditor.editorKey} {...visitEditor} records={records} members={members} me={me} audits={audits} onClose={() => setVisitEditor(null)} onSaved={async queued => { if(queued)await refreshLocal();else await load(); toast.success(queued?say('محفوظ على الجهاز — بانتظار المزامنة','Saved on this device — waiting to sync'):t("تم حفظ الزيارة")); }} onCustomerCreated={createdCustomer} onOpenVisit={r => openVisit(r)} onNewVisit={(customerId, request) => openVisit(undefined, customerId, request?.id)} onOpenCustomer={setDetailId} onOpenQuote={salesWorkspace?setDetailId:()=>{}} onWorkflow={id=>{setVisitEditor(null);setServiceDetailId(id);}} onDelete={r => { setVisitEditor(null); setDeleting(r); }}/>}
 <AlertDialog open={!!deleting} onOpenChange={o => { if (!o && !busy)
        setDeleting(null); }}><AlertDialogContent dir={direction()}><AlertDialogTitle>{t("حذف ")}{deleting ? t(title(deleting)) : t('السجل')}{t("؟")}</AlertDialogTitle><AlertDialogDescription>{t("لا يمكن التراجع عن الحذف. لن يُحذف سجل له سجلات مرتبطة.")}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("إلغاء")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); remove(); }}>{t("حذف السجل")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 {printQuote && <article className="print-document" dir={direction()}><div className="print-head"><img src="/yourrest-logo.png" alt={t("يورست للصناعات")}/><div><h1>{t("عرض سعر")}</h1><p dir="ltr">{printQuote.data.number}</p><p>{t(quoteStatus[printQuote.data.status])}</p></div></div><div className="print-meta"><div><b>{t("السادة / ")}{customerFor(printQuote)?.data.name}</b><p>{customerFor(printQuote)?.data.contact}</p><p>{t("الماكينة / خط الإنتاج: ")}{machineFor(printQuote)?.data.name}</p></div><div><p>{t("التاريخ: ")}{t(printQuote.data.date)}</p><p>{t("صالح حتى: ")}{t(printQuote.data.validUntil)}</p><p>{t("المسؤول: ")}{t(member(printQuote.assignedTo))}</p></div></div><table><thead><tr>{t(['#', 'البيان', 'الكمية', 'سعر الوحدة', 'الإجمالي'].map(h => <th key={h}>{t(h)}</th>))}</tr></thead><tbody>{t(printQuote.data.items.map((it: any, i: number) => <tr key={i}><td>{t(i) + 1}</td><td>{it.description}</td><td>{t(it.quantity)}</td><td>{t(money(it.price))}</td><td>{t(money(lineCents(it.quantity,it.price)/100))}</td></tr>))}</tbody></table><div className="print-totals"><p><span>{t("الإجمالي قبل الخصم")}</span><b>{t(money(printQuote.data.subtotal))}</b></p><p><span>{t("الخصم")}</span><b>{t(money(printQuote.data.discount))}</b></p><p><span>{t("الضريبة (")}{t(printQuote.data.taxRate)}%)</span><b>{t(money(printQuote.data.tax))}</b></p><p className="grand"><span>{t("الإجمالي · ر.س")}</span><b>{t(money(printQuote.data.total))}</b></p></div>{printQuote.data.terms && <section><h3>{t("شروط الدفع والتوريد")}</h3><p className="print-terms">{printQuote.data.terms}</p></section>}<footer>{t("يورست للصناعات · YOUR REST INDUSTRIES")}<br />{t("عرض سعر — لا يُعد فاتورة ضريبية")}</footer></article>}
 </JourneyTrackerProvider>;
}
function Metric({ label, value, note, unit, Icon, accent = 'blue' }: {
    label: string;
    value: string;
    note: string;
    unit?: string;
    Icon: any;
    accent?: string;
}) { useLanguage(); return <article className={'metric ' + accent}><div className="metric-top"><span>{t(label)}</span><span className="metric-icon"><Icon size={21}/></span></div><div className="metric-number"><b>{t(value)}</b>{unit && <span>{t(unit)}</span>}</div><p>{t(note)}</p></article>; }
