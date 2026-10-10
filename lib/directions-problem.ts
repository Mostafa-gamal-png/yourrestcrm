/** User-facing failures for selection and external Maps launch. Never collapse
 * an APK upgrade or denied permission into an unexplained spinning button. */
export function directionsProblem(problem:string,language:string):string{
 const say=(ar:string,en:string)=>language==='ar'?ar:en;
 if(/native_upgrade_required/.test(problem))return say('يلزم تحديث تطبيق أندرويد إلى 1.0.7 لتسجيل خط السير. ثبّت الملف الجديد فوق النسخة الموجودة دون حذف التطبيق.','Update the Android app to 1.0.7 for route recording. Install over the existing app without uninstalling.');
 if(/permission_denied|background_permission_required|إذن|أذونات|اسمح|الموقع طوال الوقت/i.test(problem))return say('راجع أذونات التطبيق: اسمح بالموقع الدقيق وطوال الوقت، ثم ارجع واضغط الاتجاهات.','Allow precise location and background location for this app, then return and tap Directions.');
 if(/native_pending_sync/.test(problem))return say('لم تنتهِ مزامنة بيانات خط السير السابقة. راجع الإنترنت ثم أعد المحاولة؛ البيانات المحفوظة لم تُحذف.','Earlier route data has not finished syncing. Check your connection and retry; saved data is retained.');
 if(/native_unavailable|native_invalid_state/.test(problem))return say('تعذر الاتصال بخدمة التطبيق على الهاتف. أغلق التطبيق وافتحه، وتأكد من تثبيت نسخة 1.0.7.','Could not reach the phone’s app service. Reopen the app and make sure version 1.0.7 is installed.');
 if(/native_session_changed|تغير الحساب|تغير المستخدم/.test(problem))return say('تغيّر الحساب أثناء بدء الرحلة. أعد فتح صفحة الخريطة واختر العميل من حسابك الحالي.','The account changed while starting the trip. Reopen the map and select the customer from the current account.');
 if(/maps_launch_failed:/.test(problem))return say('تعذر فتح Google Maps أو المتصفح. تأكد من تثبيت وتفعيل أحدهما ثم اضغط «فتح Google Maps». حالة تسجيل الرحلة موضحة بشكل مستقل.','Neither Google Maps nor a browser could open. Enable one of them, then tap Open Google Maps. Trip recording has a separate status.');
 if(problem)return problem;
 return say('تعذر بدء تسجيل الرحلة. راجع حالة خدمة الموقع والاتصال الظاهرة في التطبيق ثم أعد المحاولة.','Could not start trip recording. Check the app’s location service and connection status, then retry.');
}
