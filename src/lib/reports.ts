import { sql } from "./db";
import { localToUtc, addDays } from "./time";

export const REPORT_TYPES = ["bookings", "payments", "refunds", "ledger", "settlements", "salons", "revenue_by_salon"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const H = (n: number | null | undefined) => (n == null ? null : Number(n) / 100);

/** Returns column headers and rows (amounts in SAR) for a report over [from, to] (Riyadh dates). */
export async function reportData(type: ReportType, from: string, to: string): Promise<{ columns: string[]; rows: (string | number | null)[][] }> {
  const a = localToUtc(from, "00:00"), b = localToUtc(addDays(to, 1), "00:00");
  switch (type) {
    case "bookings": {
      const r = await sql`select b.reference, b.created_at, b.starts_at, s.name_ar as salon, s.audience, e.display_name_ar as employee, b.status, b.payment_method, b.payment_status,
        b.subtotal_halalas, b.discount_halalas, b.total_halalas, b.amount_paid_halalas, b.amount_refunded_halalas, b.cash_collected_halalas
        from bookings b join salons s on s.id = b.salon_id join employees e on e.id = b.employee_id where b.created_at >= ${a} and b.created_at < ${b} order by b.created_at`;
      return { columns: ["Reference", "Created", "Appointment", "Salon", "Audience", "Employee", "Status", "Method", "Payment status", "Subtotal SAR", "Discount SAR", "Total SAR", "Paid online SAR", "Refunded SAR", "Cash collected SAR"],
        rows: r.map((x) => [x.reference, x.created_at.toISOString(), x.starts_at.toISOString(), x.salon, x.audience, x.employee, x.status, x.payment_method, x.payment_status, H(x.subtotal_halalas), H(x.discount_halalas), H(x.total_halalas), H(x.amount_paid_halalas), H(x.amount_refunded_halalas), H(x.cash_collected_halalas)]) };
    }
    case "payments": {
      const r = await sql`select p.created_at, b.reference, s.name_ar as salon, p.provider, p.provider_ref, p.kind, p.source_type, p.status, p.amount_halalas, p.refunded_halalas, p.verified_at
        from payments p join bookings b on b.id = p.booking_id join salons s on s.id = b.salon_id where p.created_at >= ${a} and p.created_at < ${b} order by p.created_at`;
      return { columns: ["Created", "Booking", "Salon", "Gateway", "Gateway ref", "Kind", "Method", "Status", "Amount SAR", "Refunded SAR", "Verified at"],
        rows: r.map((x) => [x.created_at.toISOString(), x.reference, x.salon, x.provider, x.provider_ref, x.kind, x.source_type, x.status, H(x.amount_halalas), H(x.refunded_halalas), x.verified_at?.toISOString() ?? null]) };
    }
    case "refunds": {
      const r = await sql`select r.created_at, b.reference, s.name_ar as salon, r.amount_halalas, r.status, r.reason, r.provider_ref from refunds r join bookings b on b.id = r.booking_id join salons s on s.id = b.salon_id
        where r.created_at >= ${a} and r.created_at < ${b} order by r.created_at`;
      return { columns: ["Created", "Booking", "Salon", "Amount SAR", "Status", "Reason", "Gateway ref"], rows: r.map((x) => [x.created_at.toISOString(), x.reference, x.salon, H(x.amount_halalas), x.status, x.reason, x.provider_ref]) };
    }
    case "ledger": {
      const r = await sql`select l.id, l.created_at, s.name_ar as salon, b.reference, l.entry_type, l.account, l.amount_halalas, l.commission_percent, st.reference as settlement, l.memo
        from ledger_entries l join salons s on s.id = l.salon_id left join bookings b on b.id = l.booking_id left join settlements st on st.id = l.settlement_id
        where l.created_at >= ${a} and l.created_at < ${b} order by l.id`;
      return { columns: ["#", "Created", "Salon", "Booking", "Entry type", "Account", "Amount SAR", "Commission %", "Settlement", "Memo"],
        rows: r.map((x) => [String(x.id), x.created_at.toISOString(), x.salon, x.reference, x.entry_type, x.account, H(x.amount_halalas), x.commission_percent == null ? null : Number(x.commission_percent), x.settlement, x.memo]) };
    }
    case "settlements": {
      const r = await sql`select st.*, s.name_ar as salon from settlements st join salons s on s.id = st.salon_id where st.created_at >= ${a} and st.created_at < ${b} order by st.created_at`;
      return { columns: ["Reference", "Salon", "Period start", "Period end", "Online gross SAR", "Online commission SAR", "Cash gross SAR", "Cash commission SAR", "Refunds SAR", "Net payable SAR", "Status", "Paid at", "Transfer ref"],
        rows: r.map((x) => [x.reference, x.salon, String(x.period_start).slice(0, 10), String(x.period_end).slice(0, 10), H(x.online_gross_halalas), H(x.online_commission_halalas), H(x.cash_gross_halalas), H(x.cash_commission_halalas), H(x.refunds_halalas), H(x.net_payable_halalas), x.status, x.paid_at?.toISOString() ?? null, x.payment_reference]) };
    }
    case "salons": {
      const r = await sql`select s.slug, s.name_ar, s.name_en, s.audience, s.category, s.status, s.commercial_registration, s.vat_number, s.rating_avg, s.rating_count, s.created_at,
        (select city from salon_branches where salon_id = s.id limit 1) as city from salons s order by s.created_at`;
      return { columns: ["Slug", "Name AR", "Name EN", "Audience", "Category", "Status", "CR", "VAT", "Rating", "Reviews", "City", "Created"],
        rows: r.map((x) => [x.slug, x.name_ar, x.name_en, x.audience, x.category, x.status, x.commercial_registration, x.vat_number, Number(x.rating_avg), x.rating_count, x.city, x.created_at.toISOString()]) };
    }
    case "revenue_by_salon": {
      const r = await sql`select s.name_ar as salon, count(b.id)::int as bookings, coalesce(sum(b.total_halalas),0)::int as gmv,
        coalesce((select sum(amount_halalas) from ledger_entries l where l.salon_id = s.id and l.account = 'platform_revenue' and l.created_at >= ${a} and l.created_at < ${b}),0)::int as revenue,
        count(b.id) filter (where b.payment_method = 'cash')::int as cash_bookings, count(b.id) filter (where b.payment_method <> 'cash')::int as online_bookings
        from salons s left join bookings b on b.salon_id = s.id and b.status = 'completed' and b.completed_at >= ${a} and b.completed_at < ${b}
        group by s.id having count(b.id) > 0 order by gmv desc`;
      return { columns: ["Salon", "Completed bookings", "GMV SAR", "Platform revenue SAR", "Cash bookings", "Online bookings"],
        rows: r.map((x) => [x.salon, x.bookings, H(x.gmv), H(x.revenue), x.cash_bookings, x.online_bookings]) };
    }
  }
}
