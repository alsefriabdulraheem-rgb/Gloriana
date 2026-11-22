import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/time";
import { salonBalances } from "@/lib/finance/ledger";
import { commissionFor } from "@/lib/finance/commission";
import { Badge, Empty, PageTitle, Stat, Tabs } from "@/components/ui";

export default async function Finance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/finance", "finance.view");
  const { locale } = await getDict();
  const ar = locale === "ar";
  const period = sp.period === "day" || sp.period === "week" ? sp.period : "month";
  const bal = await salonBalances(ctx.salonId);
  const rates = await commissionFor(ctx.salonId, new Date());
  const series = await sql<{ bucket: Date; bookings: number; revenue: number; online: number; cash: number }[]>`
    select date_trunc(${period}, completed_at at time zone 'Asia/Riyadh') as bucket, count(*)::int as bookings, sum(total_halalas)::int as revenue,
      sum(amount_paid_halalas - amount_refunded_halalas)::int as online, sum(cash_collected_halalas)::int as cash
    from bookings where salon_id = ${ctx.salonId} and status = 'completed' and completed_at > now() - interval '1 year'
    group by 1 order by 1 desc limit 31`;
  const ledger = await sql<{ id: string; created_at: Date; entry_type: string; account: string; amount_halalas: number; commission_percent: string | null; reference: string | null; memo: string | null; settlement_id: string | null }[]>`
    select l.id, l.created_at, l.entry_type, l.account, l.amount_halalas, l.commission_percent::text, b.reference, l.memo, l.settlement_id
    from ledger_entries l left join bookings b on b.id = l.booking_id where l.salon_id = ${ctx.salonId} order by l.id desc limit 200`;
  const settlements = await sql<{ id: string; reference: string; period_start: Date; period_end: Date; online_gross_halalas: number; online_commission_halalas: number; cash_gross_halalas: number; cash_commission_halalas: number; refunds_halalas: number; net_payable_halalas: number; status: string; paid_at: Date | null; payment_reference: string | null }[]>`
    select * from settlements where salon_id = ${ctx.salonId} order by created_at desc`;
  const max = Math.max(1, ...series.map((s) => s.revenue));
  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "المالية والتسويات" : "Finance & settlements"} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={ar ? "مستحق لك من تريملي (أونلاين)" : "Owed to you by TREMLY (online)"} value={sar(bal.payable, locale)} />
        <Stat label={ar ? "عمولات مستحقة عليك (نقدي)" : "Commission you owe (cash)"} value={sar(bal.receivable, locale)} />
        <Stat label={ar ? "صافي التسوية القادمة" : "Net next settlement"} value={sar(bal.net, locale)} hint={bal.net >= 0 ? (ar ? "تريملي تدفع لك" : "TREMLY pays you") : (ar ? "تدفع لتريملي" : "You pay TREMLY")} />
        <Stat label={ar ? "نسبة العمولة الحالية" : "Current commission"} value={`${rates.online}% / ${rates.cash}%`} hint={ar ? "أونلاين / نقدي" : "online / cash"} />
      </div>

      <section className="card p-4">
        <Tabs active={period} items={[{ key: "day", label: ar ? "يومي" : "Daily", href: "?period=day" }, { key: "week", label: ar ? "أسبوعي" : "Weekly", href: "?period=week" }, { key: "month", label: ar ? "شهري" : "Monthly", href: "?period=month" }]} />
        {series.length === 0 ? <Empty>—</Empty> : (
          <table className="table">
            <thead><tr><th>{ar ? "الفترة" : "Period"}</th><th>{ar ? "الحجوزات" : "Bookings"}</th><th>{ar ? "الإيراد" : "Revenue"}</th><th>{ar ? "أونلاين" : "Online"}</th><th>{ar ? "نقدي" : "Cash"}</th><th className="w-1/3" /></tr></thead>
            <tbody>{series.map((s) => (
              <tr key={String(s.bucket)}><td>{formatDate(s.bucket, locale)}</td><td>{s.bookings}</td><td className="font-semibold">{sar(s.revenue, locale)}</td><td>{sar(s.online, locale)}</td><td>{sar(s.cash, locale)}</td>
                <td><div className="h-2 rounded bg-plum-50"><div className="h-2 rounded bg-plum-500" style={{ width: `${(100 * s.revenue) / max}%` }} /></div></td></tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{ar ? "كشوفات التسوية" : "Settlement statements"}</h2>
        {settlements.length === 0 ? <Empty>{ar ? "لا توجد تسويات بعد. تصدرها إدارة تريملي دورياً." : "No settlements yet. TREMLY issues them periodically."}</Empty> : (
          <div className="card overflow-x-auto"><table className="table">
            <thead><tr><th>Ref</th><th>{ar ? "الفترة" : "Period"}</th><th>{ar ? "أونلاين" : "Online"}</th><th>{ar ? "عمولة أونلاين" : "Online comm."}</th><th>{ar ? "نقدي" : "Cash"}</th><th>{ar ? "عمولة نقدي" : "Cash comm."}</th><th>{ar ? "مستردات" : "Refunds"}</th><th>{ar ? "الصافي" : "Net"}</th><th>{ar ? "الحالة" : "Status"}</th></tr></thead>
            <tbody>{settlements.map((s) => (
              <tr key={s.id}><td className="font-mono text-xs">{s.reference}</td><td className="text-xs">{formatDate(s.period_start, locale)} → {formatDate(s.period_end, locale)}</td>
                <td>{sar(s.online_gross_halalas, locale)}</td><td>-{sar(s.online_commission_halalas, locale)}</td><td>{sar(s.cash_gross_halalas, locale)}</td><td>{sar(s.cash_commission_halalas, locale)}</td><td>{sar(s.refunds_halalas, locale)}</td>
                <td className="font-semibold">{sar(s.net_payable_halalas, locale)}</td><td><Badge status={s.status} />{s.payment_reference && <div className="text-[10px] text-muted">{s.payment_reference}</div>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{ar ? "دفتر الحركات المالية" : "Ledger"}</h2>
        {ledger.length === 0 ? <Empty>—</Empty> : (
          <div className="card overflow-x-auto"><table className="table text-xs">
            <thead><tr><th>#</th><th>{ar ? "التاريخ" : "Date"}</th><th>{ar ? "النوع" : "Type"}</th><th>{ar ? "الحساب" : "Account"}</th><th>{ar ? "المبلغ" : "Amount"}</th><th>%</th><th>{ar ? "الحجز" : "Booking"}</th><th /></tr></thead>
            <tbody>{ledger.map((l) => (
              <tr key={l.id}><td>{String(l.id)}</td><td>{formatDateTime(l.created_at, locale)}</td><td>{l.entry_type}</td><td>{l.account}</td><td className={`tabular-nums ${l.amount_halalas < 0 ? "text-red-700" : ""}`}>{sar(l.amount_halalas, locale)}</td><td>{l.commission_percent ?? ""}</td><td className="font-mono">{l.reference ?? ""}</td><td>{l.settlement_id ? "✓" : ""}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
