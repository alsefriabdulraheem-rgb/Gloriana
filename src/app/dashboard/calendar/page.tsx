import Link from "next/link";
import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { addDays, localToUtc, minToTime, timeToMin, todayLocal, utcToLocal, weekdayOf, formatDate } from "@/lib/time";
import { Flash, PageTitle, Tabs } from "@/components/ui";
import { addTimeOff, removeTimeOff } from "../actions";

type SP = Promise<Record<string, string | undefined>>;
const COLORS: Record<string, string> = {
  confirmed: "bg-plum-100 border-plum-500 text-plum-900", pending_approval: "bg-amber-50 border-amber-500 text-amber-900", pending_payment: "bg-amber-50 border-amber-300 text-amber-800",
  completed: "bg-sky-50 border-sky-500 text-sky-900", no_show: "bg-red-50 border-red-400 text-red-800",
};

export default async function Calendar({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/calendar", "bookings.complete_own");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const view = sp.view === "week" || sp.view === "month" ? sp.view : "day";
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayLocal();
  let start = date, days = 1;
  if (view === "week") { start = addDays(date, -weekdayOf(date)); days = 7; }
  if (view === "month") { start = date.slice(0, 8) + "01"; const [y, m] = date.split("-").map(Number); days = new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  const rangeStart = localToUtc(start, "00:00"), rangeEnd = localToUtc(addDays(start, days), "00:00");
  const stylistOnly = ctx.role === "stylist";
  const employees = await sql<{ id: string; display_name_ar: string }[]>`select id, display_name_ar from employees where salon_id = ${ctx.salonId} and is_active
    ${stylistOnly ? sql`and id = ${ctx.employeeId}` : sql``} order by created_at`;
  const empIds = employees.map((e) => e.id);
  const bookings = empIds.length ? await sql<{ id: string; reference: string; employee_id: string; starts_at: Date; ends_at: Date; status: string; customer: string | null; services: string }[]>`
    select b.id, b.reference, b.employee_id, b.starts_at, b.ends_at, b.status, u.full_name as customer, (select string_agg(service_name_ar, '، ') from booking_items where booking_id = b.id) as services
    from bookings b join users u on u.id = b.customer_id
    where b.employee_id in ${sql(empIds)} and b.starts_at < ${rangeEnd} and b.ends_at > ${rangeStart} and b.status in ('confirmed','pending_approval','pending_payment','completed','no_show')
    order by b.starts_at` : [];
  const timeOff = empIds.length ? await sql<{ id: string; employee_id: string; starts_at: Date; ends_at: Date; kind: string; reason: string | null }[]>`
    select id, employee_id, starts_at, ends_at, kind, reason from employee_time_off where employee_id in ${sql(empIds)} and starts_at < ${rangeEnd} and ends_at > ${rangeStart} order by starts_at` : [];
  const [hours] = await sql<{ open: string | null; close: string | null }[]>`select min(open_time)::text as open, max(close_time)::text as close from branch_hours h join salon_branches b on b.id = h.branch_id where b.salon_id = ${ctx.salonId} and not h.is_closed`;
  const dayFrom = Math.floor(timeToMin(hours?.open ?? "09:00") / 60) * 60, dayTo = Math.ceil(timeToMin(hours?.close ?? "22:00") / 60) * 60;
  const PX = 1.1; // px per minute
  const link = (o: Record<string, string>) => `/dashboard/calendar?${new URLSearchParams({ view, date, ...o })}`;
  const step = view === "day" ? 1 : view === "week" ? 7 : 30;
  const back = link({});

  return (
    <div>
      <PageTitle title={ar ? "التقويم" : "Calendar"}>
        <Link className="btn-outline btn-sm" href={link({ date: addDays(date, -step) })}>‹</Link>
        <Link className="btn-outline btn-sm" href={link({ date: todayLocal() })}>{ar ? "اليوم" : "Today"}</Link>
        <Link className="btn-outline btn-sm" href={link({ date: addDays(date, step) })}>›</Link>
      </PageTitle>
      <Flash sp={sp} t={t} />
      <Tabs active={view} items={[{ key: "day", label: ar ? "يومي" : "Day", href: link({ view: "day" }) }, { key: "week", label: ar ? "أسبوعي" : "Week", href: link({ view: "week" }) }, { key: "month", label: ar ? "شهري" : "Month", href: link({ view: "month" }) }]} />
      <p className="mb-3 font-medium">{formatDate(start, locale)}{days > 1 ? ` — ${formatDate(addDays(start, days - 1), locale)}` : ""}</p>

      {view === "day" && (
        <div className="card overflow-x-auto">
          <div className="flex min-w-max">
            <div className="w-14 shrink-0 border-e border-line pt-10">
              {Array.from({ length: (dayTo - dayFrom) / 60 }).map((_, i) => <div key={i} className="border-t border-line/60 pe-1 text-end text-[10px] text-muted" style={{ height: 60 * PX }}>{minToTime(dayFrom + i * 60)}</div>)}
            </div>
            {employees.map((e) => (
              <div key={e.id} className="w-48 shrink-0 border-e border-line">
                <div className="sticky top-0 h-10 border-b border-line bg-white p-2 text-center text-sm font-semibold">{e.display_name_ar}</div>
                <div className="relative" style={{ height: (dayTo - dayFrom) * PX }}>
                  {Array.from({ length: (dayTo - dayFrom) / 60 }).map((_, i) => <div key={i} className="border-t border-line/60" style={{ height: 60 * PX }} />)}
                  {timeOff.filter((x) => x.employee_id === e.id).map((x) => {
                    const s = Math.max(dayFrom, x.starts_at < rangeStart ? 0 : utcToLocal(x.starts_at).minutes), en = Math.min(dayTo, x.ends_at >= rangeEnd ? 1440 : utcToLocal(x.ends_at).minutes);
                    if (en <= s) return null;
                    return <div key={x.id} className="absolute inset-x-1 rounded-md bg-[repeating-linear-gradient(45deg,#eee,#eee_6px,#f7f7f7_6px,#f7f7f7_12px)] p-1 text-[10px] text-muted" style={{ top: (s - dayFrom) * PX, height: (en - s) * PX }}>{x.kind} {x.reason ?? ""}</div>;
                  })}
                  {bookings.filter((b) => b.employee_id === e.id).map((b) => {
                    const s = utcToLocal(b.starts_at).minutes, en = utcToLocal(b.ends_at).minutes || 1440;
                    return (
                      <Link key={b.id} href={`/dashboard/bookings?q=${b.reference}`} className={`absolute inset-x-1 overflow-hidden rounded-md border-s-4 p-1.5 text-[11px] leading-tight shadow-sm ${COLORS[b.status] ?? ""}`} style={{ top: (s - dayFrom) * PX, height: Math.max(22, (en - s) * PX) }}>
                        <b className="tabular-nums">{minToTime(s)}</b> {b.customer ?? ""}<br />{b.services}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="grid gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = addDays(start, i);
            const list = bookings.filter((b) => utcToLocal(b.starts_at).date === d);
            return (
              <div key={d} className={`card min-h-40 p-2 ${d === todayLocal() ? "ring-2 ring-plum-200" : ""}`}>
                <Link href={link({ view: "day", date: d })} className="mb-2 block text-xs font-semibold">{t.days[i]} {d.slice(8)}</Link>
                <div className="space-y-1">
                  {list.map((b) => <Link key={b.id} href={`/dashboard/bookings?q=${b.reference}`} className={`block rounded border-s-4 px-1.5 py-1 text-[11px] ${COLORS[b.status] ?? ""}`}><b className="tabular-nums">{utcToLocal(b.starts_at).time}</b> {employees.find((e) => e.id === b.employee_id)?.display_name_ar}<br /><span className="opacity-80">{b.services}</span></Link>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "month" && (
        <div className="grid grid-cols-7 gap-1 text-xs">
          {t.days.map((d) => <div key={d} className="p-1 text-center font-semibold text-muted">{d.slice(0, 3)}</div>)}
          {Array.from({ length: weekdayOf(start) }).map((_, i) => <div key={"pad" + i} />)}
          {Array.from({ length: days }).map((_, i) => {
            const d = addDays(start, i);
            const n = bookings.filter((b) => utcToLocal(b.starts_at).date === d).length;
            return <Link key={d} href={link({ view: "day", date: d })} className={`card flex h-20 flex-col p-1.5 hover:border-plum-200 ${d === todayLocal() ? "ring-2 ring-plum-200" : ""}`}><span className="font-semibold">{Number(d.slice(8))}</span>{n > 0 && <span className="mt-auto badge bg-plum-100 text-plum-700">{n} {ar ? "حجز" : "bkg"}</span>}</Link>;
          })}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <form action={addTimeOff} className="card space-y-3 p-4">
          <h2 className="font-semibold">{ar ? "حظر وقت / إجازة" : "Block time / day off"}</h2>
          <input type="hidden" name="back" value={back} />
          <select name="employee_id" className="input" required>{employees.map((e) => <option key={e.id} value={e.id}>{e.display_name_ar}</option>)}</select>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">{t.common.from}</label><input type="date" name="date" defaultValue={date} className="input" required /></div>
            <div><label className="label">{t.common.to}</label><input type="date" name="date_to" defaultValue={date} className="input" /></div>
            <input type="time" name="from" className="input" placeholder="00:00" />
            <input type="time" name="to" className="input" placeholder="23:59" />
          </div>
          <select name="kind" className="input"><option value="blocked">{ar ? "وقت محظور" : "Blocked"}</option><option value="time_off">{ar ? "إجازة" : "Day off"}</option><option value="sick">{ar ? "مرضية" : "Sick"}</option></select>
          <input name="reason" className="input" placeholder={t.common.reason} />
          <button className="btn-primary">{t.common.add}</button>
        </form>
        <div className="card p-4">
          <h2 className="mb-3 font-semibold">{ar ? "الأوقات المحظورة في هذه الفترة" : "Blocked periods in range"}</h2>
          {timeOff.length === 0 ? <p className="text-sm text-muted">{t.common.none}</p> : (
            <ul className="space-y-2 text-sm">
              {timeOff.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <span>{employees.find((e) => e.id === x.employee_id)?.display_name_ar} · {utcToLocal(x.starts_at).date} {utcToLocal(x.starts_at).time} → {utcToLocal(x.ends_at).date} {utcToLocal(x.ends_at).time} · {x.kind}</span>
                  <form action={removeTimeOff}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="back" value={back} /><button className="text-red-700">✕</button></form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
