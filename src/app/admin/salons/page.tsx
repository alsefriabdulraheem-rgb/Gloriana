import Link from "next/link";
import { getDict } from "@/lib/i18n";
import { cityName } from "@/lib/i18n/dict";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { resolveRule, type CommissionRule } from "@/lib/finance/commission";
import { Badge, Empty, Flash, PageTitle, Tabs } from "@/components/ui";
import { setFeatured, setSalonStatus } from "../actions";

export default async function AdminSalons({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const status = sp.status ?? "all";
  const q = sp.q?.trim() || null;
  const rows = await sql<{ id: string; slug: string; name_ar: string; name_en: string | null; audience: string; category: string; status: string; status_reason: string | null; is_featured: boolean; featured_rank: number | null;
    commercial_registration: string | null; vat_number: string | null; phone: string | null; email: string | null; created_at: Date; city: string | null; owner: string | null; owner_phone: string | null; services: number; employees: number; gmv: number; rating_avg: number; rating_count: number }[]>`
    select s.id, s.slug, s.name_ar, s.name_en, s.audience, s.category, s.status, s.status_reason, s.is_featured, s.featured_rank, s.commercial_registration, s.vat_number, s.phone, s.email::text, s.created_at,
      s.rating_avg::float as rating_avg, s.rating_count,
      (select city from salon_branches where salon_id = s.id order by created_at limit 1) as city,
      (select u.full_name from salon_members m join users u on u.id = m.user_id where m.salon_id = s.id and m.role = 'owner' limit 1) as owner,
      (select u.phone from salon_members m join users u on u.id = m.user_id where m.salon_id = s.id and m.role = 'owner' limit 1) as owner_phone,
      (select count(*)::int from services where salon_id = s.id and is_active) as services, (select count(*)::int from employees where salon_id = s.id and is_active) as employees,
      (select coalesce(sum(total_halalas),0)::int from bookings where salon_id = s.id and status = 'completed') as gmv
    from salons s where true ${status !== "all" ? sql`and s.status = ${status}` : sql``}
      ${q ? sql`and (s.name_ar ilike ${"%" + q + "%"} or s.name_en ilike ${"%" + q + "%"} or s.slug ilike ${"%" + q + "%"} or s.commercial_registration = ${q})` : sql``}
    order by (s.status = 'pending_review') desc, s.created_at desc limit 200`;
  const rules = await sql<CommissionRule[]>`select scope, salon_id, category, online_percent, cash_percent, effective_from from commission_rules`;
  const tabs = ["all", "pending_review", "approved", "draft", "suspended", "rejected", "deactivated"];
  return (
    <div>
      <PageTitle title={ar ? "إدارة الصالونات" : "Salons"} />
      <Flash sp={sp} t={t} />
      <Tabs active={status} items={tabs.map((s) => ({ key: s, label: s, href: `/admin/salons?status=${s}` }))} />
      <form className="mb-4 flex gap-2"><input type="hidden" name="status" value={status} /><input name="q" defaultValue={q ?? ""} className="input max-w-sm" placeholder={ar ? "اسم / سجل تجاري" : "Name / CR"} /><button className="btn-outline">{t.common.search}</button></form>
      {rows.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="space-y-2">
          {rows.map((s) => {
            const r = resolveRule(rules, s.id, s.category, new Date());
            const backUrl = `/admin/salons?status=${status}`;
            return (
              <details key={s.id} className="card" open={s.status === "pending_review" && rows.length < 5}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                  <span className="flex-1 font-medium">{s.name_ar} <span className="text-muted">{s.name_en}</span></span>
                  <span className="text-xs">{s.audience} · {s.category} · {s.city ? cityName(s.city, locale) : ""}</span>
                  {s.is_featured && <span className="badge bg-gold-500 text-white">★ featured</span>}
                  <Badge status={s.status} />
                </summary>
                <div className="grid gap-4 border-t border-line p-4 text-sm lg:grid-cols-3">
                  <dl className="space-y-1">
                    <div><dt className="inline text-muted">CR: </dt><dd className="inline font-mono">{s.commercial_registration ?? "—"}</dd></div>
                    <div><dt className="inline text-muted">VAT: </dt><dd className="inline font-mono">{s.vat_number ?? "—"}</dd></div>
                    <div><dt className="inline text-muted">{ar ? "المالك" : "Owner"}: </dt><dd className="inline">{s.owner} <span dir="ltr">{s.owner_phone}</span></dd></div>
                    <div><dt className="inline text-muted">{t.common.email}: </dt><dd className="inline">{s.email}</dd></div>
                    <div>{s.services} {ar ? "خدمة" : "services"} · {s.employees} {ar ? "موظف" : "staff"} · ★ {s.rating_avg.toFixed(1)} ({s.rating_count})</div>
                    <div>GMV: {sar(s.gmv, locale)} · {ar ? "العمولة" : "Commission"}: {r.online}% / {r.cash}% <span className="text-muted">({r.scope})</span></div>
                    <div className="text-muted">{formatDate(s.created_at, locale)}</div>
                    {s.status_reason && <div className="rounded bg-paper p-2">{s.status_reason}</div>}
                    <Link className="text-plum-700 hover:underline" href={`/salons/${s.slug}`}>/salons/{s.slug} ↗</Link>
                  </dl>
                  <form action={setSalonStatus} className="space-y-2">
                    <input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={backUrl} />
                    <textarea name="reason" rows={2} className="input" placeholder={t.common.reason} />
                    <div className="flex flex-wrap gap-2">
                      {s.status !== "approved" && <button name="status" value="approved" className="btn-primary btn-sm">{ar ? "اعتماد" : "Approve"}</button>}
                      {s.status === "pending_review" && <button name="status" value="rejected" className="btn-danger btn-sm">{ar ? "رفض" : "Reject"}</button>}
                      {s.status === "approved" && <button name="status" value="suspended" className="btn-danger btn-sm">{ar ? "تعليق" : "Suspend"}</button>}
                      {s.status !== "deactivated" && <button name="status" value="deactivated" className="btn-outline btn-sm">{ar ? "إلغاء التفعيل" : "Deactivate"}</button>}
                    </div>
                  </form>
                  <div className="space-y-3">
                    <form action={setFeatured} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={backUrl} />
                      <label className="flex items-center gap-1"><input type="checkbox" name="is_featured" defaultChecked={s.is_featured} className="accent-plum-700" />{ar ? "مميز" : "Featured"}</label>
                      <input name="rank" type="number" defaultValue={s.featured_rank ?? ""} className="input w-20 py-1" placeholder="rank" />
                      <button className="btn-outline btn-sm">{t.common.save}</button>
                    </form>
                    <Link href={`/admin/commissions?salon=${s.id}`} className="btn-outline btn-sm">{ar ? "تخصيص العمولة" : "Custom commission"}</Link>
                    <Link href={`/admin/bookings?salon=${s.id}`} className="btn-ghost btn-sm">{ar ? "الحجوزات" : "Bookings"}</Link>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
