import { sql, type Db, type Tx } from "../db";
import { AppError, forbidden, notFound } from "../errors";
import { humanCode } from "../crypto";
import { addDays, localToUtc, minToTime, timeToMin, todayLocal, utcToLocal, weekdayOf, formatDateTime } from "../time";
import { computeSlots, type EmployeeDay, type Interval } from "./availability";
import { percentOf, sar } from "../money";
import { notifySalon, notifyUser } from "../notifications";
import { postCommission, post } from "../finance/ledger";
import { audit } from "../audit";

export const ACTIVE_STATUSES = ["pending_payment", "pending_approval", "confirmed"] as const;

export type Actor =
  | { kind: "customer"; userId: string }
  | { kind: "salon"; userId: string; salonId: string; ownEmployeeOnly: string | null } // stylist => own employee id
  | { kind: "admin"; userId: string }
  | { kind: "system"; userId: null };

type SalonRow = {
  id: string; name_ar: string; name_en: string | null; status: string; slot_interval_min: number; buffer_min: number; min_lead_min: number;
  max_advance_days: number; requires_approval: boolean; accepts_cash: boolean; accepts_online: boolean; deposit_percent: number;
  free_cancel_hours: number; late_cancel_fee_percent: number; max_reschedules: number;
};

export type BookingRow = {
  id: string; reference: string; salon_id: string; branch_id: string; customer_id: string; employee_id: string;
  starts_at: Date; ends_at: Date; blocked_until: Date; status: string; payment_method: "online" | "deposit" | "cash"; payment_status: string;
  subtotal_halalas: number; discount_halalas: number; total_halalas: number; amount_due_online_halalas: number; amount_paid_halalas: number;
  amount_refunded_halalas: number; cash_collected_halalas: number; promotion_id: string | null; hold_expires_at: Date | null; reschedule_count: number;
};

const MIN = 60_000;

function mapDbError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "23P01") throw new AppError("slot_taken", "This time was just booked by someone else. Please choose another time.", 409);
  throw e;
}

export async function releaseExpiredHolds(db: Db = sql) {
  const rows = await db<{ id: string }[]>`
    update bookings set status = 'expired', payment_status = 'cancelled', updated_at = now()
    where status = 'pending_payment' and hold_expires_at < now() returning id`;
  for (const r of rows) await db`insert into booking_events (booking_id, event) values (${r.id}, 'hold_expired')`;
  return rows.length;
}

async function loadSalon(db: Db, salonId: string): Promise<SalonRow> {
  const [s] = await db<SalonRow[]>`select * from salons where id = ${salonId}`;
  if (!s) throw notFound("salon");
  return s;
}

type DayCtx = { date: string; dayStart: Date; slots: { start: number; employeeIds: string[] }[] };

/**
 * Loads everything needed to compute availability for one branch/day and returns bookable slots.
 * `excludeBookingId` lets a reschedule ignore the booking's own current time.
 */
