# صندوق بنان الخير للبنيان — النظام المحاسبي والإداري

نظام عربي (RTL) لإدارة صندوق خيري: الأعضاء، الاشتراكات الشهرية، سندات القبض والتبرعات،
طلبات الصرف بالاعتماد المزدوج، التقارير، الطباعة، التصدير، الإشعارات الفورية، والنسخ
الاحتياطية.

**الروابط الحالية**

| الخدمة | الرابط |
|---|---|
| نسخة الويب (PWA) | https://abdulhame709.github.io/banan--alkher2026/ |
| تطبيق الأندرويد (APK) | https://github.com/Abdulhame709/banan--alkher2026/releases |
| الكود | https://github.com/Abdulhame709/banan--alkher2026 |
| Supabase | https://supabase.com/dashboard/project/jjzyqgqeevgevmvojyvn |

> دليل الاستخدام خطوة بخطوة: [`docs/دليل-المستخدم.md`](docs/دليل-المستخدم.md)

---

## 1. المعمارية

```
المتصفح / تطبيق الأندرويد (Capacitor)
        │  Supabase Auth (JWT) + REST
        ▼
Supabase Edge Function  /functions/v1/api   (Hono + postgres.js)
        │  Supavisor transaction pooler (5432 → 6543)
        ▼
PostgreSQL (Supabase)  ──  RLS + triggers + realtime
        │
        ├── Supabase Storage: fund-files (مرفقات) + fund-backups (نسخ احتياطية)
        └── Supabase Realtime: fund_events + fund_notifications
```

- **الواجهة:** React 19 + Vite + TypeScript + HashRouter.
- **الاستضافة:** GitHub Pages (نسخة الويب) وGitHub Releases (APK).
- **البيانات:** Supabase PostgreSQL مع RLS.
- **المصادقة:** Supabase Auth (بريد وكلمة مرور).
- **الملفات:** Supabase Storage.
- **التحديث الفوري:** Supabase Realtime (جدول أحداث خفيف `fund_events` + إشعارات).
- **الخادم:** Edge Function واحدة تحافظ على نفس واجهة REST القديمة.
- **المنطقة:** Edge Function تعمل في `ap-southeast-2` (سيدني) بجوار قاعدة البيانات.

---

## 2. الصلاحيات

| الدور | الصلاحيات |
|---|---|
| `admin` | كل شيء: الإعدادات، المستخدمون، النسخ الاحتياطي، الاعتماد، الصرف، التقارير |
| `accountant` | الأعضاء، الاستحقاقات، السندات، طلبات الصرف، التقارير |
| `treasurer` | الاعتماد، الصرف، التقارير |
| `board_member` | الاطلاع والمراجعة والاعتماد حسب الصلاحية |
| `member` | بوابة العضو: استحقاقاته وسنداته وكشف حسابه |

قواعد الاعتماد:

- اعتماد مزدوج مستقل: شخصان مختلفان.
- منشئ الطلب لا يعتمد طلبه.
- الشخص نفسه لا يعتمد الطلب مرتين.
- الرفض نهائي.
- الصرف فقط من `admin` أو `treasurer`، وبعد التحقق من كفاية الرصيد النقدي.

---

## 3. القواعد المالية

```
الرصيد النقدي الفعلي = الرصيد الافتتاحي + المقبوضات − المصروفات المدفوعة
الملتزمات            = طلبات معتمدة لم تُصرف
الصافي المتاح        = الرصيد النقدي الفعلي − الملتزمات
```

- المتأخرات على الأعضاء **لا** تُحسب رصيداً نقدياً.
- السداد الجزئي مسموح، والسداد الزائد ممنوع.
- ترقيم السندات تسلسلي: `REC-0001`، `PV-0001`.
- كل عملية مالية تُسجّل في `fund_audit_logs`، والسجل غير قابل للتعديل أو الحذف.

---

## 4. التشغيل المحلي

### المتطلبات

