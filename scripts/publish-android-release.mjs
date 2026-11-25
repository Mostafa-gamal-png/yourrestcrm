import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [apkPath,reportPath]=process.argv.slice(2);
if(!apkPath||!reportPath)throw Error('Usage: node scripts/publish-android-release.mjs APK BUILD_VERIFICATION_JSON');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const certificateSha256='1d49b33c2c3039c1c7f3849d91a7890e81616211df9a4958dc470584acc1ff50';
if(report.certificateSha256!==certificateSha256)throw Error('Original APK signing certificate has not been verified');
const gradle=fs.readFileSync(path.join(root,'mobile/android/app/build.gradle'),'utf8');
const versionName=gradle.match(/versionName\s+'([^']+)'/)[1];
const versionCode=Number(gradle.match(/versionCode\s+(\d+)/)[1]);
const bytes=fs.readFileSync(apkPath),sha256=createHash('sha256').update(bytes).digest('hex');
if(report.package!=='org.yourrest.crm'||report.versionName!==versionName||report.versionCode!==versionCode
 ||report.apkSha256!==sha256||report.apkBytes!==bytes.length||!/^\d+\.\d+\.\d+$/.test(versionName))throw Error('APK differs from reviewed build report/version');
const name=`yourrest-crm-android-v${versionName}-${versionCode}.apk`;
// Every published release is mandatory (the owner's rule, taken from GSCO on 2026-10-31): the oldest app allowed is always this one.
// lib/app-update.ts reads the minimum as versionCode whatever is written here, and tests/app-update-release.mjs checks the served file.
const manifest={schemaVersion:1,packageName:report.package,versionName,versionCode,minimumVersionCode:versionCode,
 apkUrl:`https://crm.yourrest.org/downloads/${name}`,sizeBytes:bytes.length,sha256,
 certificateSha256,
 releaseNotes:{ar:[
  'تغيير منطقة حسابك أو وظيفتك لم يعد يوقف تسجيل خط السير ولا يغلق النظام: يستمر التسجيل على المنطقة الجديدة فورًا.',
  'النقاط التي لم تُرفع من المنطقة السابقة تبقى محفوظة على الهاتف وتُرفع على منطقتها السابقة، ويظهر عددها في التطبيق حتى تُرفع.',
  'لا يطلب التحديث أذونات جديدة، وتبقى بياناتك والزيارات المحفوظة على الجهاز كما هي.'
 ],en:[
  'A change of the region or role of your account no longer stops route recording or closes the system: recording continues on the new region at once.',
  'Points not yet uploaded from the earlier region stay on the phone and upload to that region; the app shows how many until they do.',
  'The update asks for no new permission; your data and the visits saved on the phone stay as they are.'
 ]},publishedAt:new Date().toISOString()};
// The update screen shows at most 5 notes of at most 200 characters each (lib/app-update.ts notes): a longer note would be cut.
for(const note of [...manifest.releaseNotes.ar,...manifest.releaseNotes.en])if(note.length>200)throw Error('A release note is longer than 200 characters ('+note.length+'): '+note.slice(0,40)+'…');
if(manifest.releaseNotes.ar.length>5||manifest.releaseNotes.en.length>5)throw Error('More than 5 release notes');
const serialized=JSON.stringify(manifest,null,2)+'\n';
fs.mkdirSync(path.join(root,'public/downloads'),{recursive:true});
fs.writeFileSync(path.join(root,'public/downloads',name),bytes);
fs.writeFileSync(path.join(root,'public/downloads/yourrest-crm-android.apk'),bytes);
fs.writeFileSync(path.join(root,'public/app-update.json'),serialized);
fs.writeFileSync(path.join(root,'lib/app-update-release.json'),serialized);
console.log(JSON.stringify(manifest));
