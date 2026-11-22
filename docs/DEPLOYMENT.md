# نشر تريملي على Supabase و Vercel

دليل النشر خطوة بخطوة. كل الخطوات قابلة للتكرار بأمان (idempotent).

## البنية

| المكوّن | الخدمة | ملاحظات |
|---|---|---|
| قاعدة البيانات | Supabase Postgres | التطبيق يتصل عبر الـ pooler (منفذ 6543) |
| تخزين الصور والفيديو | Supabase Storage | حاوية عامة `tremly-media` |
| المهمة الخلفية كل دقيقة | Supabase pg_cron + pg_net | تستدعي `/api/cron/tick` بسرّ محفوظ في Vault |
| التطبيق | Vercel (Next.js) | المنطقة الافتراضية `fra1` (فرانكفورت) بجوار Supabase `eu-central-1` |

> **إقامة البيانات (PDPL):** المنطقتان المقترحتان خارج المملكة. نظام حماية البيانات الشخصية يضع شروطاً على نقل البيانات خارج المملكة. راجع ذلك مع مستشار قانوني قبل الإطلاق. البديل هو استضافة داخل المملكة، ويعمل الكود على أي PostgreSQL وأي خادم Node.

## 1) Supabase

1. أنشئ مشروعاً من https://supabase.com/dashboard، واحفظ كلمة مرور قاعدة البيانات في مكان آمن.
2. من **Project Settings → Database → Connection string**:
   - **Transaction pooler** (المنفذ 6543): يوضع في `DATABASE_URL` على Vercel، مع إضافة `?sslmode=require`.
   - **Session pooler أو Direct** (المنفذ 5432): يوضع في `MIGRATION_DATABASE_URL` للترحيلات فقط.
3. أنشئ رمز وصول شخصي من **Account → Access Tokens**، ثم شغّل الأمر التالي بعد نشر Vercel لأنه يحتاج الرابط النهائي:

```bash
SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=<ref> \
APP_URL=https://<your-app>.vercel.app CRON_SECRET=<same as Vercel> \
npm run supabase:setup
```

هذا الأمر يطبّق الترحيلات، وينشئ حاوية التخزين، ويجدول المهمة الخلفية كل دقيقة.

بديل بدون رمز وصول: `MIGRATION_DATABASE_URL=... npm run db:migrate`، ثم إنشاء الحاوية والجدولة يدوياً من لوحة Supabase.

## 2) Vercel

1. استورد المستودع من GitHub. يمكن أيضاً النشر بدون GitHub: `npx vercel deploy --prod`.
2. أضف متغيرات البيئة التالية في **Production**:

| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | رابط الـ Transaction pooler (6543) مع `?sslmode=require` |
| `APP_URL` | `https://<your-domain>` |
| `APP_SECRET` | ناتج الأمر `openssl rand -hex 32` |
| `CRON_SECRET` | ناتج الأمر `openssl rand -hex 24`، ويجب أن يطابق قيمة Supabase |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | من **Project Settings → API** (سرّي) |
| `SUPABASE_STORAGE_BUCKET` | `tremly-media` |
| `SMS_PROVIDER` | `unifonic` أو `taqnyat`، ومعه مفاتيحه |
| `MOYASAR_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `WHATSAPP_*`, `NEXT_PUBLIC_GA_ID` | عند توفرها |

> **مهم:** لا تضع `SMS_PROVIDER=console` في الإنتاج، فالتطبيق يرفض التشغيل بها. إذا لم يتوفر مزود SMS بعد، اترك `SMS_PROVIDER=none`. سيعمل الموقع للتصفح، لكن تسجيل دخول العملاء لن يعمل حتى يُربط المزود.

3. انشر المشروع، ثم تحقق من الحالة عبر `https://<domain>/api/health`. النتيجة المتوقعة: `{"ok":true,"db":"up",...}`.
4. أنشئ أول مدير للمنصة:
   `MIGRATION_DATABASE_URL=... ADMIN_PASSWORD='...' npx tsx scripts/create-admin.ts admin@domain.sa +9665XXXXXXXX "الاسم"`
5. اربط النطاق الخاص (مثل tremly.sa) من **Settings → Domains**، ثم حدّث `APP_URL`، وأعد تشغيل `npm run supabase:setup` لتحديث رابط المهمة الخلفية.

## 3) بعد النشر

- **Moyasar:** اضبط الـ webhook على `https://<domain>/api/payments/webhook`.
- **محركات البحث:** أرسل `https://<domain>/sitemap.xml` إلى Google Search Console.
- **النسخ الاحتياطي:** فعّل Point-in-Time Recovery في Supabase (خطة Pro).
- **خطة Vercel:** ملف `vercel.json` يحتوي جدولة يومية احتياطية واحدة فقط، لأن خطة Hobby لا تسمح بأكثر من ذلك. الجدولة الفعلية كل دقيقة تتم من Supabase pg_cron.
