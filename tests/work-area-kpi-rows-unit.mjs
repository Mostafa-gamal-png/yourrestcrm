// Two modules that no unit test reached, on the real files transpiled into .sites-runtime:
// 1. lib/work-area-editor.ts (the sales manager draws a representative's work area on the map) over a small fake of Leaflet that keeps the
//    contract the editor uses: where a corner goes, drawing, editing, undo, deleting a corner, dragging, the shape, giving the map back.
// 2. lib/service-kpi-rows.ts (what the customer-service evaluation reads from the database) over a fake D1: a damaged or foreign row is
//    left out, the settings are filled from the defaults, nothing is invented. Made-up rows only.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {load}=createLoader('work-area-kpi-rows-unit');
const W=await load('lib/work-area-editor.ts'),R=await load('lib/service-kpi-rows.ts'),KPI=await load('lib/service-kpi.ts');
const {eq,ok,report}=makeChecks(assert);

// ===== 1. the work-area editor
const B=[24.70,46.60];
const sq=[[B[0],B[1]],[B[0],B[1]+0.01],[B[0]+0.01,B[1]+0.01],[B[0]+0.01,B[1]]]; // a square, 1 km sides, going round
eq(W.insertionIndex([],[1,1]),0,'no corner: the first');eq(W.insertionIndex([[1,1]],[2,2]),1,'one corner: after it');
eq(W.insertionIndex(sq,[B[0]+0.005,B[1]+0.0102]),2,'a tap beside the side between corners 2 and 3 goes after corner 2');
eq(W.insertionIndex(sq,[B[0]-0.0002,B[1]+0.005]),1,'a tap beside the first side goes after corner 1');
eq(W.insertionIndex(sq,[B[0]+0.005,B[1]-0.0002]),4,'a tap beside the closing side goes at the end');
eq(W.insertionIndex(sq,[B[0]+0.0102,B[1]+0.005]),3,'a tap beside the third side');

