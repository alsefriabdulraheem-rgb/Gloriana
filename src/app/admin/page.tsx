import Link from "next/link";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { integrationStatus } from "@/lib/env";
import { Badge, PageTitle, Stat } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const [k] = await sql<{ gmv30: number; revenue30: number; revenue_all: number; bookings_today: number; online30: number; cash30: number; customers: number; salons: number; pending: number; receivable: number; payable: number; refunds30: number; cancel_rate: number }[]>`
    select
      (select coalesce(sum(total_halalas),0)::bigint::int from bookings where status = 'completed' and completed_at > now() - interval '30 days') as gmv30,
      (select coalesce(sum(amount_halalas),0)::bigint::int from ledger_entries where account = 'platform_revenue' and created_at > now() - interval '30 days') as revenue30,
      (select coalesce(sum(amount_halalas),0)::bigint::int from ledger_entries where account = 'platform_revenue') as revenue_all,
      (select count(*)::int from bookings where created_at::date = (now() at time zone 'Asia/Riyadh')::date and status <> 'expired') as bookings_today,
      (select count(*)::int from bookings where created_at > now() - interval '30 days' and payment_method in ('online','deposit') and status not in ('expired')) as online30,
      (select count(*)::int from bookings where created_at > now() - interval '30 days' and payment_method = 'cash' and status not in ('expired')) as cash30,
      (select count(*)::int from users where role = 'customer' and status = 'active') as customers,
      (select count(*)::int from salons where status = 'approved') as salons,
      (select count(*)::int from salons where status = 'pending_review') as pending,
      (select coalesce(sum(amount_halalas),0)::bigint::int from ledger_entries where account = 'commission_receivable') as receivable,
      (select coalesce(sum(amount_halalas),0)::bigint::int from ledger_entries where account = 'salon_payable') as payable,
      (select coalesce(sum(amount_halalas),0)::bigint::int from refunds where status = 'succeeded' and created_at > now() - interval '30 days') as refunds30,
      (select coalesce(round(100.0 * count(*) filter (where status = 'cancelled') / nullif(count(*),0)),0)::int from bookings where created_at > now() - interval '30 days' and status <> 'expired') as cancel_rate`;
  const recent = await sql<{ reference: string; created_at: Date; starts_at: Date; status: string; payment_status: string; payment_method: string; total_halalas: number; salon: string }[]>`
    select b.reference, b.created_at, b.starts_at, b.status, b.payment_status, b.payment_method, b.total_halalas, s.name_ar as salon from bookings b join salons s on s.id = b.salon_id order by b.created_at desc limit 15`;
  const topSalons = await sql<{ name_ar: string; slug: string; n: number; gmv: number }[]>`
    select s.name_ar, s.slug, count(*)::int as n, sum(b.total_halalas)::int as gmv from bookings b join salons s on s.id = b.salon_id
    where b.status = 'completed' and b.completed_at > now() - interval '30 days' group by s.id order by gmv desc limit 8`;
  const integ = integrationStatus();
  const Row = ({ ok, name, need }: { ok: boolean; name: string; need: string }) => (
    <li className="flex items-start gap-2"><span>{ok ? "🟢" : "🔴"}</span><div><b>{name}</b>{!ok && <div className="text-xs text-muted">{need}</div>}</div></li>
  );
  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "لوحة مؤشرات المنصة" : "Platform overview"}><LiveRefresh label={ar ? "مباشر" : "Live"} /></PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={ar ? "قيمة الحجوزات المكتملة (30 يوماً)" : "Completed GMV (30d)"} value={sar(k.gmv30, locale)} />
        <Stat label={ar ? "إيراد المنصة (30 يوماً)" : "Platform revenue (30d)"} value={sar(k.revenue30, locale)} hint={`${ar ? "الإجمالي" : "All-time"}: ${sar(k.revenue_all, locale)}`} />
        <Stat label={ar ? "حجوزات اليوم" : "Bookings today"} value={k.bookings_today} hint={`${ar ? "أونلاين/نقدي 30ي" : "Online/cash 30d"}: ${k.online30} / ${k.cash30}`} />
        <Stat label={ar ? "نسبة الإلغاء" : "Cancellation rate"} value={`${k.cancel_rate}%`} hint={`${ar ? "مستردات 30ي" : "Refunds 30d"}: ${sar(k.refunds30, locale)}`} />
        <Stat label={ar ? "صالونات نشطة" : "Active salons"} value={k.salons} hint={<Link className="text-plum-700" href="/admin/salons?status=pending_review">{k.pending} {ar ? "بانتظار المراجعة" : "pending review"}</Link>} />
        <Stat label={ar ? "العملاء" : "Customers"} value={k.customers} />
        <Stat label={ar ? "مستحق للصالونات" : "Payable to salons"} value={sar(k.payable, locale)} />
        <Stat label={ar ? "عمولات نقدية غير محصلة" : "Outstanding cash commission"} value={sar(k.receivable, locale)} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="card overflow-x-auto">
          <h2 className="p-4 pb-0 font-semibold">{ar ? "أحدث الحجوزات" : "Latest bookings"}</h2>
          <table className="table"><thead><tr><th>Ref</th><th>{ar ? "الصالون" : "Salon"}</th><th>{ar ? "الموعد" : "When"}</th><th>{ar ? "الدفع" : "Payment"}</th><th>{t.common.status}</th><th>{t.common.total}</th></tr></thead>
            <tbody>{recent.map((b) => (
              <tr key={b.reference}><td className="font-mono text-xs"><Link href={`/admin/bookings?q=${b.reference}`}>{b.reference}</Link></td><td>{b.salon}</td><td className="text-xs">{formatDateTime(b.starts_at, locale)}</td>
                <td><Badge status={b.payment_status} label={`${b.payment_method} · ${t.pay[b.payment_status as keyof typeof t.pay]}`} /></td><td><Badge status={b.status} label={t.status[b.status as keyof typeof t.status]} /></td><td className="tabular-nums">{sar(b.total_halalas, locale)}</td></tr>
            ))}</tbody></table>
        </section>
        <div className="space-y-6">
          <section className="card p-4">
            <h2 className="mb-3 font-semibold">{ar ? "حالة التكاملات" : "Integration status"}</h2>
            <ul className="space-y-2 text-sm">
              <Row ok={integ.payments} name={`Moyasar (${integ.paymentsMode})`} need="MOYASAR_SECRET_KEY, MOYASAR_PUBLISHABLE_KEY, MOYASAR_WEBHOOK_SECRET + merchant approval" />
              <Row ok={integ.sms} name={`SMS / OTP (${integ.smsProvider})`} need="SMS_PROVIDER=unifonic|taqnyat + credentials + registered sender ID" />
              <Row ok={integ.email} name="Email (Resend)" need="RESEND_API_KEY, EMAIL_FROM (verified domain)" />
              <Row ok={integ.whatsapp} name="WhatsApp Business" need="WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID + approved templates" />
              <Row ok={integ.storage === "supabase"} name={`Storage (${integ.storage})`} need="SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (local disk is dev-only)" />
            </ul>
          </section>
          <section className="card p-4">
            <h2 className="mb-3 font-semibold">{ar ? "الأعلى أداءً (30 يوماً)" : "Top salons (30d)"}</h2>
            <ol className="space-y-1 text-sm">{topSalons.map((s, i) => <li key={s.slug} className="flex justify-between"><span>{i + 1}. {s.name_ar} <span className="text-muted">({s.n})</span></span><span className="tabular-nums">{sar(s.gmv, locale)}</span></li>)}</ol>
          </section>
        </div>
      </div>
    </div>
  );
}
