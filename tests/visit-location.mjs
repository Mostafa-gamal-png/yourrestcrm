import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync('lib/visit-location.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
function setup(){const exports={},timers=new Map();let next=0;vm.runInNewContext(source,{exports,Date,Error,setTimeout:(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)});return{...exports,timers,expire:()=>{for(const {callback} of [...timers.values()])callback();}};}
const position={coords:{latitude:21.5,longitude:39.2,accuracy:12.2},timestamp:Date.parse('2026-10-01T12:00:00Z')};
let h=setup(),options;
const captured=await h.captureVisitLocation({getCurrentPosition:(success,error,settings)=>{options=settings;success(position);}});eq(captured.location,'21.5000000, 39.2000000');eq(captured.locationCapturedAt,'2026-10-01T12:00:00.000Z');eq(captured.locationSource,'device');eq(captured.locationAccuracy,12);eq(options.maximumAge,0);eq(options.enableHighAccuracy,true);eq(h.timers.size,0);
for(const patch of [{coords:{...position.coords,latitude:NaN}},{coords:{...position.coords,longitude:181}},{coords:{...position.coords,accuracy:-1}},{timestamp:NaN},{timestamp:0},{timestamp:1e20}]){h=setup();await assert.rejects(h.captureVisitLocation({getCurrentPosition:success=>success({...position,...patch})}),/موقع صحيح/);checks++;eq(h.timers.size,0);}
for(const [code,message] of [[1,'السماح بالموقع مقفول'],[2,'تعذر تحديد الموقع'],[3,'انتهت مهلة']]){h=setup();await assert.rejects(h.captureVisitLocation({getCurrentPosition:(success,error)=>error({code})}),new RegExp(message));checks++;eq(h.timers.size,0);}
h=setup();await assert.rejects(h.captureVisitLocation(undefined),/غير متاح/);checks++;
h=setup();await assert.rejects(h.captureVisitLocation({getCurrentPosition:()=>{throw Error('Native permission crashed');}}),/تعذر بدء/);checks++;eq(h.timers.size,0);
// A WebView that never resolves location cannot disable Save forever; late callbacks are ignored.
h=setup();let late;const pending=h.captureVisitLocation({getCurrentPosition:success=>late=success});eq([...h.timers.values()][0].delay,22000);h.expire();await assert.rejects(pending,/انتهت مهلة/);checks++;late(position);eq(h.timers.size,0);
h=setup();const controller=new AbortController();const canceled=h.captureVisitLocation({getCurrentPosition:success=>late=success},controller.signal);controller.abort();await assert.rejects(canceled,/إلغاء/);checks++;late(position);eq(h.timers.size,0);
console.log(JSON.stringify({ok:true,checks,coverage:'real GPS-only capture, exact timestamps, bad fix validation, missing callbacks/deadline, cancellation, permission retries',realDevice:false}));
