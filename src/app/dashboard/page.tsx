import Link from "next/link";
import { dashPage } from "@/lib/dashboard";
import { can } from "@/lib/auth/rbac";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatTime, todayLocal, localToUtc, addDays } from "@/lib/time";
import { Badge, Empty, Flash, PageTitle, Stat } from "@/components/ui";
import { submitForReview } from "./actions";

export default async function DashHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const today = todayLocal();
  const dayStart = localToUtc(today, "00:00"), dayEnd = localToUtc(addDays(today, 1), "00:00");
  const own = ctx.role === "stylist" ? sql`and b.employee_id = ${ctx.employeeId}` : sql``;
  const [stats] = await sql<{ today: number; pending: number; week_rev: number; month_rev: number; month_count: number; cancel_rate: number; rating: number; rating_count: number }[]>`
    select
      (select count(*)::int from bookings b where b.salon_id = ${ctx.salonId} and b.starts_at >= ${dayStart} and b.starts_at < ${dayEnd} and b.status in ('confirmed','completed','pending_approval') ${own}) as today,
      (select count(*)::int from bookings b where b.salon_id = ${ctx.salonId} and b.status = 'pending_approval' ${own}) as pending,
      (select coalesce(sum(total_halalas),0)::int from bookings b where b.salon_id = ${ctx.salonId} and b.status = 'completed' and b.completed_at > now() - interval '7 days' ${own}) as week_rev,
      (select coalesce(sum(total_halalas),0)::int from bookings b where b.salon_id = ${ctx.salonId} and b.status = 'completed' and b.completed_at > now() - interval '30 days' ${own}) as month_rev,
      (select count(*)::int from bookings b where b.salon_id = ${ctx.salonId} and b.created_at > now() - interval '30 days' and b.status <> 'expired' ${own}) as month_count,
      (select coalesce(round(100.0 * count(*) filter (where status = 'cancelled') / nullif(count(*), 0)), 0)::int from bookings b where b.salon_id = ${ctx.salonId} and b.created_at > now() - interval '30 days' and b.status <> 'expired' ${own}) as cancel_rate,
      (select rating_avg::float from salons where id = ${ctx.salonId}) as rating, (select rating_count from salons where id = ${ctx.salonId}) as rating_count`;
  const todays = await sql<{ id: string; reference: string; starts_at: Date; status: string; payment_status: string; customer: string | null; employee: string; services: string }[]>`
    select b.id, b.reference, b.starts_at, b.status, b.payment_status, u.full_name as customer, e.display_name_ar as employee,
      (select string_agg(service_name_ar, '، ') from booking_items where booking_id = b.id) as services
    from bookings b join users u on u.id = b.customer_id join employees e on e.id = b.employee_id
    where b.salon_id = ${ctx.salonId} and b.starts_at >= ${dayStart} and b.starts_at < ${dayEnd} and b.status in ('confirmed','completed','pending_approval','no_show') ${own}
    order by b.starts_at`;
  const [check] = await sql<{ services: number; employees: number; schedules: number; branches: number; cr: string | null; cover: string | null }[]>`
    select (select count(*)::int from services where salon_id = ${ctx.salonId} and is_active) as services,
      (select count(*)::int from employees where salon_id = ${ctx.salonId} and is_active) as employees,
      (select count(*)::int from employee_schedules es join employees e on e.id = es.employee_id where e.salon_id = ${ctx.salonId}) as schedules,
      (select count(*)::int from salon_branches where salon_id = ${ctx.salonId} and is_active) as branches,
      (select commercial_registration from salons where id = ${ctx.salonId}) as cr, (select cover_url from salons where id = ${ctx.salonId}) as cover`;
  const [salon] = await sql<{ status: string; status_reason: string | null }[]>`select status, status_reason from salons where id = ${ctx.salonId}`;
  const steps = [
    [ar ? "أضف خدمة واحدة على الأقل" : "Add at least one service", check.services > 0, "/dashboard/services"],
    [ar ? "أضف موظفاً بجدول عمل" : "Add an employee with a schedule", check.employees > 0 && check.schedules > 0, "/dashboard/staff"],
    [ar ? "حدد ساعات العمل والموقع" : "Set hours and location", check.branches > 0, "/dashboard/branches"],
    [ar ? "أضف صورة الغلاف والسجل التجاري" : "Add cover photo and CR", !!check.cover && !!check.cr, "/dashboard/profile"],
  ] as const;

  return (
    <div>
      <PageTitle title={ar ? "نظرة عامة" : "Overview"} />
      <Flash sp={sp} t={t} />
      {salon.status !== "approved" && (
        <div className="card mb-6 border-amber-200 bg-amber-50/60 p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold"><Badge status={salon.status} />
            {salon.status === "draft" && (ar ? "أكمل إعداد صالونك ثم أرسله للمراجعة" : "Complete your setup, then submit for review")}
            {salon.status === "pending_review" && (ar ? "صالونك قيد المراجعة من فريق تريملي" : "Your salon is being reviewed by TREMLY")}
            {salon.status === "rejected" && (ar ? "تم رفض الطلب" : "Application rejected")}
            {salon.status === "suspended" && (ar ? "الحساب موقوف مؤقتاً" : "Salon suspended")}
          </div>
          {salon.status_reason && <p className="mb-2 text-sm">{salon.status_reason}</p>}
          {["draft", "rejected"].includes(salon.status) && (
            <>
              <ul className="mb-4 space-y-1 text-sm">{steps.map(([label, done, href]) => <li key={href}><Link href={href} className="hover:underline">{done ? "✅" : "⬜"} {label}</Link></li>)}</ul>
              {can(ctx, "policies.manage") && <form action={submitForReview}><button className="btn-primary" disabled={!steps.every((s) => s[1])}>{ar ? "إرسال للمراجعة" : "Submit for review"}</button></form>}
            </>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={ar ? "حجوزات اليوم" : "Today's bookings"} value={stats.today} />
        <Stat label={ar ? "بانتظار الموافقة" : "Awaiting approval"} value={stats.pending} />
        <Stat label={ar ? "إيراد 7 أيام" : "7-day revenue"} value={sar(stats.week_rev, locale)} hint={`${ar ? "30 يوماً" : "30 days"}: ${sar(stats.month_rev, locale)}`} />
        <Stat label={ar ? "التقييم" : "Rating"} value={`★ ${stats.rating ? stats.rating.toFixed(1) : "—"}`} hint={`${stats.rating_count} · ${ar ? "نسبة الإلغاء" : "cancel rate"} ${stats.cancel_rate}% · ${stats.month_count} ${ar ? "حجز/30 يوماً" : "bookings/30d"}`} />
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">{ar ? "مواعيد اليوم" : "Today's appointments"}</h2>
      {todays.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>{t.book.time}</th><th>{t.common.customer}</th><th>{t.salon.services}</th><th>{t.book.employee}</th><th>{t.common.status}</th><th /></tr></thead>
            <tbody>{todays.map((b) => (
              <tr key={b.id}><td className="tabular-nums">{formatTime(b.starts_at, locale)}</td><td>{b.customer ?? "—"}</td><td>{b.services}</td><td>{b.employee}</td>
                <td><Badge status={b.status} label={t.status[b.status as keyof typeof t.status]} /> <Badge status={b.payment_status} label={t.pay[b.payment_status as keyof typeof t.pay]} /></td>
                <td><Link className="text-plum-700 hover:underline" href={`/dashboard/bookings?q=${b.reference}`}>{b.reference}</Link></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
