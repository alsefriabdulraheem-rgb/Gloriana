import { notFound } from "next/navigation";
import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDateTime, utcToLocal } from "@/lib/time";
import { Avatar, Badge, Flash, PageTitle, Stat } from "@/components/ui";
import { addTimeOff, removeTimeOff, saveEmployee, saveEmployeeServices, saveSchedule } from "../../actions";

export default async function StaffDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await dashPage(`/dashboard/staff/${id}`, "staff.manage");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const [e] = await sql<{ id: string; display_name_ar: string; display_name_en: string | null; title_ar: string | null; title_en: string | null; bio_ar: string | null; bio_en: string | null; photo_url: string | null; branch_id: string; is_active: boolean; rating_avg: number; rating_count: number }[]>`
    select *, rating_avg::float as rating_avg from employees where id = ${id} and salon_id = ${ctx.salonId}`;
  if (!e) notFound();
  const [branches, services, assigned, schedule, breaks, off, history, [perf]] = await Promise.all([
    sql<{ id: string; name_ar: string }[]>`select id, name_ar from salon_branches where salon_id = ${ctx.salonId}`,
    sql<{ id: string; name_ar: string }[]>`select id, name_ar from services where salon_id = ${ctx.salonId} and is_active order by sort, name_ar`,
    sql<{ service_id: string }[]>`select service_id from employee_services where employee_id = ${id}`,
    sql<{ weekday: number; start_time: string; end_time: string }[]>`select weekday, to_char(start_time,'HH24:MI') as start_time, to_char(end_time,'HH24:MI') as end_time from employee_schedules where employee_id = ${id}`,
    sql<{ weekday: number; start_time: string; end_time: string }[]>`select weekday, to_char(start_time,'HH24:MI') as start_time, to_char(end_time,'HH24:MI') as end_time from employee_breaks where employee_id = ${id}`,
    sql<{ id: string; starts_at: Date; ends_at: Date; kind: string; reason: string | null }[]>`select * from employee_time_off where employee_id = ${id} and ends_at > now() order by starts_at`,
    sql<{ reference: string; starts_at: Date; status: string; total_halalas: number; customer: string | null }[]>`select b.reference, b.starts_at, b.status, b.total_halalas, u.full_name as customer from bookings b join users u on u.id = b.customer_id where b.employee_id = ${id} and b.status <> 'expired' order by b.starts_at desc limit 30`,
    sql<{ completed: number; revenue: number; no_shows: number; cancelled: number; upcoming: number }[]>`select
      count(*) filter (where status = 'completed')::int as completed, coalesce(sum(total_halalas) filter (where status = 'completed'),0)::int as revenue,
      count(*) filter (where status = 'no_show')::int as no_shows, count(*) filter (where status = 'cancelled')::int as cancelled,
      count(*) filter (where status = 'confirmed' and starts_at > now())::int as upcoming from bookings where employee_id = ${id} and created_at > now() - interval '90 days'`,
  ]);
  const back = `/dashboard/staff/${id}`;
  return (
    <div className="space-y-6">
      <PageTitle title={e.display_name_ar} />
      <Flash sp={sp} t={t} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={ar ? "مكتملة (90 يوماً)" : "Completed (90d)"} value={perf.completed} />
        <Stat label={ar ? "الإيراد" : "Revenue"} value={sar(perf.revenue, locale)} />
        <Stat label={ar ? "قادمة" : "Upcoming"} value={perf.upcoming} />
        <Stat label={ar ? "لم يحضر / ملغي" : "No-show / cancelled"} value={`${perf.no_shows} / ${perf.cancelled}`} />
        <Stat label={ar ? "التقييم" : "Rating"} value={`★ ${e.rating_avg ? e.rating_avg.toFixed(1) : "—"}`} hint={`${e.rating_count}`} />
      </div>

      <form action={saveEmployee} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <input type="hidden" name="id" value={e.id} />
        <div className="flex items-center gap-3 sm:col-span-3"><Avatar name={e.display_name_ar} url={e.photo_url} size={64} /><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="input max-w-xs" /></div>
        <div><label className="label">{ar ? "الاسم (عربي)" : "Name (Arabic)"}</label><input name="display_name_ar" defaultValue={e.display_name_ar} className="input" required /></div>
        <div><label className="label">{ar ? "الاسم (إنجليزي)" : "Name (English)"}</label><input name="display_name_en" defaultValue={e.display_name_en ?? ""} className="input" dir="ltr" /></div>
        <div><label className="label">{t.book.branch}</label><select name="branch_id" defaultValue={e.branch_id} className="input">{branches.map((b) => <option key={b.id} value={b.id}>{b.name_ar}</option>)}</select></div>
        <div><label className="label">{ar ? "المسمى" : "Title"}</label><input name="title_ar" defaultValue={e.title_ar ?? ""} className="input" /></div>
        <div><label className="label">{ar ? "المسمى (إنجليزي)" : "Title (English)"}</label><input name="title_en" defaultValue={e.title_en ?? ""} className="input" dir="ltr" /></div>
        <label className="flex items-end gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={e.is_active} className="h-5 w-5 accent-plum-700" />{t.common.active}</label>
        <div className="sm:col-span-2"><label className="label">{ar ? "نبذة" : "Bio"}</label><textarea name="bio_ar" defaultValue={e.bio_ar ?? ""} className="input" rows={2} /></div>
        <div><label className="label">Bio (EN)</label><textarea name="bio_en" defaultValue={e.bio_en ?? ""} className="input" rows={2} dir="ltr" /></div>
        <div><button className="btn-primary">{t.common.save}</button></div>
      </form>

      <form action={saveEmployeeServices} className="card p-4">
        <input type="hidden" name="id" value={e.id} />
        <h2 className="mb-3 font-semibold">{ar ? "الخدمات المسندة" : "Assigned services"}</h2>
        <div className="mb-3 flex flex-wrap gap-2">{services.map((s) => <label key={s.id} className="chip cursor-pointer"><input type="checkbox" name="services" value={s.id} defaultChecked={assigned.some((a) => a.service_id === s.id)} className="accent-plum-700" />{s.name_ar}</label>)}</div>
        <button className="btn-primary btn-sm">{t.common.save}</button>
      </form>

      <form action={saveSchedule} className="card overflow-x-auto p-4">
        <input type="hidden" name="id" value={e.id} />
        <h2 className="mb-3 font-semibold">{ar ? "جدول العمل الأسبوعي والاستراحات" : "Weekly schedule & breaks"}</h2>
        <table className="table">
          <thead><tr><th>{t.common.date}</th><th>{ar ? "عطلة" : "Off"}</th><th>{t.common.from}</th><th>{t.common.to}</th><th>{ar ? "استراحة من" : "Break from"}</th><th>{ar ? "إلى" : "to"}</th></tr></thead>
          <tbody>{t.days.map((d, w) => {
            const s = schedule.find((x) => x.weekday === w), b = breaks.find((x) => x.weekday === w);
            return (
              <tr key={w}><td className="font-medium">{d}</td>
                <td><input type="checkbox" name={`off_${w}`} defaultChecked={!s} className="h-4 w-4 accent-plum-700" /></td>
                <td><input type="time" name={`start_${w}`} defaultValue={s?.start_time ?? "10:00"} className="input py-1" /></td>
                <td><input type="time" name={`end_${w}`} defaultValue={s?.end_time ?? "22:00"} className="input py-1" /></td>
                <td><input type="time" name={`bstart_${w}`} defaultValue={b?.start_time ?? ""} className="input py-1" /></td>
                <td><input type="time" name={`bend_${w}`} defaultValue={b?.end_time ?? ""} className="input py-1" /></td></tr>
            );
          })}</tbody>
        </table>
        <button className="btn-primary btn-sm mt-3">{t.common.save}</button>
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        <form action={addTimeOff} className="card space-y-3 p-4">
          <h2 className="font-semibold">{ar ? "إجازة / يوم عطلة" : "Day off / vacation"}</h2>
          <input type="hidden" name="employee_id" value={e.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="time_off" />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" name="date" className="input" required /><input type="date" name="date_to" className="input" />
            <input type="time" name="from" className="input" /><input type="time" name="to" className="input" />
          </div>
          <input name="reason" className="input" placeholder={t.common.reason} />
          <button className="btn-primary btn-sm">{t.common.add}</button>
          <ul className="space-y-1 text-sm">{off.map((o) => (
            <li key={o.id} className="flex justify-between"><span>{utcToLocal(o.starts_at).date} {utcToLocal(o.starts_at).time} → {utcToLocal(o.ends_at).date} {utcToLocal(o.ends_at).time} ({o.kind}) {o.reason}</span>
              <button formAction={removeTimeOff} formNoValidate name="id" value={o.id} className="text-red-700">✕</button></li>
          ))}</ul>
        </form>
        <div className="card p-4">
          <h2 className="mb-3 font-semibold">{ar ? "سجل المواعيد" : "Appointment history"}</h2>
          <ul className="divide-y divide-line text-sm">{history.map((h) => (
            <li key={h.reference} className="flex items-center gap-2 py-2"><span className="flex-1">{formatDateTime(h.starts_at, locale)} · {h.customer ?? "—"}</span><Badge status={h.status} label={t.status[h.status as keyof typeof t.status]} /><span className="tabular-nums">{sar(h.total_halalas, locale)}</span></li>
          ))}</ul>
        </div>
      </div>
    </div>
  );
}
