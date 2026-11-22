import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { reportData, REPORT_TYPES, type ReportType } from "@/lib/reports";
import { addDays, formatDate, todayLocal } from "@/lib/time";
import { sar } from "@/lib/money";
import { getDict } from "@/lib/i18n";
import { PrintButton } from "@/components/print-button";

/** Print-optimised report (browser "Save as PDF" keeps Arabic shaping and RTL correct). */
export default async function PrintReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { locale } = await getDict();
  if (sp.type === "settlement") {
    const [s] = await sql<{ reference: string; name_ar: string; name_en: string | null; vat_number: string | null; commercial_registration: string | null; period_start: Date; period_end: Date; online_gross_halalas: number; online_commission_halalas: number; cash_gross_halalas: number; cash_commission_halalas: number; refunds_halalas: number; net_payable_halalas: number; status: string; payment_reference: string | null; created_at: Date }[]>`
      select st.*, s.name_ar, s.name_en, s.vat_number, s.commercial_registration from settlements st join salons s on s.id = st.salon_id where st.id = ${sp.id ?? ""}`;
    if (!s) notFound();
    const lines: [string, number][] = [
      ["Online payments collected by TREMLY / مدفوعات إلكترونية", s.online_gross_halalas], ["Refunds / مستردات", -s.refunds_halalas],
      ["Commission on online / عمولة إلكترونية", -s.online_commission_halalas], ["Cash collected by salon (info) / نقدي محصل لدى الصالون", s.cash_gross_halalas],
      ["Commission on cash (owed by salon) / عمولة نقدية مستحقة", -s.cash_commission_halalas], ["Net payable to salon / صافي المستحق", s.net_payable_halalas],
    ];
    return (
      <div className="mx-auto max-w-3xl bg-white p-10 text-sm">
        <PrintButton />
        <h1 className="font-display text-2xl font-semibold tracking-widest">TREMLY</h1>
        <h2 className="mt-1 text-lg">Settlement statement / كشف تسوية — {s.reference}</h2>
        <p className="mt-4">{s.name_ar} {s.name_en ? `/ ${s.name_en}` : ""} · CR {s.commercial_registration ?? "—"} · VAT {s.vat_number ?? "—"}</p>
        <p>{formatDate(s.period_start, locale)} → {formatDate(s.period_end, locale)} · {s.status}{s.payment_reference ? ` · ${s.payment_reference}` : ""}</p>
        <table className="table mt-6"><tbody>{lines.map(([l, v], i) => <tr key={i} className={i === lines.length - 1 ? "font-bold" : ""}><td>{l}</td><td className="text-end tabular-nums">{sar(v, locale)}</td></tr>)}</tbody></table>
        <p className="mt-6 text-xs text-gray-500">Note: cash-booking commission is owed by the salon and is netted against online balances. A positive net means TREMLY pays the salon; a negative net means the salon pays TREMLY.</p>
      </div>
    );
  }
  const type = sp.type as ReportType;
  if (!REPORT_TYPES.includes(type)) notFound();
  const from = sp.from ?? addDays(todayLocal(), -30), to = sp.to ?? todayLocal();
  const { columns, rows } = await reportData(type, from, to);
  return (
    <div className="bg-white p-6 text-[10px]">
      <PrintButton />
      <h1 className="font-display text-xl font-semibold tracking-widest">TREMLY — {type}</h1>
      <p className="mb-4">{from} → {to} · {rows.length} rows</p>
      <table className="table"><thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v ?? ""}</td>)}</tr>)}</tbody></table>
    </div>
  );
}
