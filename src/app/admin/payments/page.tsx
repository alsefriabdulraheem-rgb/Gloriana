import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { Badge, Flash, PageTitle, Stat, Tabs } from "@/components/ui";
import { adminReconcile, adminRefund } from "../actions";
import { paymentProvider } from "@/lib/payments";

export default async function AdminPayments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const tab = sp.tab === "refunds" ? "refunds" : sp.tab === "webhooks" ? "webhooks" : "payments";
  const [sum] = await sql<{ paid: number; refunded: number; initiated: number; failed: number }[]>`select
    coalesce(sum(amount_halalas) filter (where status in ('paid','partially_refunded','refunded')),0)::int as paid,
    coalesce(sum(refunded_halalas),0)::int as refunded, count(*) filter (where status = 'initiated')::int as initiated, count(*) filter (where status = 'failed')::int as failed from payments`;
  const payments = tab === "payments" ? await sql<{ id: string; created_at: Date; reference: string; booking_id: string; provider_ref: string | null; amount_halalas: number; refunded_halalas: number; status: string; kind: string; source_type: string | null; verified_at: Date | null; salon: string }[]>`
    select p.id, p.created_at, b.reference, p.booking_id, p.provider_ref, p.amount_halalas, p.refunded_halalas, p.status, p.kind, p.source_type, p.verified_at, s.name_ar as salon
    from payments p join bookings b on b.id = p.booking_id join salons s on s.id = b.salon_id
    ${sp.q ? sql`where b.reference ilike ${"%" + sp.q + "%"} or p.provider_ref = ${sp.q}` : sql``} order by p.created_at desc limit 200` : [];
  const refunds = tab === "refunds" ? await sql<{ id: string; created_at: Date; reference: string; amount_halalas: number; status: string; reason: string | null; provider_ref: string | null }[]>`
    select r.id, r.created_at, b.reference, r.amount_halalas, r.status, r.reason, r.provider_ref from refunds r join bookings b on b.id = r.booking_id order by r.created_at desc limit 200` : [];
  const hooks = tab === "webhooks" ? await sql<{ id: string; received_at: Date; event_type: string; event_id: string; processed_at: Date | null; error: string | null }[]>`
    select id, received_at, event_type, event_id, processed_at, error from payment_webhook_events order by received_at desc limit 200` : [];
  return (
    <div>
      <PageTitle title={ar ? "المدفوعات والمستردات" : "Payments & refunds"} />
      <Flash sp={sp} t={t} />
      <p className="mb-4 text-sm">{ar ? "بوابة الدفع" : "Gateway"}: <b>{paymentProvider().name}</b> — <Badge status={paymentProvider().mode() === "live" ? "approved" : paymentProvider().mode() === "test" ? "pending" : "failed"} label={paymentProvider().mode()} /></p>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={ar ? "إجمالي المحصل" : "Captured"} value={sar(sum.paid, locale)} />
        <Stat label={ar ? "المسترد" : "Refunded"} value={sar(sum.refunded, locale)} />
        <Stat label={ar ? "قيد الدفع" : "Open checkouts"} value={sum.initiated} />
        <Stat label={ar ? "فاشلة" : "Failed"} value={sum.failed} />
      </div>
      <Tabs active={tab} items={[{ key: "payments", label: ar ? "المعاملات" : "Transactions", href: "?tab=payments" }, { key: "refunds", label: ar ? "المستردات" : "Refunds", href: "?tab=refunds" }, { key: "webhooks", label: "Webhooks", href: "?tab=webhooks" }]} />
      {tab === "payments" && (
        <>
          <form className="mb-3 flex gap-2"><input type="hidden" name="tab" value="payments" /><input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Booking ref / gateway id" /><button className="btn-outline">{t.common.search}</button></form>
          <div className="card overflow-x-auto"><table className="table text-xs">
            <thead><tr><th>{ar ? "التاريخ" : "Date"}</th><th>{ar ? "الحجز" : "Booking"}</th><th>{ar ? "الصالون" : "Salon"}</th><th>Gateway ref</th><th>{ar ? "النوع" : "Kind"}</th><th>{ar ? "الوسيلة" : "Method"}</th><th>{t.common.amount}</th><th>{t.common.status}</th><th>{ar ? "تم التحقق" : "Verified"}</th><th>{ar ? "إجراءات" : "Actions"}</th></tr></thead>
            <tbody>{payments.map((p) => (
              <tr key={p.id}><td>{formatDateTime(p.created_at, locale)}</td><td className="font-mono">{p.reference}</td><td>{p.salon}</td><td className="font-mono">{p.provider_ref ?? "—"}</td><td>{p.kind}</td><td>{p.source_type ?? "—"}</td>
                <td className="tabular-nums">{sar(p.amount_halalas, locale)}{p.refunded_halalas ? <div className="text-red-700">-{sar(p.refunded_halalas, locale)}</div> : null}</td><td><Badge status={p.status} /></td><td>{p.verified_at ? formatDateTime(p.verified_at, locale) : "—"}</td>
                <td className="space-y-1">
                  {p.status === "initiated" && <form action={adminReconcile}><input type="hidden" name="payment_id" value={p.id} /><button className="btn-outline btn-sm">{ar ? "تحقق من البوابة" : "Verify with gateway"}</button></form>}
                  {["paid", "partially_refunded"].includes(p.status) && (
                    <form action={adminRefund} className="flex gap-1"><input type="hidden" name="booking_id" value={p.booking_id} />
                      <input name="amount" type="number" step="0.01" min="0.01" max={(p.amount_halalas - p.refunded_halalas) / 100} defaultValue={((p.amount_halalas - p.refunded_halalas) / 100).toFixed(2)} className="input w-24 py-1" />
                      <input name="reason" className="input w-28 py-1" placeholder={t.common.reason} required /><button className="btn-danger btn-sm">{ar ? "استرداد" : "Refund"}</button></form>
                  )}
                </td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
      {tab === "refunds" && (
        <div className="card overflow-x-auto"><table className="table text-xs">
          <thead><tr><th>{ar ? "التاريخ" : "Date"}</th><th>{ar ? "الحجز" : "Booking"}</th><th>{t.common.amount}</th><th>{t.common.status}</th><th>{t.common.reason}</th><th>Gateway ref</th></tr></thead>
          <tbody>{refunds.map((r) => <tr key={r.id}><td>{formatDateTime(r.created_at, locale)}</td><td className="font-mono">{r.reference}</td><td>{sar(r.amount_halalas, locale)}</td><td><Badge status={r.status} /></td><td>{r.reason}</td><td className="font-mono">{r.provider_ref}</td></tr>)}</tbody>
        </table></div>
      )}
      {tab === "webhooks" && (
        <div className="card overflow-x-auto"><table className="table text-xs">
          <thead><tr><th>{ar ? "الاستلام" : "Received"}</th><th>Event</th><th>ID</th><th>{ar ? "المعالجة" : "Processed"}</th><th>Error</th></tr></thead>
          <tbody>{hooks.map((h) => <tr key={h.id}><td>{formatDateTime(h.received_at, locale)}</td><td>{h.event_type}</td><td className="font-mono">{h.event_id}</td><td>{h.processed_at ? "✓" : "—"}</td><td className="text-red-700">{h.error}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