function leaflet(){
 const log={layers:[],markers:[],popups:[],polygon:null,polyline:null,groupRemoved:0,cleared:0,closed:0,dbl:'on',handlers:{}};
 const L={
  layerGroup(){const g={items:[],addTo(){return g;},addLayer(x){g.items.push(x);},clearLayers(){log.cleared++;g.items=[];},remove(){log.groupRemoved++;if(log.removeThrows)throw Error('half-finished drag');}};log.group=g;return g;},
  polygon(points,opts){const p={opts,latlngs:points,setLatLngs(v){p.latlngs=v;}};log.polygon=p;return p;},
  polyline(points,opts){const p={opts,latlngs:points,setLatLngs(v){p.latlngs=v;}};log.polyline=p;return p;},
  divIcon(o){return {divIcon:o};},
  marker(p,opts){const m={p,opts,handlers:{},at:{lat:p[0],lng:p[1]},on(e,cb){m.handlers[e]=cb;return m;},getLatLng(){return m.at;},bindPopup(box,o){m.popup=box;log.popups.push([box,o]);}};log.markers.push(m);return m;}
 };
 const map={handlers:{},on(e,cb){map.handlers[e]=cb;},off(e,cb){if(map.handlers[e]===cb)delete map.handlers[e];},closePopup(){log.closed++;},doubleClickZoom:{disable(){log.dbl='off';},enable(){log.dbl='on';}}};
 return {L,map,log};
}
globalThis.document={createElement:tag=>{const el={tag,children:[],listeners:{},className:'',textContent:'',appendChild(c){el.children.push(c);},addEventListener(e,cb){el.listeners[e]=cb;}};return el;}};
const opts=(env,over={})=>{const changes=[];return {changes,options:{points:[],mode:'draw',color:'#166344',deleteLabel:'حذف النقطة',cornerLabel:'نقطة',onChange:p=>changes.push(p),...over}};};
const click=(env,lat,lng)=>env.map.handlers.click({latlng:{lat,lng}});
{ // drawing
 const env=leaflet(),{changes,options}=opts(env);const ed=W.createAreaEditor(env.L,env.map,options);
 eq([env.log.dbl,typeof env.map.handlers.click],['off','function'],'it listens to the map and turns double-click zoom off');
 eq([ed.points(),env.log.polygon.latlngs,env.log.polyline.latlngs],[[],[],[]],'nothing drawn yet');
 click(env,24.7,46.6);click(env,24.7,46.61);eq(ed.points(),[[24.7,46.6],[24.7,46.61]],'a tap adds a corner');eq([env.log.polygon.latlngs,env.log.polyline.latlngs.length],[[],2],'two corners: a dashed line, no polygon');
 click(env,24.71,46.61);eq([env.log.polygon.latlngs.length,env.log.polyline.latlngs],[3,[]],'three corners: the polygon');eq(changes.length,3,'every change is told');
 eq(env.log.markers.slice(-3).map(m=>m.opts.title),['نقطة 1','نقطة 2','نقطة 3'],'every corner is a marker with a numbered label for a screen reader');eq(env.log.markers.at(-1).opts.alt,'نقطة 3','and an alt text');eq(env.log.markers.at(-1).opts.draggable,true,'dragable');eq(env.log.markers.at(-1).opts.icon.divIcon.iconSize,[44,44],'a 44 pixel target for a finger');
 eq(env.log.polygon.opts.color,'#166344','the colour of the area');
 changes.at(-1)[0][0]=99;eq(ed.points()[0][0],24.7,'what onChange gets is a copy');const got=ed.points();got[0][0]=88;eq(ed.points()[0][0],24.7,'and so is points()');
 // draw mode adds at the end even with three corners
 click(env,24.72,46.6);eq(ed.points().at(-1),[24.72,46.6],'draw mode always appends');
 ed.undo();eq([ed.points().length,changes.length],[3,5],'undo removes the last corner and tells');ed.undo();ed.undo();ed.undo();const n=changes.length;ed.undo();eq([ed.points(),changes.length],[[],n],'undo on nothing changes nothing and tells nobody');
 ed.destroy();eq([env.log.dbl,env.map.handlers.click,env.log.groupRemoved,env.log.closed>0],['on',undefined,1,true],'giving the map back: handler off, double-click zoom on, layers removed, popup closed');
}
{ // editing
 const env=leaflet(),{changes,options}=opts(env,{points:sq,mode:'edit'});const ed=W.createAreaEditor(env.L,env.map,options);
 eq([ed.points(),env.log.polygon.latlngs.length,env.log.markers.length,changes.length],[sq,4,4,0],'the corners given are drawn, nothing told yet');
 click(env,B[0]+0.005,B[1]+0.0102);eq([ed.points().length,ed.points()[2]],[5,[B[0]+0.005,B[1]+0.0102]],'editing: a tap becomes a corner on the nearest side');
 ed.setMode('draw');click(env,B[0]-0.01,B[1]-0.01);eq(ed.points().at(-1),[B[0]-0.01,B[1]-0.01],'draw mode again appends');
 ed.setMode('edit');
 // dragging
 const m=env.log.markers.at(-1);m.at={lat:25,lng:47};m.handlers.drag();eq(ed.points().at(-1),[25,47],'a corner dragged moves the shape at once');const c=changes.length;m.handlers.dragend();eq(changes.length,c+1,'and it is told when the drag ends');
 // deleting a corner through its popup button
 const markers=env.log.markers.slice(-ed.points().length);const before=ed.points().length;const first=markers[0];const button=first.popup.children[0];eq([first.popup.className,button.type,button.className,button.textContent],['work-area-vertex-popup','button','work-area-vertex-delete','حذف النقطة'],'the popup is a button made of text, never markup');button.listeners.click();eq([ed.points().length,env.log.closed>0],[before-1,true],'«حذف النقطة» removes that corner and closes the popup');
 ed.destroy();
}
{ // fewer than three corners always append even in edit mode
 const env=leaflet(),{options}=opts(env,{points:[[1,1],[2,2]],mode:'edit'});const ed=W.createAreaEditor(env.L,env.map,options);click(env,1.5,1.5);eq(ed.points().length,3,'two corners in edit mode: a tap adds one');
 env.log.removeThrows=true;ed.destroy();eq(env.log.dbl,'on','a half-finished drag cannot stop the map from being given back');
}
{ // the corners given are copied
 const env=leaflet(),given=[[1,1],[2,2],[3,3]],{options}=opts(env,{points:given});const ed=W.createAreaEditor(env.L,env.map,options);click(env,4,4);eq([given.length,ed.points().length],[3,4],'the given list is never changed');
}

