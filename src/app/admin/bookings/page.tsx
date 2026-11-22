import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { Badge, Empty, Flash, PageTitle } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { adminCancelBooking } from "../actions";

export default async function AdminBookings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const q = sp.q?.trim() || null;
  const status = sp.status || null, method = sp.method || null, salon = sp.salon && /^[0-9a-f-]{36}$/.test(sp.salon) ? sp.salon : null;
  const rows = await sql<{ id: string; reference: string; created_at: Date; starts_at: Date; status: string; payment_status: string; payment_method: string; total_halalas: number; amount_paid_halalas: number; amount_refunded_halalas: number; cash_collected_halalas: number; salon: string; customer: string | null; phone: string | null; employee: string }[]>`
    select b.id, b.reference, b.created_at, b.starts_at, b.status, b.payment_status, b.payment_method, b.total_halalas, b.amount_paid_halalas, b.amount_refunded_halalas, b.cash_collected_halalas,
      s.name_ar as salon, u.full_name as customer, u.phone, e.display_name_ar as employee
    from bookings b join salons s on s.id = b.salon_id join users u on u.id = b.customer_id join employees e on e.id = b.employee_id
    where true ${q ? sql`and (b.reference ilike ${"%" + q + "%"} or u.phone like ${"%" + q + "%"})` : sql``}
      ${status ? sql`and b.status = ${status}` : sql``} ${method ? sql`and b.payment_method = ${method}` : sql``} ${salon ? sql`and b.salon_id = ${salon}` : sql``}
    order by b.created_at desc limit 300`;
  return (
    <div>
      <PageTitle title={ar ? "كل الحجوزات" : "All bookings"}><LiveRefresh label={ar ? "مباشر" : "Live"} /></PageTitle>
      <Flash sp={sp} t={t} />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-4">
        <input name="q" defaultValue={q ?? ""} className="input" placeholder="Ref / phone" />
        <select name="status" defaultValue={status ?? ""} className="input"><option value="">{t.common.all}</option>{Object.entries(t.status).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="method" defaultValue={method ?? ""} className="input"><option value="">{t.common.all}</option><option value="online">online</option><option value="deposit">deposit</option><option value="cash">cash</option></select>
        {salon && <input type="hidden" name="salon" value={salon} />}
        <button className="btn-primary">{t.common.search}</button>
      </form>
      {rows.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="card overflow-x-auto"><table className="table text-xs">
          <thead><tr><th>Ref</th><th>{ar ? "أنشئ" : "Created"}</th><th>{ar ? "الموعد" : "Appointment"}</th><th>{ar ? "الصالون" : "Salon"}</th><th>{t.common.customer}</th><th>{ar ? "الطريقة" : "Method"}</th><th>{t.common.status}</th><th>{t.common.total}</th><th>{ar ? "مدفوع/مسترد/نقدي" : "Paid/refunded/cash"}</th><th /></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}><td className="font-mono">{b.reference}</td><td>{formatDateTime(b.created_at, locale)}</td><td>{formatDateTime(b.starts_at, locale)}</td><td>{b.salon}<div className="text-muted">{b.employee}</div></td>
              <td>{b.customer}<div dir="ltr" className="text-muted">{b.phone}</div></td><td>{b.payment_method}</td>
              <td><Badge status={b.status} label={t.status[b.status as keyof typeof t.status]} /><br /><Badge status={b.payment_status} label={t.pay[b.payment_status as keyof typeof t.pay]} /></td>
              <td className="tabular-nums">{sar(b.total_halalas, locale)}</td><td className="tabular-nums">{sar(b.amount_paid_halalas, locale)} / {sar(b.amount_refunded_halalas, locale)} / {sar(b.cash_collected_halalas, locale)}</td>
              <td>{["pending_payment", "pending_approval", "confirmed"].includes(b.status) && (
                <form action={adminCancelBooking} className="flex gap-1"><input type="hidden" name="booking_id" value={b.id} /><input type="hidden" name="back" value="/admin/bookings" /><input name="reason" className="input w-28 py-1" placeholder={t.common.reason} /><button className="btn-danger btn-sm">✕</button></form>
              )}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
