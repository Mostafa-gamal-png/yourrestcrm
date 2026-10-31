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
const manifest={schemaVersion:1,packageName:report.package,versionName,versionCode,
 apkUrl:`https://crm.yourrest.org/downloads/${name}`,sizeBytes:bytes.length,sha256,
 certificateSha256,
 releaseNotes:{ar:[
  'إشعار على الهاتف عند تحويل طلب من خدمة العملاء إليك، حتى والتطبيق مغلق أو الشاشة مقفلة.',
  'يتحقق التطبيق من الطلبات الجديدة كل عشر دقائق في ساعات العمل (6 صباحًا إلى 6 مساءً عدا الجمعة) وعند فتحه.',
  'تبقى بياناتك والزيارات المحفوظة على الجهاز كما هي بعد التحديث.'
 ],en:[
  'A phone notification when customer service assigns a request to you, even with the app closed or the screen locked.',
  'The app checks for new requests every ten minutes in working hours (6 a.m. to 6 p.m. except Friday) and when opened.',
  'Your data and the visits saved on the phone stay as they are after the update.'
 ]},publishedAt:new Date().toISOString()};
const serialized=JSON.stringify(manifest,null,2)+'\n';
fs.mkdirSync(path.join(root,'public/downloads'),{recursive:true});
fs.writeFileSync(path.join(root,'public/downloads',name),bytes);
fs.writeFileSync(path.join(root,'public/downloads/yourrest-crm-android.apk'),bytes);
fs.writeFileSync(path.join(root,'public/app-update.json'),serialized);
fs.writeFileSync(path.join(root,'lib/app-update-release.json'),serialized);
console.log(JSON.stringify(manifest));
