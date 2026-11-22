import { sql } from "./db";
import { weekdayOf, isValidDate } from "./time";

export type SalonCardRow = {
  id: string; slug: string; name_ar: string; name_en: string | null; audience: "women" | "men"; category: string;
  logo_url: string | null; cover_url: string | null; rating_avg: number; rating_count: number; is_featured: boolean;
  city: string | null; neighborhood: string | null; min_price: number | null; offer_percent: number | null; created_at: Date;
};

export type SearchFilters = {
  q?: string; city?: string; neighborhood?: string; audience?: "women" | "men"; category?: string; serviceCategory?: string;
  priceMin?: number; priceMax?: number; ratingMin?: number; date?: string; sort?: "featured" | "rating" | "price" | "new"; limit?: number; offset?: number;
};

const cardSelect = sql`
  s.id, s.slug, s.name_ar, s.name_en, s.audience, s.category, s.logo_url, s.cover_url, s.rating_avg::float as rating_avg, s.rating_count, s.is_featured, s.created_at,
  (select city from salon_branches b where b.salon_id = s.id and b.is_active order by created_at limit 1) as city,
  (select neighborhood from salon_branches b where b.salon_id = s.id and b.is_active order by created_at limit 1) as neighborhood,
  (select min(price_halalas) from services sv where sv.salon_id = s.id and sv.is_active) as min_price,
  (select max(discount_value) from promotions p where p.salon_id = s.id and p.is_active and p.is_public and p.discount_type = 'percent'
     and p.starts_at <= now() and (p.ends_at is null or p.ends_at > now())) as offer_percent`;

/** Only approved salons that have at least one active branch, service and employee are publicly listed. */
const listable = sql`s.status = 'approved'
  and exists (select 1 from salon_branches b where b.salon_id = s.id and b.is_active)
  and exists (select 1 from services sv where sv.salon_id = s.id and sv.is_active)
  and exists (select 1 from employees e where e.salon_id = s.id and e.is_active)`;

