// After the owner approved a pilot Android release on the live site («اعتماد التحديث للجميع», lib/app-release-approval.ts), the next code
// release makes it the base: lib/app-update-release.json, public/app-update.json and the unversioned APK become the approved version, and the
// pilots at or below it leave lib/app-update-pilots.json. The screens that name the version or link the APK at build time (the tracking gate,
// the day report, the install card, the team screen) then name the version every phone is already asked for. Run it only for a version the
// live site shows as approved («APPROVED PILOT» of scripts/diagnose/app-versions.cjs): promoting a version nobody approved makes it mandatory at once.
//   node scripts/promote-android-pilot.mjs <versionCode> [--root <folder>]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2),at=args.indexOf('--root');
const root=at>=0?path.resolve(args[at+1]):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const code=Number(args.find((arg,index)=>!arg.startsWith('--')&&!(at>=0&&index===at+1)));
if(!Number.isSafeInteger(code)||code<=0)throw Error('Usage: node scripts/promote-android-pilot.mjs <versionCode>');
const pilotsPath=path.join(root,'lib/app-update-pilots.json'),basePath=path.join(root,'lib/app-update-release.json');
const pilots=JSON.parse(fs.readFileSync(pilotsPath,'utf8')),base=JSON.parse(fs.readFileSync(basePath,'utf8'));
const pilot=pilots.find(item=>item.versionCode===code);
if(!pilot)throw Error('No pilot with version code '+code);
if(pilot.versionCode<=base.versionCode)throw Error('The pilot is not newer than the base release ('+base.versionName+')');
const name=new URL(pilot.apkUrl).pathname.split('/').pop(),bytes=fs.readFileSync(path.join(root,'public/downloads',name));
if(bytes.length!==pilot.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==pilot.sha256.toLowerCase())throw Error('The pilot APK differs from its manifest');
const serialized=JSON.stringify({...pilot,minimumVersionCode:pilot.versionCode},null,2)+'\n';
fs.writeFileSync(path.join(root,'public/downloads/yourrest-crm-android.apk'),bytes);
fs.writeFileSync(path.join(root,'public/app-update.json'),serialized);
fs.writeFileSync(basePath,serialized);
fs.writeFileSync(pilotsPath,JSON.stringify(pilots.filter(item=>item.versionCode>code),null,2)+'\n');
console.log(JSON.stringify({promoted:pilot.versionName,versionCode:code,pilotsLeft:pilots.filter(item=>item.versionCode>code).length}));
