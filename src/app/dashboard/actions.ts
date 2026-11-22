"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { sql } from "@/lib/db";
import { fd, runAction } from "@/lib/actions";
import { actorOf, dashAction, SALON_COOKIE } from "@/lib/dashboard";
import { audit } from "@/lib/audit";
import { AppError, forbidden } from "@/lib/errors";
import { cancelBooking, completeBooking, decideBooking, markNoShow, rescheduleBooking } from "@/lib/booking/service";
import { storeUpload } from "@/lib/storage";
import { localToUtc } from "@/lib/time";
import { normalizeSaudiPhone } from "@/lib/phone";
import { salonContext } from "@/lib/auth/rbac";
import { requireUser } from "@/lib/auth/session";

const back = (f: FormData, def: string) => {
  const b = String(f.get("back") || def);
  return b.startsWith("/dashboard") ? b : def;
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function ownEmployee(salonId: string, employeeId: string) {
  const [e] = await sql`select 1 from employees where id = ${employeeId} and salon_id = ${salonId}`;
  if (!e) throw forbidden();
}
async function ownBranch(salonId: string, branchId: string) {
  const [e] = await sql`select 1 from salon_branches where id = ${branchId} and salon_id = ${salonId}`;
  if (!e) throw forbidden();
}
async function ownBooking(salonId: string, bookingId: string) {
  const [b] = await sql`select 1 from bookings where id = ${bookingId} and salon_id = ${salonId}`;
  if (!b) throw forbidden();
}

export async function switchSalon(formData: FormData) {
  const u = await requireUser();
  const id = String(formData.get("salon_id"));
  if (await salonContext(u, id)) (await cookies()).set(SALON_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax" });
  await runAction("/dashboard", async () => {});
}

// ---------------------------------------------------------------- salon lifecycle

export async function submitForReview(formData: FormData) {
  await runAction(back(formData, "/dashboard"), async () => {
    const ctx = await dashAction("policies.manage");
    const [c] = await sql<{ services: number; employees: number; schedules: number; cr: string | null }[]>`
      select (select count(*)::int from services where salon_id = ${ctx.salonId} and is_active) as services,
             (select count(*)::int from employees where salon_id = ${ctx.salonId} and is_active) as employees,
             (select count(*)::int from employee_schedules es join employees e on e.id = es.employee_id where e.salon_id = ${ctx.salonId}) as schedules,
             (select commercial_registration from salons where id = ${ctx.salonId}) as cr`;
    if (!c.services || !c.employees || !c.schedules || !c.cr) throw new AppError("incomplete", "Add at least one service, one employee with a schedule, and your CR number first");
    const r = await sql`update salons set status = 'pending_review', updated_at = now() where id = ${ctx.salonId} and status in ('draft', 'rejected') returning id`;
    if (!r.length) throw new AppError("invalid_state", "Salon cannot be submitted in its current status");
    await audit(ctx.user.id, "salon.submitted", "salon", ctx.salonId);
  });
}

export async function saveProfile(formData: FormData) {
  await runAction("/dashboard/profile", async () => {
    const ctx = await dashAction("profile.manage");
    const f = fd(formData);
    const d = z.object({
      name_ar: z.string().min(2).max(120), name_en: z.string().max(120), description_ar: z.string().max(3000), description_en: z.string().max(3000),
      phone: z.string().max(20), email: z.string().email().or(z.literal("")), category: z.enum(["salon", "barbershop", "spa", "nails", "makeup", "skincare", "grooming"]),
      cr: z.string().regex(/^(\d{10})?$/), vat: z.string().regex(/^(\d{15})?$/),
    }).parse({ name_ar: f.str("name_ar"), name_en: f.str("name_en"), description_ar: f.str("description_ar"), description_en: f.str("description_en"), phone: f.str("phone"), email: f.str("email"), category: f.str("category"), cr: f.str("cr"), vat: f.str("vat") });
    const logo = f.file("logo"), cover = f.file("cover");
    const logoUrl = logo ? (await storeUpload(logo, `salons/${ctx.salonId}`)).url : null;
    const coverUrl = cover ? (await storeUpload(cover, `salons/${ctx.salonId}`)).url : null;
    await sql`update salons set name_ar = ${d.name_ar}, name_en = ${d.name_en || null}, description_ar = ${d.description_ar || null}, description_en = ${d.description_en || null},
      phone = ${d.phone || null}, email = ${d.email || null}, category = ${d.category}, commercial_registration = ${d.cr || null}, vat_number = ${d.vat || null},
      logo_url = coalesce(${logoUrl}, logo_url), cover_url = coalesce(${coverUrl}, cover_url), updated_at = now() where id = ${ctx.salonId}`;
    await audit(ctx.user.id, "salon.profile_updated", "salon", ctx.salonId);
  });
}

export async function uploadMedia(formData: FormData) {
  await runAction("/dashboard/profile", async () => {
    const ctx = await dashAction("profile.manage");
    const files = formData.getAll("files").filter((x): x is File => x instanceof File && x.size > 0).slice(0, 10);
    if (!files.length) throw new AppError("validation", "Choose at least one file");
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from salon_media where salon_id = ${ctx.salonId}`;
    if (n + files.length > 40) throw new AppError("too_many", "Gallery limit is 40 items");
    for (const file of files) {
      const { url, kind } = await storeUpload(file, `salons/${ctx.salonId}/gallery`);
      await sql`insert into salon_media (salon_id, kind, url, sort) values (${ctx.salonId}, ${kind}, ${url}, ${n})`;
    }
  });
}

export async function deleteMedia(formData: FormData) {
  await runAction("/dashboard/profile", async () => {
    const ctx = await dashAction("profile.manage");
    await sql`delete from salon_media where id = ${String(formData.get("id"))} and salon_id = ${ctx.salonId}`;
  });
}

export async function savePolicies(formData: FormData) {
  await runAction("/dashboard/policies", async () => {
    const ctx = await dashAction("policies.manage");
    const f = fd(formData);
    const d = z.object({
      slot_interval_min: z.number().refine((v) => [5, 10, 15, 20, 30, 45, 60].includes(v)), buffer_min: z.number().int().min(0).max(120),
      min_lead_min: z.number().int().min(0).max(10080), max_advance_days: z.number().int().min(1).max(365), deposit_percent: z.number().int().min(0).max(100),
      free_cancel_hours: z.number().int().min(0).max(720), late_cancel_fee_percent: z.number().int().min(0).max(100), max_reschedules: z.number().int().min(0).max(10),
    }).parse({
      slot_interval_min: f.int("slot_interval_min"), buffer_min: f.int("buffer_min"), min_lead_min: f.int("min_lead_min"), max_advance_days: f.int("max_advance_days"),
      deposit_percent: f.int("deposit_percent"), free_cancel_hours: f.int("free_cancel_hours"), late_cancel_fee_percent: f.int("late_cancel_fee_percent"), max_reschedules: f.int("max_reschedules"),
    });
    const acceptsCash = f.bool("accepts_cash"), acceptsOnline = f.bool("accepts_online");
    if (!acceptsCash && !acceptsOnline && d.deposit_percent === 0) throw new AppError("validation", "Enable at least one payment method");
    await sql`update salons set ${sql(d)}, requires_approval = ${f.bool("requires_approval")}, accepts_cash = ${acceptsCash}, accepts_online = ${acceptsOnline},
      show_staff_photos = ${f.bool("show_staff_photos")}, cancellation_policy_ar = ${f.opt("cancellation_policy_ar")}, cancellation_policy_en = ${f.opt("cancellation_policy_en")}, updated_at = now()
      where id = ${ctx.salonId}`;
    await audit(ctx.user.id, "salon.policies_updated", "salon", ctx.salonId, { ...d, acceptsCash, acceptsOnline });
  });
}

// ---------------------------------------------------------------- branches & hours

export async function saveBranch(formData: FormData) {
  await runAction("/dashboard/branches", async () => {
    const ctx = await dashAction("profile.manage");
    const f = fd(formData);
    const id = f.opt("id");
    const lat = f.opt("lat"), lng = f.opt("lng");
    const latN = lat ? Number(lat) : null, lngN = lng ? Number(lng) : null;
    if ((latN != null && (latN < 16 || latN > 33)) || (lngN != null && (lngN < 34 || lngN > 56))) throw new AppError("validation", "Coordinates must be inside Saudi Arabia");
    const v = { name_ar: f.str("name_ar") || "الفرع", name_en: f.opt("name_en"), city: f.str("city"), neighborhood: f.opt("neighborhood"), address_ar: f.opt("address_ar"), address_en: f.opt("address_en"), lat: latN, lng: lngN, phone: f.opt("phone"), is_active: id ? f.bool("is_active") : true };
    if (id) {
      await ownBranch(ctx.salonId, id);
      await sql`update salon_branches set ${sql(v)} where id = ${id}`;
    } else {
      const [b] = await sql<{ id: string }[]>`insert into salon_branches ${sql({ ...v, salon_id: ctx.salonId })} returning id`;
      for (let w = 0; w < 7; w++) await sql`insert into branch_hours (branch_id, weekday, open_time, close_time) values (${b.id}, ${w}, '10:00', '22:00')`;
    }
  });
}

export async function saveHours(formData: FormData) {
  await runAction("/dashboard/branches", async () => {
    const ctx = await dashAction("profile.manage");
    const branchId = String(formData.get("branch_id"));
    await ownBranch(ctx.salonId, branchId);
    await sql.begin(async (tx) => {
      for (let w = 0; w < 7; w++) {
        const closed = formData.get(`closed_${w}`) === "on";
        const open = String(formData.get(`open_${w}`) || ""), close = String(formData.get(`close_${w}`) || "");
        if (!closed && (!TIME.test(open) || !TIME.test(close) || open >= close)) throw new AppError("validation", `Invalid hours for day ${w}`);
        await tx`insert into branch_hours (branch_id, weekday, is_closed, open_time, close_time) values (${branchId}, ${w}, ${closed}, ${closed ? null : open}, ${closed ? null : close})
          on conflict (branch_id, weekday) do update set is_closed = excluded.is_closed, open_time = excluded.open_time, close_time = excluded.close_time`;
      }
    });
  });
}

export async function addHoliday(formData: FormData) {
  await runAction("/dashboard/branches", async () => {
    const ctx = await dashAction("profile.manage");
    const branchId = String(formData.get("branch_id"));
    await ownBranch(ctx.salonId, branchId);
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(formData.get("date"));
    await sql`insert into branch_holidays (branch_id, date, reason) values (${branchId}, ${date}, ${String(formData.get("reason") || "") || null}) on conflict do nothing`;
  });
}
export async function removeHoliday(formData: FormData) {
  await runAction("/dashboard/branches", async () => {
    const ctx = await dashAction("profile.manage");
    await sql`delete from branch_holidays h using salon_branches b where h.id = ${String(formData.get("id"))} and b.id = h.branch_id and b.salon_id = ${ctx.salonId}`;
  });
}

// ---------------------------------------------------------------- services

export async function saveService(formData: FormData) {
  await runAction("/dashboard/services", async () => {
    const ctx = await dashAction("catalog.manage");
    const f = fd(formData);
    const id = f.opt("id");
    const v = z.object({
      name_ar: z.string().min(2).max(120), name_en: z.string().max(120).nullable(), description_ar: z.string().max(500).nullable(), description_en: z.string().max(500).nullable(),
      category: z.string().min(2).max(30), duration_min: z.number().int().min(5).max(600), price_halalas: z.number().int().min(0).max(10_000_000), is_active: z.boolean(), sort: z.number().int(),
    }).parse({ name_ar: f.str("name_ar"), name_en: f.opt("name_en"), description_ar: f.opt("description_ar"), description_en: f.opt("description_en"), category: f.str("category"), duration_min: f.int("duration_min"), price_halalas: f.sar("price"), is_active: id ? f.bool("is_active") : true, sort: f.int("sort", 0) });
    const employees = f.all("employees");
    await sql.begin(async (tx) => {
      let sid = id;
      if (id) {
        const r = await tx`update services set ${tx(v)} where id = ${id} and salon_id = ${ctx.salonId} returning id`;
        if (!r.length) throw forbidden();
      } else {
        sid = (await tx<{ id: string }[]>`insert into services ${tx({ ...v, salon_id: ctx.salonId })} returning id`)[0].id;
      }
      await tx`delete from employee_services where service_id = ${sid!}`;
      for (const e of employees) {
        const [ok] = await tx`select 1 from employees where id = ${e} and salon_id = ${ctx.salonId}`;
        if (ok) await tx`insert into employee_services (employee_id, service_id) values (${e}, ${sid!})`;
      }
    });
  });
}

// ---------------------------------------------------------------- employees

export async function saveEmployee(formData: FormData) {
  const f = fd(formData);
  const id = f.opt("id");
  await runAction(id ? `/dashboard/staff/${id}` : "/dashboard/staff", async () => {
    const ctx = await dashAction("staff.manage");
    const branchId = f.str("branch_id");
    await ownBranch(ctx.salonId, branchId);
    const v = z.object({
      display_name_ar: z.string().min(2).max(80), display_name_en: z.string().max(80).nullable(), title_ar: z.string().max(120).nullable(), title_en: z.string().max(120).nullable(),
      bio_ar: z.string().max(1000).nullable(), bio_en: z.string().max(1000).nullable(), branch_id: z.string().uuid(), is_active: z.boolean(),
    }).parse({ display_name_ar: f.str("display_name_ar"), display_name_en: f.opt("display_name_en"), title_ar: f.opt("title_ar"), title_en: f.opt("title_en"), bio_ar: f.opt("bio_ar"), bio_en: f.opt("bio_en"), branch_id: branchId, is_active: id ? f.bool("is_active") : true });
    const photo = f.file("photo");
    const photoUrl = photo ? (await storeUpload(photo, `salons/${ctx.salonId}/staff`)).url : null;
    if (id) {
      await ownEmployee(ctx.salonId, id);
      await sql`update employees set ${sql(v)}, photo_url = coalesce(${photoUrl}, photo_url) where id = ${id}`;
    } else {
      const [e] = await sql<{ id: string }[]>`insert into employees ${sql({ ...v, salon_id: ctx.salonId, photo_url: photoUrl })} returning id`;
      // default schedule: copy branch hours
      await sql`insert into employee_schedules (employee_id, weekday, start_time, end_time)
        select ${e.id}, weekday, open_time, close_time from branch_hours where branch_id = ${branchId} and not is_closed`;
      const services = await sql<{ id: string }[]>`select id from services where salon_id = ${ctx.salonId}`;
      for (const s of services) await sql`insert into employee_services (employee_id, service_id) values (${e.id}, ${s.id}) on conflict do nothing`;
    }
    await audit(ctx.user.id, id ? "employee.updated" : "employee.created", "employee", id, { name: v.display_name_ar });
  });
}

export async function saveEmployeeServices(formData: FormData) {
  const id = String(formData.get("id"));
  await runAction(`/dashboard/staff/${id}`, async () => {
    const ctx = await dashAction("staff.manage");
    await ownEmployee(ctx.salonId, id);
    const ids = formData.getAll("services").map(String);
    await sql.begin(async (tx) => {
      await tx`delete from employee_services where employee_id = ${id}`;
      for (const s of ids) {
        const [ok] = await tx`select 1 from services where id = ${s} and salon_id = ${ctx.salonId}`;
        if (ok) await tx`insert into employee_services (employee_id, service_id) values (${id}, ${s})`;
      }
    });
  });
}

export async function saveSchedule(formData: FormData) {
  const id = String(formData.get("id"));
  await runAction(`/dashboard/staff/${id}`, async () => {
    const ctx = await dashAction("staff.manage");
    await ownEmployee(ctx.salonId, id);
    await sql.begin(async (tx) => {
      await tx`delete from employee_schedules where employee_id = ${id}`;
      await tx`delete from employee_breaks where employee_id = ${id}`;
      for (let w = 0; w < 7; w++) {
        if (formData.get(`off_${w}`) === "on") continue;
        const s = String(formData.get(`start_${w}`) || ""), e = String(formData.get(`end_${w}`) || "");
        if (!TIME.test(s) || !TIME.test(e) || s >= e) throw new AppError("validation", `Invalid working hours for day ${w}`);
        await tx`insert into employee_schedules (employee_id, weekday, start_time, end_time) values (${id}, ${w}, ${s}, ${e})`;
        const bs = String(formData.get(`bstart_${w}`) || ""), be = String(formData.get(`bend_${w}`) || "");
        if (bs || be) {
          if (!TIME.test(bs) || !TIME.test(be) || bs >= be || bs < s || be > e) throw new AppError("validation", `Break must be inside working hours (day ${w})`);
          await tx`insert into employee_breaks (employee_id, weekday, start_time, end_time) values (${id}, ${w}, ${bs}, ${be})`;
        }
      }
    });
  });
}

/** Days off, vacations and manually blocked slots. Stylists may block their own time only. */
export async function addTimeOff(formData: FormData) {
  const f = fd(formData);
  const id = f.str("employee_id");
  await runAction(back(formData, `/dashboard/staff/${id}`), async () => {
    const ctx = await dashAction("schedule.block_own");
    if (ctx.role === "stylist" && ctx.employeeId !== id) throw forbidden();
    await ownEmployee(ctx.salonId, id);
    const date = f.str("date"), dateTo = f.str("date_to") || date;
    const from = f.str("from") || "00:00", to = f.str("to") || "23:59";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || !TIME.test(from) || !TIME.test(to)) throw new AppError("validation", "Invalid date/time");
    const startsAt = localToUtc(date, from), endsAt = localToUtc(dateTo, to);
    if (endsAt <= startsAt) throw new AppError("validation", "End must be after start");
    const [clash] = await sql<{ reference: string }[]>`select reference from bookings where employee_id = ${id} and status in ('pending_payment','pending_approval','confirmed')
      and tstzrange(starts_at, blocked_until) && tstzrange(${startsAt}, ${endsAt}) limit 1`;
    if (clash && !f.bool("force")) throw new AppError("has_bookings", `Booking ${clash.reference} falls in this period — reschedule it first`);
    await sql`insert into employee_time_off (employee_id, starts_at, ends_at, kind, reason, created_by) values (${id}, ${startsAt}, ${endsAt}, ${f.str("kind") || "time_off"}, ${f.opt("reason")}, ${ctx.user.id})`;
  });
}

export async function removeTimeOff(formData: FormData) {
  await runAction(back(formData, "/dashboard/staff"), async () => {
    const ctx = await dashAction("schedule.block_own");
    const [t] = await sql<{ employee_id: string }[]>`select o.employee_id from employee_time_off o join employees e on e.id = o.employee_id where o.id = ${String(formData.get("id"))} and e.salon_id = ${ctx.salonId}`;
    if (!t || (ctx.role === "stylist" && ctx.employeeId !== t.employee_id)) throw forbidden();
    await sql`delete from employee_time_off where id = ${String(formData.get("id"))}`;
  });
}

// ---------------------------------------------------------------- bookings

export async function bookingAction(formData: FormData) {
  const f = fd(formData);
  await runAction(back(formData, "/dashboard/bookings"), async () => {
    const op = f.str("op");
    const ctx = await dashAction(op === "complete" ? "bookings.complete_own" : "bookings.manage");
    const id = f.str("booking_id");
    await ownBooking(ctx.salonId, id);
    const actor = actorOf(ctx);
    switch (op) {
      case "accept": await decideBooking(id, actor, "accept"); break;
      case "reject": await decideBooking(id, actor, "reject", f.opt("reason") ?? undefined); break;
      case "cancel": await cancelBooking(id, actor, f.opt("reason") ?? "Cancelled by salon"); break;
      case "no_show": await markNoShow(id, actor); break;
      case "complete": await completeBooking(id, actor, f.str("cash") === "" ? undefined : f.sar("cash")); break;
      case "reschedule": await rescheduleBooking(id, actor, { date: f.str("date"), time: f.str("time"), employeeId: f.opt("employee_id") }); break;
      default: throw new AppError("validation", "Unknown operation");
    }
    await audit(ctx.user.id, `booking.${op}`, "booking", id);
  });
}

// ---------------------------------------------------------------- promotions

export async function savePromotion(formData: FormData) {
  await runAction("/dashboard/promotions", async () => {
    const ctx = await dashAction("promotions.manage");
    const f = fd(formData);
    const type = f.str("discount_type") === "fixed" ? "fixed" : "percent";
    const value = type === "fixed" ? f.sar("discount_value") : f.int("discount_value");
    if (value <= 0 || (type === "percent" && value > 100)) throw new AppError("validation", "Invalid discount value");
    const code = f.str("code").toUpperCase();
    if (code && !/^[A-Z0-9]{3,20}$/.test(code)) throw new AppError("validation", "Code must be 3-20 letters/digits");
    await sql`insert into promotions (salon_id, code, title_ar, title_en, discount_type, discount_value, min_subtotal_halalas, max_discount_halalas, starts_at, ends_at, max_redemptions, per_customer_limit, is_public)
      values (${ctx.salonId}, ${code || null}, ${f.str("title_ar") || code}, ${f.opt("title_en")}, ${type}, ${value}, ${f.str("min") ? f.sar("min") : 0}, ${f.str("max_discount") ? f.sar("max_discount") : null},
        ${f.str("starts") ? localToUtc(f.str("starts"), "00:00") : new Date()}, ${f.str("ends") ? localToUtc(f.str("ends"), "23:59") : null},
        ${f.str("max_redemptions") ? f.int("max_redemptions") : null}, ${f.int("per_customer", 1)}, ${f.bool("is_public")})`;
  });
}

export async function togglePromotion(formData: FormData) {
  await runAction("/dashboard/promotions", async () => {
    const ctx = await dashAction("promotions.manage");
    await sql`update promotions set is_active = not is_active where id = ${String(formData.get("id"))} and salon_id = ${ctx.salonId}`;
  });
}

// ---------------------------------------------------------------- reviews

export async function replyReview(formData: FormData) {
  await runAction("/dashboard/reviews", async () => {
    const ctx = await dashAction("reviews.reply");
    await sql`update reviews set salon_reply = ${String(formData.get("reply") || "").slice(0, 1000) || null} where id = ${String(formData.get("id"))} and salon_id = ${ctx.salonId}`;
  });
}

// ---------------------------------------------------------------- team

export async function addMember(formData: FormData) {
  await runAction("/dashboard/team", async () => {
    const ctx = await dashAction("team.manage");
    const f = fd(formData);
    const phone = normalizeSaudiPhone(f.str("phone"));
    if (!phone) throw new AppError("invalid_phone", "Invalid phone");
    const role = z.enum(["manager", "receptionist", "stylist"]).parse(f.str("role"));
    const employeeId = f.opt("employee_id");
    if (employeeId) await ownEmployee(ctx.salonId, employeeId);
    if (role === "stylist" && !employeeId) throw new AppError("validation", "Link the stylist to an employee profile");
    const [u] = await sql<{ id: string; role: string }[]>`insert into users (phone, full_name) values (${phone}, ${f.opt("name")})
      on conflict (phone) do update set full_name = coalesce(users.full_name, excluded.full_name) returning id, role`;
    if (u.role === "customer") await sql`update users set role = 'salon_staff' where id = ${u.id}`;
    await sql`insert into salon_members (salon_id, user_id, role, employee_id) values (${ctx.salonId}, ${u.id}, ${role}, ${employeeId})
      on conflict (salon_id, user_id) do update set role = excluded.role, employee_id = excluded.employee_id`;
    if (employeeId) await sql`update employees set user_id = ${u.id} where id = ${employeeId}`;
    await audit(ctx.user.id, "team.member_added", "salon", ctx.salonId, { phone, role });
  });
}

export async function removeMember(formData: FormData) {
  await runAction("/dashboard/team", async () => {
    const ctx = await dashAction("team.manage");
    const r = await sql`delete from salon_members where id = ${String(formData.get("id"))} and salon_id = ${ctx.salonId} and role <> 'owner' returning user_id`;
    if (!r.length) throw new AppError("invalid_state", "Cannot remove this member");
    await audit(ctx.user.id, "team.member_removed", "salon", ctx.salonId, { user: r[0].user_id });
  });
}
