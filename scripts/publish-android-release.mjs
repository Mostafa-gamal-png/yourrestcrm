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
  'تنبيه المصانع القريبة: عند اقترابك لمسافة كيلومتر من مصانع مسؤول عنها لم تُسجَّل لها زيارة منذ 60 يومًا أو أكثر، يصلك إشعار واحد يجمعها، الأقرب أولًا، في ساعات تسجيل الموقع.',
  'لا يتكرر تنبيه المصنع نفسه في اليوم نفسه، والضغط على الإشعار يفتح «خريطة المصانع» على أقرب مصنع.',
  'لا يطلب التحديث أذونات جديدة، وتبقى بياناتك والزيارات المحفوظة على الجهاز كما هي.'
 ],en:[
  'Nearby factories: when you come within 1 km of factories you are responsible for that have had no visit for 60 days or more, one notification lists them, nearest first, during the location recording hours.',
  'The same factory is not notified twice in a day; tapping the notification opens the factory map on the nearest one.',
  'The update asks for no new permission; your data and the visits saved on the phone stay as they are.'
 ]},publishedAt:new Date().toISOString()};
const serialized=JSON.stringify(manifest,null,2)+'\n';
fs.mkdirSync(path.join(root,'public/downloads'),{recursive:true});
fs.writeFileSync(path.join(root,'public/downloads',name),bytes);
fs.writeFileSync(path.join(root,'public/downloads/yourrest-crm-android.apk'),bytes);
fs.writeFileSync(path.join(root,'public/app-update.json'),serialized);
fs.writeFileSync(path.join(root,'lib/app-update-release.json'),serialized);
console.log(JSON.stringify(manifest));
