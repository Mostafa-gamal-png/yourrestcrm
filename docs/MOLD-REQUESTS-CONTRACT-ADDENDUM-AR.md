# ملحق عقد طلبات القوالب: ما نُفِّذ فعلًا في تطبيق المنتجات

نُفِّذ جانب تطبيق المنتجات واختُبر على قاعدة بيانات حقيقية بـ 48 اختبارًا للعقد (التوقيع، التحقق، الإنشاء، التكرار، التعديل، الإلغاء، الربط، قفل الإنتاج). هذا الملحق يوضح ما لم يحسمه العقد، ولا يغيّر شيئًا مما فيه. **اعتمد هذه التفاصيل في الـ CRM.**

## حقول الطلب الإلزامية (`requests`)

`crmRequestId`، `requestedAt`، `customer.name`، `salesman.name`، `specs.description`، `specs.core`، `specs.vibrators`، `specs.model`، `specs.halfBlock`، `specs.moldWidth`، `specs.gelbaSize`، `specs.quantity`.

اختيارية: `legacyOrderNo`، `customer.crmNumber` (يُرسَل دائمًا من الـ CRM)، `customer.address`، `customer.city`، `salesman.crmMemberId`، `salesman.email`، `specs.moldNo`، `specs.designUrl`، `specs.notes`.

- الأعداد يجب أن تكون أعدادًا صحيحة في JSON (`1380` وليس `1380.5` ولا `"1380"`)، وإلا `invalid_payload` باسم الحقل.
- `requestedAt` بصيغة ISO 8601 مع إزاحة أو `Z`، ولا يسبق 2020 ولا يزيد على يومين في المستقبل.
- حدود النصوص الفعلية: `customer.name` 200، `customer.address` 300، `customer.city` 100، `salesman.name` 160، `salesman.email` 190 (بريد صحيح)، `specs.description` 200، `specs.moldNo` 40، `specs.designUrl` 1000 (`https://` فقط)، `specs.notes` 2000.

## الردود وسلوك الربط

- طلب جديد: `201`، `created: true`. إعادة الإرسال المطابق: `200` بلا تغيير في `revision`. تعديل وهو `received`: `200` و`revision` يزيد.
- الإنتاج بدأ (الحالة غير `received`) ثم أرسل الـ CRM تعديلًا: `409 request_locked` وفي `error.details.request` الحالة الحالية.
- **الربط التاريخي**: `legacyOrderNo` مع `crmRequestId` جديد يربط صف الشيت (`linked: true`، `created: false`) ولا يعدّل أي حقل. إعادة الإرسال نفسه بعد الربط: `200` و`linked: false` (آمن حتى لو اختلفت بيانات الطلب في الـ CRM عن الشيت). رقم غير موجود أو ليس تاريخيًا: `400 invalid_payload` وفي `fields` الاسم `legacyOrderNo`. صف مربوط أصلًا بمعرّف آخر: `409 request_locked`.
- `status`: يعيد ما وُجد في `requests` وما لم يوجد في `unknown`. الحد الأقصى 200 معرّفًا.
- `cancel`: ينجح وهو `received` فقط، ويكرَّر بلا أثر.
- `orderNo` يصل في كل رد. الطلبات التاريخية 1 إلى 91 كما في الشيت، والجديدة تبدأ من 92 (اعرضه للمندوب باسم «رقم أمر الإنتاج»).

## ملاحظات للتنفيذ في الـ CRM

- الترويستان `X-YR-Timestamp` و`X-YR-Signature` إلزاميتان، والتوقيع على الجسم **بالبايتات المرسلة نفسها** (لا تعِد ترميز JSON بعد التوقيع).
- فرق الساعة المسموح 300 ثانية: تأكد أن ساعة خادم Namecheap مضبوطة.
- لا يوجد عنوان تجريبي حيّ. اختبر مقابل خادم محاكاة يلتزم بهذا العقد، والاختبار الحقيقي الأخير يتم بعد نشر الطرفين.
- لن يُفعَّل الربط عندي قبل ضبط المفتاح السري في ملف على الاستضافة. إن لم يُضبط فالرد `503 not_configured`، وعلى الـ CRM أن يعرض للمندوب «الربط مع الإنتاج غير مفعَّل» ويُبقي الطلب «بانتظار الإرسال».