export async function searchSalons(f: SearchFilters) {
  const q = f.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;
  const weekday = f.date && isValidDate(f.date) ? weekdayOf(f.date) : null;
  const where = sql`${listable}
    ${f.audience ? sql`and s.audience = ${f.audience}` : sql``}
    ${f.category ? sql`and s.category = ${f.category}` : sql``}
    ${like ? sql`and (s.name_ar ilike ${like} or s.name_en ilike ${like} or exists (select 1 from services sv where sv.salon_id = s.id and sv.is_active and (sv.name_ar ilike ${like} or sv.name_en ilike ${like})))` : sql``}
    ${f.city ? sql`and exists (select 1 from salon_branches b where b.salon_id = s.id and b.is_active and b.city = ${f.city})` : sql``}
    ${f.neighborhood ? sql`and exists (select 1 from salon_branches b where b.salon_id = s.id and b.is_active and b.neighborhood ilike ${"%" + f.neighborhood.slice(0, 60) + "%"})` : sql``}
    ${f.serviceCategory ? sql`and exists (select 1 from services sv where sv.salon_id = s.id and sv.is_active and sv.category = ${f.serviceCategory})` : sql``}
    ${f.priceMin != null ? sql`and exists (select 1 from services sv where sv.salon_id = s.id and sv.is_active and sv.price_halalas >= ${f.priceMin})` : sql``}
    ${f.priceMax != null ? sql`and exists (select 1 from services sv where sv.salon_id = s.id and sv.is_active and sv.price_halalas <= ${f.priceMax})` : sql``}
    ${f.ratingMin ? sql`and s.rating_avg >= ${f.ratingMin}` : sql``}
    ${weekday != null ? sql`and exists (select 1 from salon_branches b join branch_hours h on h.branch_id = b.id and h.weekday = ${weekday} and not h.is_closed
        where b.salon_id = s.id and b.is_active and not exists (select 1 from branch_holidays bh where bh.branch_id = b.id and bh.date = ${f.date!}))
      and exists (select 1 from employees e join employee_schedules es on es.employee_id = e.id and es.weekday = ${weekday} where e.salon_id = s.id and e.is_active)` : sql``}`;
  const order = f.sort === "rating" ? sql`s.rating_avg desc, s.rating_count desc`
    : f.sort === "price" ? sql`min_price asc nulls last`
    : f.sort === "new" ? sql`s.created_at desc`
    : sql`s.is_featured desc, s.featured_rank asc nulls last, s.rating_avg desc`;
  const limit = Math.min(f.limit ?? 24, 60);
  const rows = await sql<SalonCardRow[]>`select ${cardSelect} from salons s where ${where} order by ${order} limit ${limit} offset ${f.offset ?? 0}`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from salons s where ${where}`;
  return { rows, total: n };
}

export async function homeSections() {
  const [featured, topRated, recent, offers, popular] = await Promise.all([
    sql<SalonCardRow[]>`select ${cardSelect} from salons s where ${listable} and s.is_featured order by s.featured_rank nulls last, s.rating_avg desc limit 8`,
    sql<SalonCardRow[]>`select ${cardSelect} from salons s where ${listable} and s.rating_count > 0 order by s.rating_avg desc, s.rating_count desc limit 8`,
    sql<SalonCardRow[]>`select ${cardSelect} from salons s where ${listable} order by s.approved_at desc nulls last limit 8`,
    sql<{ id: string; code: string | null; title_ar: string; title_en: string | null; discount_type: string; discount_value: number; ends_at: Date | null; slug: string | null; name_ar: string | null; name_en: string | null; cover_url: string | null }[]>`
      select p.id, p.code::text, p.title_ar, p.title_en, p.discount_type, p.discount_value, p.ends_at, s.slug, s.name_ar, s.name_en, s.cover_url
      from promotions p left join salons s on s.id = p.salon_id
      where p.is_active and p.is_public and p.starts_at <= now() and (p.ends_at is null or p.ends_at > now()) and (p.salon_id is null or s.status = 'approved')
      order by p.created_at desc limit 8`,
    sql<{ category: string; name_ar: string; name_en: string | null; n: number }[]>`
      select sv.category, min(sv.name_ar) as name_ar, min(sv.name_en) as name_en, count(bi.id)::int as n
      from booking_items bi join services sv on sv.id = bi.service_id join bookings b on b.id = bi.booking_id
      where b.created_at > now() - interval '90 days' and b.status in ('confirmed','completed')
      group by sv.category order by n desc limit 8`,
  ]);
  return { featured, topRated, recent, offers, popular };
}

export async function getSalonBySlug(slug: string, opts: { includeUnapproved?: boolean } = {}) {
  const [s] = await sql<(SalonCardRow & Record<string, unknown> & {
    description_ar: string | null; description_en: string | null; phone: string | null; status: string; slot_interval_min: number; buffer_min: number;
    requires_approval: boolean; accepts_cash: boolean; accepts_online: boolean; deposit_percent: number; free_cancel_hours: number; late_cancel_fee_percent: number;
    max_reschedules: number; cancellation_policy_ar: string | null; cancellation_policy_en: string | null; show_staff_photos: boolean; min_lead_min: number; max_advance_days: number;
  })[]>`select s.*, s.rating_avg::float as rating_avg from salons s where s.slug = ${slug} ${opts.includeUnapproved ? sql`` : sql`and s.status = 'approved'`}`;
  if (!s) return null;
  const [branches, services, employees, media, reviews, empServices] = await Promise.all([
    sql<{ id: string; name_ar: string; name_en: string | null; city: string; neighborhood: string | null; address_ar: string | null; address_en: string | null; lat: string | null; lng: string | null; phone: string | null }[]>`
      select * from salon_branches where salon_id = ${s.id} and is_active order by created_at`,
    sql<{ id: string; name_ar: string; name_en: string | null; description_ar: string | null; description_en: string | null; category: string; duration_min: number; price_halalas: number }[]>`
      select * from services where salon_id = ${s.id} and is_active order by sort, category, price_halalas`,
    sql<{ id: string; branch_id: string; display_name_ar: string; display_name_en: string | null; title_ar: string | null; title_en: string | null; bio_ar: string | null; bio_en: string | null; photo_url: string | null; rating_avg: number; rating_count: number }[]>`
      select id, branch_id, display_name_ar, display_name_en, title_ar, title_en, bio_ar, bio_en, photo_url, rating_avg::float as rating_avg, rating_count from employees where salon_id = ${s.id} and is_active order by created_at`,
    sql<{ id: string; kind: string; url: string; caption: string | null }[]>`select id, kind, url, caption from salon_media where salon_id = ${s.id} order by sort, created_at`,
    sql<{ id: string; rating: number; comment: string | null; salon_reply: string | null; created_at: Date; customer: string | null; employee: string | null }[]>`
      select r.id, r.rating, r.comment, r.salon_reply, r.created_at, split_part(coalesce(u.full_name, ''), ' ', 1) as customer, e.display_name_ar as employee
      from reviews r join users u on u.id = r.customer_id left join employees e on e.id = r.employee_id
      where r.salon_id = ${s.id} and r.status = 'published' order by r.created_at desc limit 30`,
    sql<{ employee_id: string; service_id: string }[]>`select es.* from employee_services es join employees e on e.id = es.employee_id where e.salon_id = ${s.id}`,
  ]);
  const hours = branches.length
    ? await sql<{ branch_id: string; weekday: number; is_closed: boolean; open_time: string | null; close_time: string | null }[]>`
        select branch_id, weekday, is_closed, to_char(open_time, 'HH24:MI') as open_time, to_char(close_time, 'HH24:MI') as close_time from branch_hours where branch_id in ${sql(branches.map((b) => b.id))} order by weekday`
    : [];
  return { salon: s, branches, services, employees, media, reviews, empServices, hours };
}

export async function recomputeRatings(salonId: string, employeeId: string | null) {
  await sql`update salons set rating_avg = coalesce((select avg(rating) from reviews where salon_id = ${salonId} and status = 'published'), 0),
    rating_count = (select count(*) from reviews where salon_id = ${salonId} and status = 'published') where id = ${salonId}`;
  if (employeeId) await sql`update employees set rating_avg = coalesce((select avg(rating) from reviews where employee_id = ${employeeId} and status = 'published'), 0),
    rating_count = (select count(*) from reviews where employee_id = ${employeeId} and status = 'published') where id = ${employeeId}`;
}