export async function computeDay(db: Db, opts: {
  salon: SalonRow; branchId: string; date: string; serviceIds: string[]; employeeId?: string | null; excludeBookingId?: string; now?: Date; ignoreLead?: boolean;
}): Promise<DayCtx & { durationMin: number }> {
  const { salon, branchId, date, serviceIds } = opts;
  const now = opts.now ?? new Date();
  const dayStart = localToUtc(date, "00:00");
  const dayEnd = new Date(dayStart.getTime() + 1440 * MIN);
  const weekday = weekdayOf(date);

  const services = await db<{ id: string; duration_min: number }[]>`
    select id, duration_min from services where salon_id = ${salon.id} and is_active and id in ${db(serviceIds)}`;
  if (services.length !== new Set(serviceIds).size) throw new AppError("invalid_services", "One or more services are unavailable");
  const durationMin = services.reduce((a, s) => a + s.duration_min, 0);
  const empty = { date, dayStart, slots: [], durationMin };

  const today = todayLocal(now);
  if (date < today || date > addDays(today, salon.max_advance_days)) return empty;

  const [hours] = await db<{ is_closed: boolean; open_time: string | null; close_time: string | null }[]>`
    select is_closed, open_time::text, close_time::text from branch_hours where branch_id = ${branchId} and weekday = ${weekday}`;
  const [holiday] = await db`select 1 from branch_holidays where branch_id = ${branchId} and date = ${date}`;
  if (!hours || hours.is_closed || holiday) return empty;
  const branchOpen: Interval = { start: timeToMin(hours.open_time!), end: timeToMin(hours.close_time!) };

  const employees = await db<{ id: string }[]>`
    select e.id from employees e
    join employee_services es on es.employee_id = e.id and es.service_id in ${db(serviceIds)}
    where e.salon_id = ${salon.id} and e.branch_id = ${branchId} and e.is_active
      ${opts.employeeId ? db`and e.id = ${opts.employeeId}` : db``}
    group by e.id having count(distinct es.service_id) = ${new Set(serviceIds).size}`;
  if (!employees.length) return empty;
  const ids = employees.map((e) => e.id);

  const [schedules, breaks, bookings, timeOff] = await Promise.all([
    db<{ employee_id: string; start_time: string; end_time: string }[]>`select employee_id, start_time::text, end_time::text from employee_schedules where weekday = ${weekday} and employee_id in ${db(ids)}`,
    db<{ employee_id: string; start_time: string; end_time: string }[]>`select employee_id, start_time::text, end_time::text from employee_breaks where weekday = ${weekday} and employee_id in ${db(ids)}`,
    db<{ employee_id: string; starts_at: Date; blocked_until: Date }[]>`
      select employee_id, starts_at, blocked_until from bookings
      where employee_id in ${db(ids)} and starts_at < ${dayEnd} and blocked_until > ${dayStart}
        and (status in ('pending_approval','confirmed') or (status = 'pending_payment' and hold_expires_at > now()))
        ${opts.excludeBookingId ? db`and id <> ${opts.excludeBookingId}` : db``}`,
    db<{ employee_id: string; starts_at: Date; ends_at: Date }[]>`
      select employee_id, starts_at, ends_at from employee_time_off where employee_id in ${db(ids)} and starts_at < ${dayEnd} and ends_at > ${dayStart}`,
  ]);

  const rel = (t: Date) => Math.max(0, Math.min(1440, Math.round((t.getTime() - dayStart.getTime()) / MIN)));
  const days: EmployeeDay[] = ids.map((id) => ({
    employeeId: id,
    shifts: schedules.filter((s) => s.employee_id === id).map((s) => ({ start: timeToMin(s.start_time), end: timeToMin(s.end_time) })),
    breaks: breaks.filter((s) => s.employee_id === id).map((s) => ({ start: timeToMin(s.start_time), end: timeToMin(s.end_time) })),
    busy: [
      ...bookings.filter((b) => b.employee_id === id).map((b) => ({ start: rel(b.starts_at), end: rel(b.blocked_until) })),
      ...timeOff.filter((b) => b.employee_id === id).map((b) => ({ start: rel(b.starts_at), end: rel(b.ends_at) })),
    ],
  }));

  const earliest = opts.ignoreLead ? Math.ceil((now.getTime() - dayStart.getTime()) / MIN) : Math.ceil((now.getTime() + salon.min_lead_min * MIN - dayStart.getTime()) / MIN);
  const slots = computeSlots({
    branchOpen, employees: days, durationMin, bufferMin: salon.buffer_min, intervalMin: salon.slot_interval_min, earliestStartMin: Math.max(0, earliest),
  });
  return { date, dayStart, slots, durationMin };
}

export async function getAvailability(input: { salonId: string; branchId: string; serviceIds: string[]; employeeId?: string | null; date: string }) {
  const salon = await loadSalon(sql, input.salonId);
  if (salon.status !== "approved") throw new AppError("salon_unavailable", "Salon is not accepting bookings", 409);
  await assertBranch(sql, salon.id, input.branchId);
  const day = await computeDay(sql, { salon, ...input });
  return { date: day.date, durationMin: day.durationMin, slots: day.slots.map((s) => ({ time: minToTime(s.start), employeeIds: s.employeeIds })) };
}

async function assertBranch(db: Db, salonId: string, branchId: string) {
  const [b] = await db`select 1 from salon_branches where id = ${branchId} and salon_id = ${salonId} and is_active`;
  if (!b) throw notFound("branch");
}

// ------------------------------------------------------------------ promotions