- Node.js 22.5 أو أحدث (المشروع يستخدم Node 24 محلياً).
- حساب Supabase ومفاتيحه (أو استخدم المشروع الحالي).

### الخطوات

```powershell
npm install
Copy-Item .env.example .env   # ثم عدّل القيم
npm run dev                   # يشغّل Vite على http://localhost:5173
```

قيم Vite المطلوبة في `.env`:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_API_BASE_URL=https://<project-ref>.supabase.co/functions/v1/api
```

> مفتاح `service_role` **لا** يوضع في Vite ولا في الواجهة. يُستخدم فقط داخل Edge Function
> أو سكربتات إدارية محلية.

### أوامر مفيدة

```powershell
npm run typecheck     # فحص TypeScript
npm run build         # بناء dist
npm run preview       # معاينة بناء الإنتاج
npm run icons         # توليد أيقونات PWA
npm run native:assets # توليد أيقونات/شاشات Capacitor
npm run apk:sync      # build + npx cap sync android
```

---

## 5. قاعدة البيانات والترحيلات

الملفات في `supabase/migrations/`:

| الملف | المحتوى |
|---|---|
| `0001_init.sql` | الجداول، RLS، triggers، الإشعارات، bucket المرفقات |
| `0002_realtime_events.sql` | جدول `fund_events` و triggers النشر الفوري |
| `0003_backups.sql` | جدول `fund_backups`، bucket النسخ، صلاحياته |

تطبيق الترحيلات عبر Supabase CLI:

```powershell
npx supabase link --project-ref jjzyqgqeevgevmvojyvn
npx supabase db push
```

أو عبر Management API (كما تم في هذا المشروع):

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<management-api-token>"
# POST /v1/projects/{ref}/database/query  بالـ SQL المطلوب
```

### الجداول الأساسية

`fund_settings`، `fund_user_profiles`، `fund_members`، `fund_subscriptions`،
`fund_receipts`، `fund_expense_requests`، `fund_expense_approvals`،
`fund_audit_logs`، `fund_notifications`، `fund_events`، `fund_backups`،
`fund_device_tokens`، `sequences`.

---

## 6. نشر Edge Function

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<management-api-token>"
npx supabase functions deploy api `
  --project-ref jjzyqgqeevgevmvojyvn `
  --no-verify-jwt
```

- `--no-verify-jwt` مطلوب لأن الدالة تتحقق من الهوية بنفسها وتدعم طلبات الملفات
  والإشعارات.
- الدالة تقرأ `SUPABASE_DB_URL` من بيئة Supabase وتحوّله تلقائياً إلى Supavisor
  transaction pooler.
- الواجهة ترسل `x-region: ap-southeast-2` لتثبيت التنفيذ في سيدني.
- روابط الصور والتنزيل تستخدم `forceFunctionRegion=ap-southeast-2`.

### اختبار سريع

```powershell
curl "https://jjzyqgqeevgevmvojyvn.supabase.co/functions/v1/api/health" `
  -H "x-region: ap-southeast-2"
```

---

## 7. نسخة الويب على GitHub Pages

1. اذهب إلى **Settings → Pages** في المستودع.
2. اختر **Source: GitHub Actions**.
3. ارفع التغييرات إلى الفرع `main`.
4. سيعمل workflow `.github/workflows/deploy-pages.yml` تلقائياً.
5. الرابط: `https://abdulhame709.github.io/banan--alkher2026/`.

الأسرار المطلوبة في **Settings → Secrets and variables → Actions**:

| السر | القيمة |
|---|---|
| `VITE_SUPABASE_URL` | رابط المشروع |
| `VITE_SUPABASE_ANON_KEY` | المفتاح العام anon |
| `VITE_API_BASE_URL` | `https://<ref>.supabase.co/functions/v1/api` |

> لا تضع `service_role` في أسرار Vite. هو مطلوب فقط للـ Edge Function (مضبوط تلقائياً
> في Supabase).

### ملاحظات

- التطبيق يستخدم `HashRouter` و`base: './'` ليعمل على GitHub Pages وعلى مسار فرعي
  وداخل APK.
