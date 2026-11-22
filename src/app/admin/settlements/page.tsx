import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { addDays, formatDate, todayLocal } from "@/lib/time";
import { Badge, Flash, PageTitle } from "@/components/ui";
import { generateAllSettlements, generateSettlement, issueSettlement, paySettlement } from "../actions";

export default async function Settlements({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const outstanding = await sql<{ salon_id: string; name_ar: string; payable: number; receivable: number; entries: number }[]>`
    select l.salon_id, s.name_ar, coalesce(sum(l.amount_halalas) filter (where l.account = 'salon_payable'),0)::int as payable,
      coalesce(sum(l.amount_halalas) filter (where l.account = 'commission_receivable'),0)::int as receivable, count(*)::int as entries
    from ledger_entries l join salons s on s.id = l.salon_id where l.settlement_id is null group by l.salon_id, s.name_ar order by s.name_ar`;
  const rows = await sql<{ id: string; reference: string; name_ar: string; period_start: Date; period_end: Date; online_gross_halalas: number; online_commission_halalas: number; cash_gross_halalas: number; cash_commission_halalas: number; refunds_halalas: number; net_payable_halalas: number; status: string; paid_at: Date | null; payment_reference: string | null }[]>`
    select st.*, s.name_ar from settlements st join salons s on s.id = st.salon_id order by st.created_at desc limit 200`;
  const start = addDays(todayLocal(), -30), end = addDays(todayLocal(), -1);
  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "تسويات الصالونات" : "Salon settlements"} />
      <Flash sp={sp} t={t} />
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">{ar ? "أرصدة غير مسواة" : "Unsettled balances"}</h2>
        <form action={generateAllSettlements} className="mb-3 flex flex-wrap items-end gap-2">
          <div><label className="label">{t.common.from}</label><input type="date" name="period_start" defaultValue={start} className="input" /></div>
          <div><label className="label">{t.common.to}</label><input type="date" name="period_end" defaultValue={end} className="input" /></div>
          <button className="btn-primary">{ar ? "إنشاء كشوفات لكل الصالونات" : "Generate for all salons"}</button>
        </form>
        <table className="table">
          <thead><tr><th>{ar ? "الصالون" : "Salon"}</th><th>{ar ? "مستحق للصالون" : "Payable to salon"}</th><th>{ar ? "عمولة نقدية مستحقة" : "Cash commission due"}</th><th>{ar ? "الصافي" : "Net"}</th><th /></tr></thead>
          <tbody>{outstanding.map((o) => (
            <tr key={o.salon_id}><td>{o.name_ar} <span className="text-xs text-muted">({o.entries})</span></td><td>{sar(o.payable, locale)}</td><td>{sar(o.receivable, locale)}</td><td className="font-semibold">{sar(o.payable - o.receivable, locale)}</td>
              <td><form action={generateSettlement} className="flex gap-1"><input type="hidden" name="salon_id" value={o.salon_id} /><input type="hidden" name="period_start" value={start} /><input type="date" name="period_end" defaultValue={end} className="input w-36 py-1" /><button className="btn-outline btn-sm">{ar ? "إنشاء كشف" : "Create"}</button></form></td></tr>
          ))}</tbody>
        </table>
      </section>
      <div className="card overflow-x-auto"><table className="table text-xs">
        <thead><tr><th>Ref</th><th>{ar ? "الصالون" : "Salon"}</th><th>{ar ? "الفترة" : "Period"}</th><th>{ar ? "أونلاين" : "Online"}</th><th>-{ar ? "عمولة" : "comm."}</th><th>{ar ? "نقدي" : "Cash"}</th><th>{ar ? "عمولة نقدي" : "Cash comm."}</th><th>{ar ? "مستردات" : "Refunds"}</th><th>{ar ? "الصافي" : "Net"}</th><th>{t.common.status}</th><th /></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.id}><td className="font-mono">{s.reference}</td><td>{s.name_ar}</td><td>{formatDate(s.period_start, locale)} → {formatDate(s.period_end, locale)}</td><td>{sar(s.online_gross_halalas, locale)}</td><td>{sar(s.online_commission_halalas, locale)}</td><td>{sar(s.cash_gross_halalas, locale)}</td><td>{sar(s.cash_commission_halalas, locale)}</td><td>{sar(s.refunds_halalas, locale)}</td>
            <td className={`font-semibold ${s.net_payable_halalas < 0 ? "text-red-700" : ""}`}>{sar(s.net_payable_halalas, locale)}<div className="font-normal text-muted">{s.net_payable_halalas >= 0 ? (ar ? "ندفع للصالون" : "we pay salon") : (ar ? "يدفع الصالون" : "salon pays us")}</div></td>
            <td><Badge status={s.status} />{s.payment_reference && <div className="text-muted">{s.payment_reference}</div>}</td>
            <td className="space-y-1">
              {s.status === "draft" && <form action={issueSettlement}><input type="hidden" name="id" value={s.id} /><button className="btn-outline btn-sm">{ar ? "إصدار" : "Issue"}</button></form>}
              {s.status !== "paid" && s.status !== "void" && <form action={paySettlement} className="flex gap-1"><input type="hidden" name="id" value={s.id} /><input name="payment_reference" className="input w-28 py-1" placeholder={ar ? "مرجع التحويل" : "Transfer ref"} required /><button className="btn-primary btn-sm">✓</button></form>}
              <a className="btn-ghost btn-sm" href={`/admin/reports/print?type=settlement&id=${s.id}`} target="_blank">PDF</a>
            </td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
