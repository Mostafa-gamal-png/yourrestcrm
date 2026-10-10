// The actual theme preference and React switch, with denied storage and cross-tab events.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
const root=process.env.YOURREST_UI_SOURCE_ROOT||process.cwd();
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const compile=file=>ts.transpileModule(source(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(a,m)=>{assert(a,m);checks++;};
function environment(saved,blocked=false){
 let value=saved,dark=false,meta='',writes=0;
 const document={documentElement:{classList:{contains:key=>key==='dark'&&dark,toggle:(key,next)=>{if(key==='dark')dark=next;}},style:{}},querySelector:selector=>selector==='meta[name="theme-color"]'?{setAttribute:(key,next)=>meta=next}:null};
 const localStorage={getItem:key=>{if(blocked)throw Error('Denied storage');return key==='yr-theme'?value:null;},setItem:(key,next)=>{if(blocked)throw Error('Denied storage');if(key==='yr-theme'){value=next;writes++;}}};
 return{document,localStorage,get dark(){return dark;},get saved(){return value;},get meta(){return meta;},get writes(){return writes;},setSaved:next=>value=next};
}
function controller(env){const exports={};vm.runInNewContext(compile('lib/theme.ts'),{exports,document:env.document,localStorage:env.localStorage});return exports;}
// Run the same denied-storage click against the previous real topbar handler when requested.
// This demonstrates the pre-existing exception, rather than merely testing a missing component.
function clickHandler(text,legacy=false){
 const file=ts.createSourceFile('theme.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let handler;
 function visit(node){
  if(ts.isJsxOpeningElement(node)&&node.tagName.getText(file)==='button'){
   const attrs=node.attributes.properties;
   const matches=attrs.some(attr=>ts.isJsxAttribute(attr)&&((legacy&&attr.name.text==='title'&&attr.initializer?.getText(file).includes('تبديل المظهر'))||(!legacy&&attr.name.text==='className'&&attr.initializer?.getText(file).includes('theme-toggle-control'))));
   if(matches)handler=attrs.find(attr=>ts.isJsxAttribute(attr)&&attr.name.text==='onClick')?.initializer?.expression?.getText(file);
  }
  ts.forEachChild(node,visit);
 }
 visit(file);assert(handler,'Real theme click handler found');return handler;
}
const revision=process.env.YR_THEME_SOURCE_REV;
const clickSource=revision?execFileSync('git',['show',revision+':app/crm-app.tsx'],{cwd:root,encoding:'utf8'}):source('app/theme-toggle.tsx');
const deniedClick=environment(null,true);let checked=false;
const handlerModule={exports:{}};
vm.runInNewContext(ts.transpileModule('exports.click = '+clickHandler(clickSource,!!revision)+';',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:handlerModule.exports,document:deniedClick.document,localStorage:deniedClick.localStorage,dark:false,setDark:next=>checked=next,saveTheme:theme=>controller(deniedClick).saveTheme(theme)});
assert.doesNotThrow(()=>handlerModule.exports.click(),'Theme click must not throw when browser storage is denied');checks++;
eq(checked,true);eq(deniedClick.dark,true);
if(revision){console.log(JSON.stringify({ok:true,checks,revision,regression:'denied-storage theme click'}));process.exit(0);}
for(const saved of [null,'light','dark','unexpected']){
 const env=environment(saved),theme=controller(env);eq(theme.readTheme(),saved==='dark'?'dark':'light');theme.applyTheme(theme.readTheme());eq(env.dark,saved==='dark');eq(env.document.documentElement.style.colorScheme,saved==='dark'?'dark':'light');eq(env.writes,0,'Restoring preference never changes saved data');
 theme.saveTheme('dark');eq(env.saved,'dark');eq(env.dark,true);eq(env.meta,'#101b18');theme.saveTheme('light');eq(env.saved,'light');eq(env.dark,false);eq(env.meta,'#166344');
}
const blocked=environment(null,true),safe=controller(blocked);eq(safe.readTheme(),'light');safe.saveTheme('dark');eq(blocked.dark,true,'Denied storage still changes current document');eq(safe.readTheme(),'dark','Denied storage preserves the in-session choice');safe.saveTheme('light');eq(blocked.dark,false);
// Early restoration does not wait for login, network, React, or the offline account snapshot.
for(const saved of ['dark','light']){const env=environment(saved);vm.runInNewContext(source('public/theme-bootstrap.js'),{document:env.document,localStorage:env.localStorage});eq(env.dark,saved==='dark');eq(env.document.documentElement.style.colorScheme,saved);eq(env.writes,0);}
vm.runInNewContext(source('public/theme-bootstrap.js'),{document:blocked.document,localStorage:blocked.localStorage});checks++;
function harness(locale='ar',saved='light',denied=false){
 const env=environment(saved,denied),theme=controller(env),listeners=new Map(),state=[],effects=[],cleanups=[];let cursor=0,language=locale;
 const React={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],next=>state[i]=typeof next==='function'?next(state[i]):next];},useEffect(effect){const i=cursor++;if(!(i in state)){state[i]=true;effects.push(effect);}}};
 const window={addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name,handler)=>{if(listeners.get(name)===handler)listeners.delete(name);}};
 const exports={};vm.runInNewContext(compile('app/theme-toggle.tsx'),{exports,document:env.document,window,require:name=>name==='react'?React:name==='react/jsx-runtime'?jsx:name==='@/lib/theme'?theme:name==='@/lib/i18n'?{useLanguage:()=>({language})}:name==='lucide-react'?{Moon:()=>null,Sun:()=>null}:name.endsWith('.css')?{}:(()=>{throw Error(name);})()});
 const render=()=>{cursor=0;const tree=exports.default();for(const effect of effects.splice(0)){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}return tree;};
 const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
 return{env,listeners,render,button:()=>nodes(render()).find(node=>node.type==='button'),locale:next=>language=next,event:key=>listeners.get('storage')?.({key}),unmount:()=>cleanups.forEach(fn=>fn())};
}
for(const language of ['ar','en']){
 const h=harness(language,'dark');h.render();let b=h.button();eq(b.props.role,'switch');eq(b.props.type,'button');eq(b.props['aria-label'],language==='ar'?'الوضع الليلي':'Dark mode');eq(b.props['aria-checked'],true);eq(h.env.dark,true);eq(h.listeners.size,1);
 b.props.onClick();eq(h.env.dark,false);b=h.button();eq(b.props['aria-checked'],false);eq(b.props['aria-label'],language==='ar'?'الوضع الليلي':'Dark mode','Accessible name remains stable as state changes');eq(h.env.saved,'light');
 b.props.onClick();b.props.onClick();eq(h.env.dark,false,'Two clicks before React renders use latest document state');eq(h.button().props['aria-checked'],false);
 h.env.setSaved('dark');h.event('unrelated');eq(h.env.dark,false,'Other application preferences do not change the theme');h.event('yr-theme');eq(h.env.dark,true,'Another CRM tab applies its latest preference');eq(h.button().props['aria-checked'],true);h.env.setSaved(null);h.event(null);eq(h.env.dark,false,'Clearing saved preferences resets theme consistently');
 h.locale(language==='ar'?'en':'ar');eq(h.button().props['aria-label'],language==='ar'?'Dark mode':'الوضع الليلي');h.unmount();eq(h.listeners.size,0,'Unmount releases the storage listener');
}
const denied=harness('ar',null,true);denied.render();denied.button().props.onClick();eq(denied.env.dark,true);eq(denied.button().props['aria-checked'],true,'Storage failures cannot strand the switch');denied.unmount();
// Contrast checks cover the tokens used by tables, dialogs, menus, forms and navigation.
const css=source('app/globals.css');
const luminance=color=>{let hex=color.slice(1);if(hex.length===3)hex=[...hex].map(c=>c+c).join('');const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
for(const selector of [':root',':root.dark']){
 const block=css.slice(css.indexOf(selector+'{')).split('}')[0],tokens=Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[\da-f]{3,6})(?=;|$)/gi)].map(m=>[m[1],m[2]]));
 for(const [text,surface] of [['foreground','background'],['foreground','card'],['muted-foreground','card'],['popover-foreground','popover'],['sidebar-foreground','sidebar'],['primary','card']])ok(contrast(tokens[text],tokens[surface])>=4.5,`${selector} ${text} on ${surface} meets 4.5:1`);
}
ok(contrast('#fff','#217c56')>=4.5,'Primary button white text remains readable at its lightest gradient stop');
ok(css.includes('@custom-variant dark (&:where(.dark, .dark *));'),'Explicit saved preference controls Tailwind menus as well as CSS tokens');
ok(css.includes('.dark .leaflet-tile-pane{filter:'),'Dark map shades raster tiles');ok(!/\.dark \.leaflet-container\{filter:/.test(css),'Map markers and route colors are never inverted');
ok(source('app/layout.tsx').includes('<script src="/theme-bootstrap.js"/>'),'Online shell restores theme before hydration');
const offline=source('scripts/build-offline-shell.mjs');ok(offline.includes('<script src="/theme-bootstrap.js"></script>'));ok(offline.includes("'/theme-bootstrap.js'"),'Offline asset inventory includes early restoration');
ok(source('app/theme-toggle.css').includes('@media(prefers-reduced-motion:reduce)'),'Switch animation respects reduced motion');
console.log(JSON.stringify({ok:true,checks,realBrowser:false,coverage:['real theme preference','safe denied storage','early online/offline restoration','AR/EN accessible switch','rapid click state','cross-tab synchronization','listener cleanup','theme token text contrast','class-based menus and map marker preservation']}));