- الخطوط والأيقونات بمسارات نسبية.
- Service Worker يحدّث نفسه تلقائياً. بعد نشر جديد، حدّث الصفحة مرة واحدة إن ظهرت
  نسخة قديمة.

---

## 8. بناء APK وتوقيعه

المشروع يستخدم Capacitor 8 وAndroid SDK 36.

- الحزمة: `org.banan.fund`
- الاسم: `صندوق بنان الخير`
- الحد الأدنى: أندرويد 7.0 (API 24)
- workflow: `.github/workflows/build-apk.yml`

### الأسرار المطلوبة

| السر | الوصف |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | ملف keystore مشفّر Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | كلمة مرور الـ keystore |
| `ANDROID_KEY_ALIAS` | اسم المفتاح (`banan`) |
| `ANDROID_KEY_PASSWORD` | كلمة مرور المفتاح |

### توليد keystore (مرة واحدة)

```powershell
keytool -genkeypair -v `
  -keystore android/banan-release.keystore `
  -storetype JKS -alias banan -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass "<password>" -keypass "<password>" `
  -dname "CN=Banan Charity Fund, OU=Charity, O=Banan, L=Taiz, ST=Taiz, C=YE"
```

- احتفظ بنسخة آمنة من `android/banan-release.keystore` و`ANDROID_KEYS.txt`.
- **لا ترفعهما إلى GitHub.** كلاهما في `.gitignore`.
- فقدان الـ keystore يعني أن التحديثات المستقبلية ستحتاج حذف التطبيق وإعادة تثبيته.

### البناء

```powershell
npm run build
npx cap sync android
cd android
./gradlew assembleRelease `
  -PbananVersionCode=3 `
  -PbananVersionName=1.0.3
```

أو اترك GitHub Actions يبني وينشر تلقائياً عند الدفع إلى `main`. يظهر الإصدار في
**Releases** باسم `apk-1.0.<رقم التشغيل>`.

> الطباعة تعمل بشكل أفضل في نسخة الويب. تصدير CSV في APK يستخدم قائمة المشاركة
> (Filesystem + Share).

---

## 9. النسخ الاحتياطي والاستعادة

### النسخ

- من **الإعدادات → النسخ الاحتياطية → إنشاء نسخة الآن** (مدير فقط).
- تُحفظ النسخة في bucket خاص `fund-backups`.
- تُسجّل بياناتها في `fund_backups`.
- يحتفظ النظام بآخر 30 نسخة ويحذف الأقدم.
- يمكن تنزيل أي نسخة من زر **تنزيل**.

محتوى الملف:

```json
{
  "format": "banan-fund-backup",
  "version": 1,
  "generated_at": "...",
  "generated_by": { "id": "...", "full_name": "...", "role": "admin" },
  "counts": { "fund_members": 14, "...": 0 },
  "data": {
    "fund_settings": [],
    "fund_user_profiles": [],
    "fund_members": [],
    "fund_subscriptions": [],
    "fund_receipts": [],
    "fund_expense_requests": [],
    "fund_expense_approvals": [],
    "fund_audit_logs": [],
    "sequences": []
  }
}
```

لا تشمل النسخة `auth.users` أو كلمات المرور.

### الاستعادة

الاستعادة عملية حساسة. راجع `docs/استعادة-النسخة.md` (إن وجد) أو:

1. خذ نسخة جديدة من الوضع الحالي.
2. أوقف العمل على النظام مؤقتاً.
3. استخدم سكربت/جلسة SQL لتفريغ الجداول بالترتيب الصحيح وإعادة إدخال البيانات.
4. أعد تمكين trigger سجل التدقيق.
5. اختبر الأرصدة والتقارير بعد الاستعادة.

> لا تستعد نسخة قديمة فوق بيانات جديدة دون نسخة احتياطية من الوضع الحالي.

---

## 10. الأمان

- RLS مفعّل على جداول الصندوق.
- Edge Function تتحقق من JWT وتتحقق من الدور في كل مسار.
- `service_role` يبقى داخل بيئة Supabase فقط.
- سجل التدقيق غير قابل للتعديل أو الحذف (`trg_audit_no_change`).
- ملفات المفاتيح المحلية:
  - `SUPABASE_KEYS.txt` (رابط المشروع، anon، service، Management API، كلمة مرور
    الحسابات التجريبية).
  - `ANDROID_KEYS.txt` (كلمة مرور keystore).
  - كلاهما في `.gitignore`.
- غيّر كلمة مرور المدير التجريبية فور أول دخول من قائمة المستخدم.
- لا تنشر `SUPABASE_KEYS.txt` أو `ANDROID_KEYS.txt` في أي مكان.

---

## 11. الحسابات التجريبية

توجد حسابات تجريبية لأغراض العرض:

| البريد | الدور |
|---|---|
| `admin@banan.org` | مدير النظام |
| `accountant@banan.org` | محاسب |
| `treasurer@banan.org` | أمين صندوق |
| `board@banan.org` | عضو مجلس إدارة |
| `member@banan.org` | عضو |

كلمة المرور المشتركة محفوظة محلياً في `SUPABASE_KEYS.txt` تحت `DEMO_PASSWORD`، وليست
مكتوبة في هذا المستودع. غيّرها فوراً بعد أول دخول.

سكربت البذر يحتاج كلمة مرور قوية:

```powershell
$env:SEED_PASSWORD = "<strong-password>"
node scripts/seed-supabase.mjs
```

---

## 12. هيكل المشروع

```
src/
  components/      الواجهات المشتركة (Layout, NotificationBell, BackupCard, ...)
  lib/             api, auth, supabase, realtime, toast, format
  pages/           Dashboard, Members, Subscriptions, Receipts, Expenses, Reports, Users, Audit, Settings
  types.ts
