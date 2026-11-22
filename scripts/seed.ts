/**
 * DEVELOPMENT / STAGING SEED — creates sample salons so the marketplace can be explored end to end.
 * This is NOT used by the application at runtime; production starts empty and salons onboard via /for-salons.
 * Usage: npm run db:seed   (refuses to run when NODE_ENV=production unless SEED_ALLOW_PRODUCTION=1)
 */
import "dotenv/config";
import crypto from "node:crypto";
import postgres from "postgres";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const img = (id: string, w = 1200) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;

async function hash(pw: string) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((r, j) => crypto.scrypt(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 << 20 }, (e, k) => (e ? j(e) : r(k))));
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

type SeedSalon = {
  slug: string; name_ar: string; name_en: string; audience: "women" | "men"; category: string; city: string; neighborhood: string; lat: number; lng: number;
  cover: string; logo: string; desc_ar: string; desc_en: string; featured?: boolean; deposit?: number; approval?: boolean;
  services: [string, string, string, number, number][]; // ar, en, category, minutes, SAR
  staff: [string, string, string, string][]; // ar, en, title_ar, title_en
};

const SALONS: SeedSalon[] = [
  { slug: "layali-beauty-lounge", name_ar: "ليالي بيوتي لاونج", name_en: "Layali Beauty Lounge", audience: "women", category: "salon", city: "riyadh", neighborhood: "حي الملقا", lat: 24.8006, lng: 46.6182, featured: true, deposit: 20,
    cover: img("photo-1560066984-138dadb4c035"), logo: img("photo-1522335789203-aabd1fc54bc9", 300),
    desc_ar: "صالون نسائي فاخر يقدم أحدث صيحات الشعر والمكياج والعناية بالأظافر بأيدي خبيرات معتمدات.", desc_en: "A luxury women's salon offering the latest in hair, makeup and nail care by certified experts.",
    services: [["قص وتصفيف", "Cut & style", "hair", 60, 180], ["صبغة كاملة", "Full colour", "color", 120, 450], ["بروتين", "Keratin treatment", "hair", 150, 650], ["مكياج سهرة", "Evening makeup", "makeup", 60, 350], ["مناكير وبديكير", "Mani & pedi", "nails", 75, 160], ["مكياج عروس", "Bridal makeup", "bridal", 120, 1500]],
    staff: [["نورة", "Noura", "خبيرة شعر", "Hair specialist"], ["ريم", "Reem", "خبيرة مكياج", "Makeup artist"], ["هيا", "Haya", "أخصائية أظافر", "Nail technician"]] },
  { slug: "jouri-spa", name_ar: "جوري سبا", name_en: "Jouri Spa", audience: "women", category: "spa", city: "jeddah", neighborhood: "حي الشاطئ", lat: 21.5926, lng: 39.1076, featured: true,
    cover: img("photo-1544161515-4ab6ce6db874"), logo: img("photo-1540555700478-4be289fbecef", 300),
    desc_ar: "ملاذ هادئ للاسترخاء: مساج، حمام مغربي، وجلسات عناية بالبشرة.", desc_en: "A calm retreat: massage, Moroccan bath and skincare sessions.",
    services: [["مساج استرخائي", "Relaxing massage", "spa", 60, 300], ["حمام مغربي", "Moroccan bath", "spa", 90, 380], ["تنظيف بشرة عميق", "Deep facial", "skin", 75, 320]],
    staff: [["لمى", "Lama", "معالجة سبا", "Spa therapist"], ["سارة", "Sara", "أخصائية بشرة", "Skin specialist"]] },
  { slug: "dar-al-oud-barbers", name_ar: "دار العود للحلاقة", name_en: "Dar Al Oud Barbers", audience: "men", category: "barbershop", city: "riyadh", neighborhood: "حي العليا", lat: 24.6907, lng: 46.6853, featured: true,
    cover: img("photo-1503951914875-452162b0f3f1"), logo: img("photo-1621605815971-fbc98d665033", 300),
    desc_ar: "حلاقة رجالية كلاسيكية بلمسة عصرية، تهذيب لحية، وعناية بالبشرة.", desc_en: "Classic men's barbering with a modern touch, beard grooming and skincare.",
    services: [["حلاقة شعر", "Haircut", "hair", 30, 70], ["تهذيب لحية", "Beard trim", "beard", 20, 40], ["حلاقة + لحية", "Cut + beard", "beard", 45, 100], ["تنظيف بشرة رجالي", "Men's facial", "skin", 40, 120]],
    staff: [["أحمد", "Ahmed", "حلاق أول", "Senior barber"], ["خالد", "Khalid", "حلاق", "Barber"], ["فيصل", "Faisal", "حلاق", "Barber"]] },
  { slug: "gentlemen-grooming-lab", name_ar: "مختبر العناية للرجال", name_en: "Gentlemen Grooming Lab", audience: "men", category: "grooming", city: "dammam", neighborhood: "حي الشاطئ", lat: 26.4473, lng: 50.1014, approval: true,
    cover: img("photo-1585747860715-2ba37e788b70"), logo: img("photo-1599351431202-1e0f0137899a", 300),
    desc_ar: "تجربة عناية متكاملة للرجل العصري.", desc_en: "Complete grooming experience for the modern man.",
    services: [["قصة عصرية", "Modern cut", "hair", 40, 90], ["صبغة لحية", "Beard colour", "beard", 30, 80], ["مساج رأس", "Head massage", "spa", 20, 60]],
    staff: [["عبدالله", "Abdullah", "خبير عناية", "Grooming expert"], ["سلطان", "Sultan", "حلاق", "Barber"]] },
  { slug: "nail-atelier-khobar", name_ar: "أتيليه الأظافر", name_en: "Nail Atelier", audience: "women", category: "nails", city: "khobar", neighborhood: "حي العقربية", lat: 26.2794, lng: 50.2083,
    cover: img("photo-1604654894610-df63bc536371"), logo: img("photo-1519014816548-bf5fe059798b", 300),
    desc_ar: "فن الأظافر والجل والأكريليك بأعلى معايير النظافة.", desc_en: "Nail art, gel and acrylic with the highest hygiene standards.",
    services: [["جل", "Gel polish", "nails", 45, 120], ["أكريليك", "Acrylic set", "nails", 90, 250], ["رسم أظافر", "Nail art", "nails", 30, 80]],
    staff: [["دانة", "Dana", "فنانة أظافر", "Nail artist"], ["غادة", "Ghada", "فنانة أظافر", "Nail artist"]] },
];

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@tremly.local";
  const adminPw = process.env.SEED_ADMIN_PASSWORD ?? crypto.randomBytes(9).toString("base64url");
  await sql`insert into users (email, full_name, role, password_hash, phone, phone_verified_at) values (${adminEmail}, 'TREMLY Admin', 'admin', ${await hash(adminPw)}, '+966500000001', now())
    on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin'`;
  console.log(`admin: ${adminEmail} / ${adminPw}`);

  for (const [i, s] of SALONS.entries()) {
    const [exists] = await sql`select 1 from salons where slug = ${s.slug}`;
    if (exists) { console.log("skip", s.slug); continue; }
    const ownerPhone = `+96655000${String(100 + i).padStart(4, "0")}`;
    const ownerPw = "Owner-" + crypto.randomBytes(5).toString("hex");
    const [owner] = await sql<{ id: string }[]>`insert into users (phone, email, full_name, role, phone_verified_at, password_hash) values (${ownerPhone}, ${`owner${i + 1}@tremly.local`}, ${"Owner " + s.name_en}, 'salon_owner', now(), ${await hash(ownerPw)})
      on conflict (phone) do update set role = 'salon_owner' returning id`;
    console.log(`owner ${s.slug}: owner${i + 1}@tremly.local / ${ownerPw}  (phone ${ownerPhone})`);
    const [salon] = await sql<{ id: string }[]>`insert into salons (slug, name_ar, name_en, description_ar, description_en, audience, category, logo_url, cover_url, phone, email, commercial_registration, status, is_featured, featured_rank,
        deposit_percent, requires_approval, show_staff_photos, approved_at, created_by, cancellation_policy_ar, cancellation_policy_en, late_cancel_fee_percent)
      values (${s.slug}, ${s.name_ar}, ${s.name_en}, ${s.desc_ar}, ${s.desc_en}, ${s.audience}, ${s.category}, ${s.logo}, ${s.cover}, ${ownerPhone}, ${`owner${i + 1}@tremly.local`}, ${String(1010000000 + i)}, 'approved',
        ${!!s.featured}, ${s.featured ? i + 1 : null}, ${s.deposit ?? 0}, ${!!s.approval}, ${s.audience === "men"}, now() - make_interval(days => ${i * 3}), ${owner.id},
        'يرجى الحضور قبل الموعد بـ 10 دقائق.', 'Please arrive 10 minutes early.', 50) returning id`;
    await sql`insert into salon_members (salon_id, user_id, role) values (${salon.id}, ${owner.id}, 'owner')`;
    const [branch] = await sql<{ id: string }[]>`insert into salon_branches (salon_id, name_ar, name_en, city, neighborhood, address_ar, address_en, lat, lng, phone)
      values (${salon.id}, 'الفرع الرئيسي', 'Main branch', ${s.city}, ${s.neighborhood}, ${"طريق الملك فهد، " + s.neighborhood}, 'King Fahd Road', ${s.lat}, ${s.lng}, ${ownerPhone}) returning id`;
    for (let w = 0; w < 7; w++) await sql`insert into branch_hours (branch_id, weekday, open_time, close_time) values (${branch.id}, ${w}, ${w === 5 ? "16:00" : "10:00"}, ${w === 5 ? "23:00" : "22:00"})`;
    const serviceIds: string[] = [];
    for (const [k, [ar, en, cat, min, price]] of s.services.entries()) {
      const [sv] = await sql<{ id: string }[]>`insert into services (salon_id, name_ar, name_en, category, duration_min, price_halalas, sort) values (${salon.id}, ${ar}, ${en}, ${cat}, ${min}, ${price * 100}, ${k}) returning id`;
      serviceIds.push(sv.id);
    }
    for (const [ar, en, tar, ten] of s.staff) {
      const [e] = await sql<{ id: string }[]>`insert into employees (salon_id, branch_id, display_name_ar, display_name_en, title_ar, title_en) values (${salon.id}, ${branch.id}, ${ar}, ${en}, ${tar}, ${ten}) returning id`;
      for (let w = 0; w < 7; w++) {
        if (w === 5) { await sql`insert into employee_schedules (employee_id, weekday, start_time, end_time) values (${e.id}, ${w}, '16:00', '23:00')`; continue; }
        await sql`insert into employee_schedules (employee_id, weekday, start_time, end_time) values (${e.id}, ${w}, '10:00', '22:00')`;
        await sql`insert into employee_breaks (employee_id, weekday, start_time, end_time) values (${e.id}, ${w}, '14:00', '15:00')`;
      }
      for (const sid of serviceIds) await sql`insert into employee_services (employee_id, service_id) values (${e.id}, ${sid})`;
    }
    if (i < 3) await sql`insert into promotions (salon_id, code, title_ar, title_en, discount_type, discount_value, ends_at) values (${salon.id}, ${"WELCOME" + (i + 1) * 5}, 'خصم الافتتاح', 'Opening offer', 'percent', ${(i + 1) * 5}, now() + interval '60 days')`;
  }
  await sql`insert into promotions (salon_id, code, title_ar, title_en, discount_type, discount_value, max_discount_halalas, ends_at) values (null, 'TREMLY10', 'خصم تريملي للعملاء الجدد', 'TREMLY new customer offer', 'percent', 10, 5000, now() + interval '90 days')
    on conflict do nothing`;
  console.log("seed complete");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
