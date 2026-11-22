import { dashPage } from "@/lib/dashboard";
import { can } from "@/lib/auth/rbac";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDateTime, localToUtc, addDays, todayLocal, utcToLocal } from "@/lib/time";
import { maskPhone } from "@/lib/phone";
import { Badge, Empty, Flash, PageTitle } from "@/components/ui";
import { bookingAction } from "../actions";

type SP = Promise<Record<string, string | undefined>>;

export default async function DashBookings({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/bookings", "bookings.complete_own");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(todayLocal(), -7);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : addDays(todayLocal(), 30);
  const status = sp.status && Object.keys(t.status).includes(sp.status) ? sp.status : null;
  const q = sp.q?.trim().slice(0, 40) || null;
  const rows = await sql<{ id: string; reference: string; starts_at: Date; ends_at: Date; status: string; payment_status: string; payment_method: string; total_halalas: number; amount_paid_halalas: number; amount_refunded_halalas: number;
    customer: string | null; phone: string | null; employee: string; employee_id: string; services: string; customer_note: string | null }[]>`
    select b.id, b.reference, b.starts_at, b.ends_at, b.status, b.payment_status, b.payment_method, b.total_halalas, b.amount_paid_halalas, b.amount_refunded_halalas, b.customer_note,
      u.full_name as customer, u.phone, e.display_name_ar as employee, b.employee_id,
      (select string_agg(service_name_ar, '، ' order by sort) from booking_items where booking_id = b.id) as services
    from bookings b join users u on u.id = b.customer_id join employees e on e.id = b.employee_id
    where b.salon_id = ${ctx.salonId}
      ${q ? sql`and (b.reference ilike ${"%" + q + "%"} or u.phone like ${"%" + q.replace(/\D/g, "") + "%"} or u.full_name ilike ${"%" + q + "%"})` : sql`and b.starts_at >= ${localToUtc(from, "00:00")} and b.starts_at < ${localToUtc(addDays(to, 1), "00:00")}`}
      ${status ? sql`and b.status = ${status}` : sql`and b.status <> 'expired'`}
      ${ctx.role === "stylist" ? sql`and b.employee_id = ${ctx.employeeId}` : sql``}
    order by b.starts_at desc limit 300`;
  const employees = await sql<{ id: string; display_name_ar: string }[]>`select id, display_name_ar from employees where salon_id = ${ctx.salonId} and is_active order by display_name_ar`;
  const manage = can(ctx, "bookings.manage");
  const now = new Date();
  return (
    <div>
      <PageTitle title={ar ? "الحجوزات" : "Bookings"} />
      <Flash sp={sp} t={t} />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-5">
        <input name="q" defaultValue={q ?? ""} className="input" placeholder={ar ? "المرجع / الجوال / الاسم" : "Ref / phone / name"} />
        <input type="date" name="from" defaultValue={from} className="input" />
        <input type="date" name="to" defaultValue={to} className="input" />
        <select name="status" defaultValue={status ?? ""} className="input"><option value="">{t.common.all}</option>{Object.entries(t.status).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn-primary">{t.common.search}</button>
      </form>
      {rows.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="space-y-2">
          {rows.map((b) => {
            const showPhone = ["confirmed", "pending_approval", "completed", "no_show"].includes(b.status);
            const started = b.starts_at <= now;
            const balance = Math.max(0, b.total_halalas - (b.amount_paid_halalas - b.amount_refunded_halalas));
            const local = utcToLocal(b.starts_at);
            return (
              <details key={b.id} className="card group" open={!!q && rows.length === 1}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                  <span className="font-mono text-xs text-muted">{b.reference}</span>
                  <span className="font-medium tabular-nums">{formatDateTime(b.starts_at, locale)}</span>
                  <span className="flex-1 truncate text-sm">{b.services} · {b.employee}</span>
                  <Badge status={b.status} label={t.status[b.status as keyof typeof t.status]} />
                  <Badge status={b.payment_status} label={t.pay[b.payment_status as keyof typeof t.pay]} />
                  <span className="font-semibold tabular-nums">{sar(b.total_halalas, locale)}</span>
                </summary>
                <div className="grid gap-4 border-t border-line p-4 text-sm lg:grid-cols-2">
                  <div className="space-y-1">
                    <p><span className="text-muted">{t.common.customer}:</span> {b.customer ?? "—"} · <span dir="ltr">{showPhone ? b.phone : maskPhone(b.phone)}</span></p>
                    <p><span className="text-muted">{t.booking.payment}:</span> {b.payment_method} · {ar ? "مدفوع" : "paid"} {sar(b.amount_paid_halalas, locale)}{b.amount_refunded_halalas ? ` · ${ar ? "مسترد" : "refunded"} ${sar(b.amount_refunded_halalas, locale)}` : ""}</p>
                    {b.customer_note && <p className="rounded-lg bg-paper p-2">📝 {b.customer_note}</p>}
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {manage && b.status === "pending_approval" && <>
                      <form action={bookingAction}><input type="hidden" name="op" value="accept" /><input type="hidden" name="booking_id" value={b.id} /><button className="btn-primary btn-sm">{ar ? "قبول" : "Accept"}</button></form>
                      <form action={bookingAction} className="flex gap-1"><input type="hidden" name="op" value="reject" /><input type="hidden" name="booking_id" value={b.id} /><input name="reason" className="input py-1 text-xs" placeholder={t.common.reason} /><button className="btn-danger btn-sm">{ar ? "رفض" : "Reject"}</button></form>
                    </>}
                    {b.status === "confirmed" && started && (
                      <form action={bookingAction} className="flex items-center gap-1">
                        <input type="hidden" name="op" value="complete" /><input type="hidden" name="booking_id" value={b.id} />
                        <label className="text-xs text-muted">{ar ? "نقداً المحصل (ر.س)" : "Cash collected (SAR)"}</label>
                        <input name="cash" type="number" min={0} step="0.01" defaultValue={(balance / 100).toFixed(2)} className="input w-24 py-1 text-xs" />
                        <button className="btn-primary btn-sm">{ar ? "إكمال" : "Complete"}</button>
                      </form>
                    )}
                    {manage && b.status === "confirmed" && started && <form action={bookingAction}><input type="hidden" name="op" value="no_show" /><input type="hidden" name="booking_id" value={b.id} /><button className="btn-outline btn-sm">{t.status.no_show}</button></form>}
                    {manage && ["confirmed", "pending_approval"].includes(b.status) && (
                      <form action={bookingAction} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="op" value="reschedule" /><input type="hidden" name="booking_id" value={b.id} />
                        <input type="date" name="date" defaultValue={local.date} className="input w-36 py-1 text-xs" required />
                        <input type="time" name="time" step={300} defaultValue={local.time} className="input w-24 py-1 text-xs" required />
                        <select name="employee_id" defaultValue={b.employee_id} className="input w-32 py-1 text-xs">{employees.map((e) => <option key={e.id} value={e.id}>{e.display_name_ar}</option>)}</select>
                        <button className="btn-outline btn-sm">{t.booking.reschedule}</button>
                      </form>
                    )}
                    {manage && ["confirmed", "pending_approval", "pending_payment"].includes(b.status) && (
                      <form action={bookingAction} className="flex gap-1"><input type="hidden" name="op" value="cancel" /><input type="hidden" name="booking_id" value={b.id} /><input name="reason" className="input py-1 text-xs" placeholder={t.common.reason} /><button className="btn-danger btn-sm">{t.common.cancel}</button></form>
                    )}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