export async function evaluatePromotion(db: Db, code: string, salonId: string, customerId: string, subtotal: number) {
  const [p] = await db<{ id: string; salon_id: string | null; discount_type: "percent" | "fixed"; discount_value: number; min_subtotal_halalas: number;
    max_discount_halalas: number | null; max_redemptions: number | null; redemptions: number; per_customer_limit: number }[]>`
    select * from promotions where code = ${code} and is_active and (salon_id = ${salonId} or salon_id is null)
      and starts_at <= now() and (ends_at is null or ends_at > now())
    order by salon_id nulls last limit 1`;
  if (!p) throw new AppError("promo_invalid", "Promo code is invalid or expired");
  if (subtotal < p.min_subtotal_halalas) throw new AppError("promo_min_subtotal", `Minimum spend is ${sar(p.min_subtotal_halalas, "en")}`);
  if (p.max_redemptions != null && p.redemptions >= p.max_redemptions) throw new AppError("promo_exhausted", "Promo code has been fully redeemed");
  const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from promotion_redemptions r join bookings b on b.id = r.booking_id
    where r.promotion_id = ${p.id} and r.customer_id = ${customerId} and b.status not in ('cancelled','expired','rejected')`;
  if (n >= p.per_customer_limit) throw new AppError("promo_used", "You have already used this promo code");
  let discount = p.discount_type === "percent" ? percentOf(subtotal, p.discount_value) : p.discount_value;
  if (p.max_discount_halalas != null) discount = Math.min(discount, p.max_discount_halalas);
  discount = Math.min(discount, subtotal);
  return { promotionId: p.id, discount, platformFunded: p.salon_id === null };
}

// ------------------------------------------------------------------ create

export type CreateBookingInput = {
  customerId: string; salonId: string; branchId: string; serviceIds: string[]; employeeId: string | null;
  date: string; time: string; paymentMethod: "online" | "deposit" | "cash"; promoCode?: string | null; note?: string | null;
  onlinePaymentsAvailable: boolean; now?: Date;
};

export async function allowedPaymentMethods(salon: Pick<SalonRow, "accepts_cash" | "accepts_online" | "deposit_percent">, onlineAvailable: boolean) {
  const m: ("online" | "deposit" | "cash")[] = [];
  if (onlineAvailable && (salon.accepts_online || salon.deposit_percent > 0)) m.push("online");
  if (onlineAvailable && salon.deposit_percent > 0 && salon.deposit_percent < 100) m.push("deposit");
  if (salon.accepts_cash && salon.deposit_percent === 0) m.push("cash");
  return m;
}

export async function createBooking(input: CreateBookingInput) {
  const holdMinutes = 15;
  let created: BookingRow & { items: { name: string }[]; employeeName: string };
  try {
    created = await sql.begin(async (tx) => {
      await releaseExpiredHolds(tx);
      const salon = await loadSalon(tx, input.salonId);
      if (salon.status !== "approved") throw new AppError("salon_unavailable", "Salon is not accepting bookings", 409);
      await assertBranch(tx, salon.id, input.branchId);
      const allowed = await allowedPaymentMethods(salon, input.onlinePaymentsAvailable);
      if (!allowed.includes(input.paymentMethod)) throw new AppError("payment_method_unavailable", "This payment method is not available for this salon");

      const [customer] = await tx<{ status: string }[]>`select status from users where id = ${input.customerId}`;
      if (!customer || customer.status !== "active") throw forbidden();

      const services = await tx<{ id: string; name_ar: string; name_en: string | null; duration_min: number; price_halalas: number }[]>`
        select id, name_ar, name_en, duration_min, price_halalas from services where salon_id = ${salon.id} and is_active and id in ${tx(input.serviceIds)}`;
      const ordered = input.serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean) as typeof services;
      if (ordered.length !== input.serviceIds.length || new Set(input.serviceIds).size !== input.serviceIds.length)
        throw new AppError("invalid_services", "One or more services are unavailable");

      const day = await computeDay(tx, { salon, branchId: input.branchId, date: input.date, serviceIds: input.serviceIds, employeeId: input.employeeId, now: input.now });
      const startMin = timeToMin(input.time);
      const slot = day.slots.find((s) => s.start === startMin);
      if (!slot) throw new AppError("slot_unavailable", "This time is no longer available", 409);

      let employeeId = input.employeeId;
      if (!employeeId) {
        // "Any available": pick the least-loaded qualified employee that day.
        const loads = await tx<{ employee_id: string; n: number }[]>`
          select employee_id, count(*)::int as n from bookings where employee_id in ${tx(slot.employeeIds)}
            and starts_at >= ${day.dayStart} and starts_at < ${new Date(day.dayStart.getTime() + 1440 * MIN)} and status in ('pending_payment','pending_approval','confirmed')
          group by employee_id`;
        employeeId = [...slot.employeeIds].sort((a, b) => (loads.find((l) => l.employee_id === a)?.n ?? 0) - (loads.find((l) => l.employee_id === b)?.n ?? 0))[0];
      } else if (!slot.employeeIds.includes(employeeId)) {
        throw new AppError("slot_unavailable", "This specialist is not available at this time", 409);
      }

      const subtotal = ordered.reduce((a, s) => a + s.price_halalas, 0);
      let discount = 0, promotionId: string | null = null;
      if (input.promoCode) {
        const p = await evaluatePromotion(tx, input.promoCode.trim(), salon.id, input.customerId, subtotal);
        discount = p.discount; promotionId = p.promotionId;
      }
      const total = subtotal - discount;
      const startsAt = localToUtc(input.date, input.time);
      const endsAt = new Date(startsAt.getTime() + day.durationMin * MIN);
      const blockedUntil = new Date(endsAt.getTime() + salon.buffer_min * MIN);

      let status: string, paymentStatus: string, dueOnline = 0, holdExpires: Date | null = null;
      if (input.paymentMethod === "cash" || total === 0) {
        status = salon.requires_approval ? "pending_approval" : "confirmed";
        paymentStatus = total === 0 ? "paid" : "cash_pending";
      } else {
        dueOnline = input.paymentMethod === "deposit" ? Math.max(100, percentOf(total, salon.deposit_percent)) : total;
        dueOnline = Math.min(dueOnline, total);
        status = "pending_payment"; paymentStatus = "pending";
        holdExpires = new Date(Date.now() + holdMinutes * MIN);
      }

      let booking: BookingRow | undefined;
      for (let attempt = 0; attempt < 3 && !booking; attempt++) {
        const ref = "TR-" + humanCode(6);
        const rows = await tx<BookingRow[]>`
          insert into bookings (reference, salon_id, branch_id, customer_id, employee_id, starts_at, ends_at, blocked_until, status, payment_method,
            payment_status, subtotal_halalas, discount_halalas, total_halalas, amount_due_online_halalas, promotion_id, hold_expires_at, customer_note)
          values (${ref}, ${salon.id}, ${input.branchId}, ${input.customerId}, ${employeeId}, ${startsAt}, ${endsAt}, ${blockedUntil}, ${status},
            ${input.paymentMethod === "cash" || total === 0 ? "cash" : input.paymentMethod}, ${paymentStatus}, ${subtotal}, ${discount}, ${total}, ${dueOnline},
            ${promotionId}, ${holdExpires}, ${input.note?.slice(0, 500) ?? null})
          on conflict (reference) do nothing returning *`;
        booking = rows[0];
      }
      if (!booking) throw new AppError("reference_collision", "Please retry", 500);

      let cursor = startsAt.getTime();
      for (const [i, s] of ordered.entries()) {
        const st = new Date(cursor), en = new Date(cursor + s.duration_min * MIN);
        await tx`insert into booking_items (booking_id, service_id, service_name_ar, service_name_en, duration_min, price_halalas, starts_at, ends_at, sort)
          values (${booking.id}, ${s.id}, ${s.name_ar}, ${s.name_en}, ${s.duration_min}, ${s.price_halalas}, ${st}, ${en}, ${i})`;
        cursor = en.getTime();
      }
      if (promotionId) {
        const ok = await tx`update promotions set redemptions = redemptions + 1 where id = ${promotionId} and (max_redemptions is null or redemptions < max_redemptions) returning id`;
        if (!ok.length) throw new AppError("promo_exhausted", "Promo code has been fully redeemed");
        await tx`insert into promotion_redemptions (promotion_id, booking_id, customer_id, discount_halalas) values (${promotionId}, ${booking.id}, ${input.customerId}, ${discount})`;
      }
      await tx`insert into booking_events (booking_id, actor_id, event, data) values (${booking.id}, ${input.customerId}, 'created', ${tx.json({ status, paymentMethod: input.paymentMethod })})`;
      const [emp] = await tx<{ display_name_ar: string }[]>`select display_name_ar from employees where id = ${employeeId}`;
      return { ...booking, items: ordered.map((s) => ({ name: s.name_ar })), employeeName: emp.display_name_ar };
    });
  } catch (e) {
    mapDbError(e);
  }
  if (created.status !== "pending_payment") await sendBookingCreatedNotifications(created.id);
  return created;
}

export async function bookingNotificationData(bookingId: string, db: Db = sql) {
  const [b] = await db<{ reference: string; salon_name: string; starts_at: Date; total_halalas: number; employee: string; services: string; customer_id: string; salon_id: string; locale: "ar" | "en" }[]>`
    select b.reference, s.name_ar as salon_name, b.starts_at, b.total_halalas, e.display_name_ar as employee, b.customer_id, b.salon_id, u.locale,
      (select string_agg(service_name_ar, '، ' order by sort) from booking_items where booking_id = b.id) as services
    from bookings b join salons s on s.id = b.salon_id join employees e on e.id = b.employee_id join users u on u.id = b.customer_id where b.id = ${bookingId}`;
  return {
    b,
    data: { ref: b.reference, salon: b.salon_name, when: formatDateTime(b.starts_at, b.locale), total: sar(b.total_halalas, b.locale), employee: b.employee, services: b.services },
  };
}

export async function sendBookingCreatedNotifications(bookingId: string) {
  const { b, data } = await bookingNotificationData(bookingId);
  const [{ status }] = await sql<{ status: string }[]>`select status from bookings where id = ${bookingId}`;
  await notifyUser(b.customer_id, status === "pending_approval" ? "booking_pending_approval" : "booking_confirmed", data);
  await notifySalon(b.salon_id, "salon_new_booking", data);
  await scheduleReminder(bookingId);
}

async function scheduleReminder(bookingId: string) {
  const { b, data } = await bookingNotificationData(bookingId);
  const at = new Date(b.starts_at.getTime() - 24 * 3600_000);
  if (at > new Date()) {
    await sql`delete from notifications where template = 'booking_reminder' and status = 'queued' and payload->'data'->>'ref' = ${b.reference}`;
    await notifyUser(b.customer_id, "booking_reminder", data, { sendAfter: at, inApp: false, isReminder: true });
  }
}

// ------------------------------------------------------------------ helpers for state changes

async function lockBooking(tx: Tx, bookingId: string): Promise<BookingRow & SalonRow & { salon_status: string }> {
  const [b] = await tx<(BookingRow & SalonRow & { salon_status: string })[]>`
    select s.*, s.status as salon_status, b.* from bookings b join salons s on s.id = b.salon_id where b.id = ${bookingId} for update of b`;
  if (!b) throw notFound("booking");
  return b;
}

function assertActorCanManage(actor: Actor, b: BookingRow, mode: "manage" | "complete" | "customer") {
  if (actor.kind === "admin" || actor.kind === "system") return;
  if (actor.kind === "customer") { if (mode !== "customer" || b.customer_id !== actor.userId) throw forbidden(); return; }
  if (actor.salonId !== b.salon_id) throw forbidden();
  if (actor.ownEmployeeOnly && (mode !== "complete" || b.employee_id !== actor.ownEmployeeOnly)) throw forbidden();
}

async function event(tx: Db, bookingId: string, actorId: string | null, name: string, data: Record<string, unknown> = {}) {
  await tx`insert into booking_events (booking_id, actor_id, event, data) values (${bookingId}, ${actorId}, ${name}, ${tx.json(data as never)})`;
}

// ------------------------------------------------------------------ cancel

export function cancellationQuote(b: Pick<BookingRow, "starts_at" | "total_halalas" | "amount_paid_halalas" | "amount_refunded_halalas">,
  policy: { free_cancel_hours: number; late_cancel_fee_percent: number }, by: Actor["kind"], now = new Date()) {
  const paid = b.amount_paid_halalas - b.amount_refunded_halalas;
  const hoursBefore = (new Date(b.starts_at).getTime() - now.getTime()) / 3600_000;
  const late = by === "customer" && hoursBefore < policy.free_cancel_hours;
  const fee = late ? Math.min(paid, percentOf(b.total_halalas, policy.late_cancel_fee_percent)) : 0;
  return { late, fee, refund: paid - fee, hoursBefore };
}

export async function cancelBooking(bookingId: string, actor: Actor, reason?: string) {
  const res = await sql.begin(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    assertActorCanManage(actor, b, actor.kind === "customer" ? "customer" : "manage");
    if (!(ACTIVE_STATUSES as readonly string[]).includes(b.status)) throw new AppError("invalid_state", `Booking is ${b.status}`, 409);
    if (actor.kind === "customer" && new Date(b.starts_at) < new Date()) throw new AppError("too_late", "The appointment has already started");
    const q = cancellationQuote(b, b, actor.kind);
    await tx`update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = ${actor.userId}, cancel_reason = ${reason?.slice(0, 500) ?? null},
      payment_status = ${b.amount_paid_halalas > 0 ? (q.refund > 0 ? "paid" : "paid") : "cancelled"}, updated_at = now() where id = ${b.id}`;
    await event(tx, b.id, actor.userId, "cancelled", { by: actor.kind, reason, ...q });
    if (q.fee > 0) await postCommission(tx, { salonId: b.salon_id, bookingId: b.id, onlineNet: q.fee, cashCollected: 0, at: new Date(), actorId: actor.userId });
    return { b, q };
  });
  if (res.q.refund > 0) {
    const { refundBooking } = await import("../payments/service");
    await refundBooking(bookingId, res.q.refund, `Cancellation${res.q.late ? " (late fee retained)" : ""}`, actor.userId);
  }
  const { data } = await bookingNotificationData(bookingId);
  await notifyUser(res.b.customer_id, "booking_cancelled", data);
  await notifySalon(res.b.salon_id, "salon_booking_cancelled", data);
  await sql`update notifications set status = 'skipped', error = 'booking cancelled' where template = 'booking_reminder' and status = 'queued' and payload->'data'->>'ref' = ${res.b.reference}`;
  return { refund: res.q.refund, fee: res.q.fee };
}

// ------------------------------------------------------------------ reschedule

export async function rescheduleBooking(bookingId: string, actor: Actor, input: { date: string; time: string; employeeId?: string | null }) {
  try {
    await sql.begin(async (tx) => {
      await releaseExpiredHolds(tx);
      const b = await lockBooking(tx, bookingId);
      assertActorCanManage(actor, b, actor.kind === "customer" ? "customer" : "manage");
      if (!["pending_approval", "confirmed"].includes(b.status)) throw new AppError("invalid_state", `Booking is ${b.status}`, 409);
      if (actor.kind === "customer") {
        if (b.reschedule_count >= b.max_reschedules) throw new AppError("reschedule_limit", "Reschedule limit reached");
        const hoursBefore = (new Date(b.starts_at).getTime() - Date.now()) / 3600_000;
        if (hoursBefore < b.free_cancel_hours) throw new AppError("too_late", `Rescheduling is only possible up to ${b.free_cancel_hours} hours before the appointment`);
      }
      const items = await tx<{ id: string; service_id: string; duration_min: number }[]>`select id, service_id, duration_min from booking_items where booking_id = ${b.id} order by sort`;
      const employeeId = input.employeeId ?? b.employee_id;
      const day = await computeDay(tx, { salon: { ...b, id: b.salon_id, status: b.salon_status }, branchId: b.branch_id, date: input.date, serviceIds: items.map((i) => i.service_id), employeeId, excludeBookingId: b.id, ignoreLead: actor.kind !== "customer" });
      const slot = day.slots.find((s) => s.start === timeToMin(input.time));
      if (!slot) throw new AppError("slot_unavailable", "This time is not available", 409);
      const startsAt = localToUtc(input.date, input.time);
      const endsAt = new Date(startsAt.getTime() + day.durationMin * MIN);
      await tx`update bookings set starts_at = ${startsAt}, ends_at = ${endsAt}, blocked_until = ${new Date(endsAt.getTime() + b.buffer_min * MIN)},
        employee_id = ${employeeId}, reschedule_count = reschedule_count + ${actor.kind === "customer" ? 1 : 0}, reminder_sent_at = null, updated_at = now() where id = ${b.id}`;
      let cursor = startsAt.getTime();
      for (const it of items) {
        await tx`update booking_items set starts_at = ${new Date(cursor)}, ends_at = ${new Date(cursor + it.duration_min * MIN)} where id = ${it.id}`;
        cursor += it.duration_min * MIN;
      }
      await event(tx, b.id, actor.userId, "rescheduled", { from: b.starts_at, to: startsAt, employeeId });
    });
  } catch (e) { mapDbError(e); }
  const { b, data } = await bookingNotificationData(bookingId);
  await notifyUser(b.customer_id, "booking_rescheduled", data);
  await notifySalon(b.salon_id, "booking_rescheduled", data);
  await scheduleReminder(bookingId);
}

// ------------------------------------------------------------------ salon decisions

export async function decideBooking(bookingId: string, actor: Actor, decision: "accept" | "reject", reason?: string) {
  const b = await sql.begin(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    assertActorCanManage(actor, b, "manage");
    if (b.status !== "pending_approval") throw new AppError("invalid_state", `Booking is ${b.status}`, 409);
    await tx`update bookings set status = ${decision === "accept" ? "confirmed" : "rejected"}, cancel_reason = ${reason ?? null}, updated_at = now(),
      payment_status = ${decision === "reject" && b.amount_paid_halalas === 0 ? "cancelled" : b.payment_status} where id = ${b.id}`;
    await event(tx, b.id, actor.userId, decision === "accept" ? "accepted" : "rejected", { reason });
    return b;
  });
  if (decision === "reject" && b.amount_paid_halalas - b.amount_refunded_halalas > 0) {
    const { refundBooking } = await import("../payments/service");
    await refundBooking(bookingId, b.amount_paid_halalas - b.amount_refunded_halalas, "Rejected by salon", actor.userId);
  }
  const { data } = await bookingNotificationData(bookingId);
  await notifyUser(b.customer_id, decision === "accept" ? "booking_confirmed" : "booking_rejected", data);
}

/**
 * Marks a booking completed. `cashCollected` is the amount the salon physically received at the counter
 * (for cash bookings or the balance after a deposit). Commission is posted to the ledger here.
 */
export async function completeBooking(bookingId: string, actor: Actor, cashCollected?: number) {
  return sql.begin(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    assertActorCanManage(actor, b, "complete");
    if (b.status !== "confirmed") throw new AppError("invalid_state", `Booking is ${b.status}`, 409);
    if (new Date(b.starts_at) > new Date()) throw new AppError("not_started", "You can only complete an appointment after it has started");
    const onlineNet = b.amount_paid_halalas - b.amount_refunded_halalas;
    const balance = Math.max(0, b.total_halalas - onlineNet);
    const cash = cashCollected ?? balance;
    if (!Number.isInteger(cash) || cash < 0 || cash > balance * 2 + 100_000) throw new AppError("invalid_amount", "Invalid cash amount");
    await tx`update bookings set status = 'completed', completed_at = now(), cash_collected_halalas = ${cash},
      payment_status = ${cash >= balance ? "paid" : onlineNet > 0 || cash > 0 ? "partially_paid" : b.payment_status}, updated_at = now() where id = ${b.id}`;
    const split = await postCommission(tx, { salonId: b.salon_id, bookingId: b.id, onlineNet, cashCollected: cash, at: new Date(), actorId: actor.userId });
    // Platform-funded campaign discount: TREMLY reimburses the salon.
    if (b.promotion_id && b.discount_halalas > 0) {
      const [p] = await tx<{ salon_id: string | null }[]>`select salon_id from promotions where id = ${b.promotion_id}`;
      if (p && p.salon_id === null) await post(tx, [
        { salon_id: b.salon_id, booking_id: b.id, entry_type: "adjustment", account: "salon_payable", amount_halalas: b.discount_halalas, memo: "Platform campaign discount reimbursement" },
        { salon_id: b.salon_id, booking_id: b.id, entry_type: "adjustment", account: "platform_revenue", amount_halalas: -b.discount_halalas, memo: "Platform campaign discount" },
      ]);
    }
    await event(tx, b.id, actor.userId, "completed", { cashCollected: cash, ...split });
    return split;
  });
}

export async function markNoShow(bookingId: string, actor: Actor) {
  return sql.begin(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    assertActorCanManage(actor, b, "manage");
    if (b.status !== "confirmed") throw new AppError("invalid_state", `Booking is ${b.status}`, 409);
    if (new Date(b.starts_at) > new Date()) throw new AppError("not_started", "Appointment has not started yet");
    await tx`update bookings set status = 'no_show', updated_at = now() where id = ${b.id}`;
    const retained = b.amount_paid_halalas - b.amount_refunded_halalas;
    if (retained > 0) await postCommission(tx, { salonId: b.salon_id, bookingId: b.id, onlineNet: retained, cashCollected: 0, at: new Date(), actorId: actor.userId });
    await event(tx, b.id, actor.userId, "no_show");
    await audit(actor.userId, "booking.no_show", "booking", b.id, {}, tx);
  });
}

export function localSlotLabel(t: Date) {
  return utcToLocal(t);
}