// ===== 2. the customer-service rows
function d1(handlers){
 const calls=[];
 return {calls,prepare(sql){const stmt={sql,args:[],bind(...a){stmt.args=a;return stmt;},async all(){calls.push(['all',sql,stmt.args]);return {results:handlers.all(sql,stmt.args)};},async first(){calls.push(['first',sql,stmt.args]);return handlers.first(sql,stmt.args);}};return stmt;}};
}
const raw=(id,data,over={})=>({id,branch:'HQ',assignedTo:'m1',data:typeof data==='string'?data:JSON.stringify(data),createdAt:'2026-10-01T06:00:00.000Z',updatedAt:'2026-10-02T06:00:00.000Z',version:3,...over});
{
 const db=d1({all:sql=>{if(/service_audit/.test(sql))return [raw('a1',{kind:'service_audit',n:1}),raw('a2',{kind:'something_else'}),raw('a3','{not json'),raw('a4','null'),raw('a5','5')];if(/service_kpi_month/.test(sql))return [raw('m1',{kind:'service_kpi_month'}),raw('m2','garbage')];return [];},first:()=>null});
 const audits=await R.loadAuditRows(db);eq(audits.map(r=>r.id),['a1'],'only rows of the right kind, damaged and foreign rows left out');eq([audits[0].data.n,audits[0].version,audits[0].assignedTo],[1,3,'m1'],'the row is the stored row with its data parsed');
 ok(/kind='service_audit'/.test(db.calls[0][1])&&/ORDER BY created_at,id/.test(db.calls[0][1]),'read in the order they were made');
 eq((await R.loadMonthRows(db)).map(r=>r.id),['m1'],'the closed months');
}
{
 const db=d1({all:(sql,args)=>{if(/id=\?/.test(sql))return args[0]==='a1'?[raw('a1',{kind:'service_audit'})]:args[0]==='bad'?[raw('bad','{x')]:[];return [];},first:()=>null});
 eq((await R.loadAuditRow(db,'a1')).id,'a1','one audit row by its id');eq(await R.loadAuditRow(db,'nope'),undefined,'no such row');eq(await R.loadAuditRow(db,'bad'),undefined,'a damaged row is not shown');eq(db.calls.at(-1)[2],['bad'],'the id is bound, never written into the text');
 const evil="x' OR '1'='1";await R.loadAuditRow(db,evil);ok(!db.calls.at(-1)[1].includes('OR'),'an id with quotes never reaches the SQL text');
}
{
 const defaults=KPI.normalizeSettings(undefined);
 eq(await R.loadSettings(d1({first:()=>null,all:()=>[]})),{settings:defaults,version:0},'nothing saved: the defaults, version 0');
 const saved=await R.loadSettings(d1({first:(sql,args)=>({data:JSON.stringify(defaults),version:4}),all:()=>[]}));eq([saved.version,saved.settings],[4,KPI.normalizeSettings(defaults)],'saved settings are filled from the defaults');
 eq(await R.loadSettings(d1({first:()=>({data:'{broken',version:9}),all:()=>[]})),{settings:defaults,version:9},'damaged settings: the defaults, the row\'s version kept');
 const db=d1({first:()=>null,all:()=>[]});await R.loadSettings(db);eq(db.calls[0][2],[KPI.SERVICE_KPI_SETTINGS_ID],'the settings row is asked for by its id');
}
{
 const complaintRow=(id,over={})=>raw(id,{kind:'complaint',customerId:'c1',registrarId:'m1',serviceManagerId:'m2',severity:'high',resolvedAt:null,events:[]},over);
 const db=d1({all:sql=>/FROM crm_records WHERE kind='complaint'/.test(sql)?[complaintRow('k1'),raw('k2',{kind:'complaint'}),raw('k3','{bad'),raw('k4',{kind:'support',customerId:'c'})]:/crm_service_cases/.test(sql)?[{id:'s1',customerId:'c1',status:'open',creatorId:'m1',data:JSON.stringify({approvedAt:null}),branch:'HQ',assignedTo:'',createdAt:'x',updatedAt:'y',version:1},{id:'s2',customerId:'c1',status:'open',creatorId:'m1',data:'{bad',branch:'',assignedTo:'',createdAt:'x',updatedAt:'y',version:1}]:[],first:()=>null});
 eq((await R.loadComplaintsForKpi(db)).map(r=>r.id),['k1'],'complaints: only complete complaint rows');ok(/json_object\('kind'/.test(db.calls[0][1])&&!/description|note|phone/i.test(db.calls[0][1]),'the projection carries no description, note or contact');
 const cases=await R.loadServiceCasesForKpi(db);eq(cases.map(c=>c.id),['s1'],'service cases: a damaged row is left out');eq(cases[0].data,{approvedAt:null},'its data parsed');ok(!/description|note|phone/i.test(db.calls.at(-1)[1]),'the case projection carries only what the figures use');
}
{
 const seen=[];const members=[{id:'m1',name:'ن'}];
 const db=d1({all:sql=>{seen.push(sql);return [];},first:()=>null});
 const out=await R.loadServiceKpiInput(db,members);
 eq([Object.keys(out.input).sort(),out.settingsVersion,out.input.members===members,out.input.conversions],[['audits','closed','complaints','conversions','members','serviceCases','settings','support'],0,true,[]],'everything the evaluation is computed from, no conversions by default');
 eq(out.input.settings,KPI.normalizeSettings(undefined),'default settings');
 const conv=[{x:1}];eq((await R.loadServiceKpiInput(db,members,Promise.resolve(conv))).input.conversions,conv,'the conversions handed over by the route are used');
 ok(seen.length>=6,'every source is read');
}
report();
