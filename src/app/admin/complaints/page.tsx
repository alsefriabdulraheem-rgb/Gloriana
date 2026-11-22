import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { Badge, Empty, Flash, PageTitle } from "@/components/ui";
import { updateComplaint } from "../actions";

export default async function Complaints({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const rows = await sql<{ id: string; reference: string; subject: string; body: string; status: string; resolution: string | null; created_at: Date; customer: string | null; phone: string | null; salon: string | null; booking: string | null }[]>`
    select c.id, c.reference, c.subject, c.body, c.status, c.resolution, c.created_at, u.full_name as customer, u.phone, s.name_ar as salon, b.reference as booking
    from complaints c left join users u on u.id = c.customer_id left join salons s on s.id = c.salon_id left join bookings b on b.id = c.booking_id
    order by (c.status in ('open','in_progress')) desc, c.created_at desc limit 200`;
  return (
    <div>
      <PageTitle title={ar ? "الشكاوى والنزاعات" : "Complaints & disputes"} />
      <Flash sp={sp} t={t} />
      {rows.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="space-y-3">{rows.map((c) => (
          <div key={c.id} className="card p-4 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{c.reference}</span><b>{c.subject}</b><Badge status={c.status} /><span className="text-xs text-muted">{formatDateTime(c.created_at, locale)} · {c.customer} <span dir="ltr">{c.phone}</span> · {c.salon} · {c.booking}</span></div>
            <p className="mb-3 whitespace-pre-line">{c.body}</p>
            <form action={updateComplaint} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={c.id} />
              <select name="status" defaultValue={c.status} className="input w-36"><option value="open">open</option><option value="in_progress">in_progress</option><option value="resolved">resolved</option><option value="rejected">rejected</option></select>
              <input name="resolution" defaultValue={c.resolution ?? ""} className="input flex-1" placeholder={ar ? "القرار / الملاحظات" : "Resolution / notes"} />
              <button className="btn-primary btn-sm">{t.common.save}</button>
              {c.booking && <a className="btn-ghost btn-sm" href={`/admin/payments?q=${c.booking}`}>{ar ? "استرداد" : "Refund"} →</a>}
            </form>
          </div>
        ))}</div>
      )}
    </div>
  );
}
