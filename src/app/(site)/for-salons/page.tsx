import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDict } from "@/lib/i18n";
import { CITIES } from "@/lib/i18n/dict";
import { currentUser, requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { fd, runAction } from "@/lib/actions";
import { Flash } from "@/components/ui";
import { audit } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { salonMemberships } from "@/lib/auth/rbac";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.forSalons, description: t.home.partnerSub, alternates: { canonical: "/for-salons" } };
}

const Schema = z.object({
  name_ar: z.string().min(2).max(120), name_en: z.string().max(120).optional(), audience: z.enum(["women", "men"]),
  category: z.enum(["salon", "barbershop", "spa", "nails", "makeup", "skincare", "grooming"]),
  cr: z.string().regex(/^\d{10}$/, "Commercial registration must be 10 digits"), vat: z.string().regex(/^(\d{15})?$/, "VAT number must be 15 digits").optional(),
  phone: z.string().min(9).max(20), email: z.string().email(), city: z.string().min(2), neighborhood: z.string().max(80).optional(), address: z.string().max(300).optional(),
});

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

async function register(formData: FormData) {
  "use server";
  await runAction("/for-salons", async () => {
    const u = await requireUser();
    const f = fd(formData);
    const d = Schema.parse({
      name_ar: f.str("name_ar"), name_en: f.str("name_en") || undefined, audience: f.str("audience"), category: f.str("category"), cr: f.str("cr"), vat: f.str("vat") || undefined,
      phone: f.str("phone"), email: f.str("email"), city: f.str("city"), neighborhood: f.str("neighborhood") || undefined, address: f.str("address") || undefined,
    });
    let slug = slugify(d.name_en ?? "") || "salon";
    if (slug.length < 3) slug = `salon-${slug}`;
    const [exists] = await sql`select 1 from salons where slug = ${slug}`;
    if (exists) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 80);
    const salonId = await sql.begin(async (tx) => {
      const [s] = await tx<{ id: string }[]>`insert into salons (slug, name_ar, name_en, audience, category, commercial_registration, vat_number, phone, email, status, show_staff_photos, created_by)
        values (${slug}, ${d.name_ar}, ${d.name_en ?? null}, ${d.audience}, ${d.category}, ${d.cr}, ${d.vat ?? null}, ${d.phone}, ${d.email}, 'draft', ${d.audience === "men"}, ${u.id}) returning id`;
      await tx`insert into salon_members (salon_id, user_id, role) values (${s.id}, ${u.id}, 'owner')`;
      const [b] = await tx<{ id: string }[]>`insert into salon_branches (salon_id, name_ar, name_en, city, neighborhood, address_ar, phone) values (${s.id}, 'الفرع الرئيسي', 'Main branch', ${d.city}, ${d.neighborhood ?? null}, ${d.address ?? null}, ${d.phone}) returning id`;
      for (let w = 0; w < 7; w++) await tx`insert into branch_hours (branch_id, weekday, open_time, close_time) values (${b.id}, ${w}, ${w === 5 ? "16:00" : "10:00"}, ${w === 5 ? "23:00" : "22:00"})`;
      if (u.role === "customer") await tx`update users set role = 'salon_owner' where id = ${u.id}`;
      await audit(u.id, "salon.registered", "salon", s.id, { name: d.name_ar }, tx);
      return s.id;
    });
    void salonId;
    redirect("/dashboard?ok=" + encodeURIComponent("✓"));
  });
}

export default async function ForSalons({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const user = await currentUser();
  const mine = user ? await salonMemberships(user.id) : [];
  const ar = locale === "ar";
  const perks = ar
    ? ["حجوزات أونلاين على مدار الساعة", "تقويم ذكي يمنع تضارب المواعيد", "إدارة الموظفين والجداول والإجازات", "مدفوعات إلكترونية وعربون ونقدي", "تقارير الإيرادات والتسويات", "عروض وأكواد خصم"]
    : ["24/7 online bookings", "Smart calendar that prevents double booking", "Staff, schedules and days-off", "Online, deposit and cash payments", "Revenue and settlement reports", "Promotions and discount codes"];
  return (
    <div className="container-x py-10">
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h1 className="font-display text-4xl font-semibold">{t.home.partner}</h1>
          <p className="mt-3 text-lg text-muted">{t.home.partnerSub}</p>
          <ul className="mt-6 space-y-3">{perks.map((p) => <li key={p} className="flex gap-2"><span className="text-plum-700">✓</span>{p}</li>)}</ul>
          <p className="mt-6 text-sm text-muted">{ar ? "تعمل تريملي بنظام العمولة على الحجوزات المكتملة فقط — بدون رسوم اشتراك." : "TREMLY charges commission on completed bookings only — no subscription fees."}</p>
        </div>
        <div className="card p-6">
          <Flash sp={sp} t={t} />
          {!user ? (
            <div className="space-y-4 text-center">
              <p>{ar ? "سجّل الدخول برقم جوالك أولاً لإنشاء حساب الشريك." : "Sign in with your mobile number first to create your partner account."}</p>
              <Link className="btn-primary" href="/login?next=/for-salons">{t.nav.login}</Link>
            </div>
          ) : (
            <>
              {mine.length > 0 && <p className="mb-4 rounded-xl bg-plum-50 p-3 text-sm">{ar ? "لديك صالون مسجل بالفعل." : "You already have a salon."} <Link className="font-semibold text-plum-700" href="/dashboard">{t.nav.dashboard} →</Link></p>}
              <form action={register} className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">{ar ? "اسم الصالون (عربي)" : "Salon name (Arabic)"}</label><input name="name_ar" className="input" required /></div>
                <div><label className="label">{ar ? "اسم الصالون (إنجليزي)" : "Salon name (English)"}</label><input name="name_en" className="input" dir="ltr" /></div>
                <div><label className="label">{ar ? "الفئة" : "Audience"}</label><select name="audience" className="input"><option value="women">{t.audience.women}</option><option value="men">{t.audience.men}</option></select></div>
                <div><label className="label">{ar ? "النوع" : "Type"}</label><select name="category" className="input">{Object.entries(t.category).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div><label className="label">{ar ? "رقم السجل التجاري" : "Commercial registration (CR)"}</label><input name="cr" className="input" inputMode="numeric" pattern="\d{10}" dir="ltr" required /></div>
                <div><label className="label">{ar ? "الرقم الضريبي" : "VAT number"} ({t.common.optional})</label><input name="vat" className="input" inputMode="numeric" dir="ltr" /></div>
                <div><label className="label">{t.common.phone}</label><input name="phone" className="input" dir="ltr" defaultValue={user.phone ?? ""} required /></div>
                <div><label className="label">{t.common.email}</label><input name="email" type="email" className="input" dir="ltr" defaultValue={user.email ?? ""} required /></div>
                <div><label className="label">{t.common.city}</label><select name="city" className="input">{CITIES.map((c) => <option key={c.id} value={c.id}>{c[locale]}</option>)}</select></div>
                <div><label className="label">{t.search.neighborhood}</label><input name="neighborhood" className="input" /></div>
                <div className="sm:col-span-2"><label className="label">{ar ? "العنوان" : "Address"}</label><input name="address" className="input" /></div>
                <button className="btn-primary sm:col-span-2">{t.nav.forSalons}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