supabase/
  functions/api/index.ts     Edge Function (Hono)
  migrations/                0001, 0002, 0003
scripts/
  seed-supabase.mjs          بذر بيانات تجريبية
  generate-icons.mjs         أيقونات PWA
  generate-native-assets.mjs أيقونات/شاشات Capacitor
android/                     مشروع Capacitor Android
.github/workflows/           deploy-pages.yml + build-apk.yml
docs/دليل-المستخدم.md
```

---

## 13. استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| صفحة بيضاء بعد النشر | حدّث الصفحة بقوة (Ctrl+F5) أو ألغِ تسجيل Service Worker من إعدادات المتصفح |
| خطأ 401 | انتهت الجلسة. سجّل الدخول من جديد |
| خطأ 403 | دور الحساب لا يملك الصلاحية |
| بطء أول طلب | Cold start للـ Edge Function (2–4 ثوانٍ). الطلبات التالية أسرع |
| فشل رفع ملف | تحقق من الحجم والنوع، ومن تسجيل الدخول |
| فشل بناء APK | راجع سجل GitHub Actions؛ تأكد من أسرار keystore وAndroid SDK 36 |
| فشل نشر Pages | تأكد أن الدفع إلى `main` وأن Pages Source = GitHub Actions |

---

## 14. ملاحظات الخطة المجانية

- Supabase Free: قاعدة بيانات وAuth وStorage وRealtime وEdge Functions ضمن حدود
  الاستخدام المجاني.
- GitHub Pages مجاني للمستودعات العامة.
- GitHub Actions مجاني ضمن دقائق الحساب.
- لا حاجة لخادم شخصي يعمل دائماً.
- راقب حدود Supabase (حجم القاعدة، التخزين، طلبات Edge Function) من لوحة المشروع.

---

## 15. النسخة القديمة (SQLite/Express)

النسخة الأولى (Express + SQLite) محفوظة في الوسم:

```powershell
git checkout sqlite-reference
```

الفرع `main` مخصص الآن لنسخة السحابة (Supabase). لا تستخدم خادم Express في الإنتاج.
