import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/time";
import { Badge, Empty, Flash, PageTitle, Tabs } from "@/components/ui";
import { moderateReview } from "../actions";

export default async function AdminReviews({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const tab = sp.tab === "all" ? "all" : "reported";
  const rows = await sql<{ id: string; rating: number; comment: string | null; status: string; created_at: Date; salon: string; customer: string | null; reports: number; reasons: string | null }[]>`
    select r.id, r.rating, r.comment, r.status, r.created_at, s.name_ar as salon, u.full_name as customer,
      (select count(*)::int from review_reports where review_id = r.id and resolved_at is null) as reports,
      (select string_agg(reason, ' | ') from review_reports where review_id = r.id and resolved_at is null) as reasons
    from reviews r join salons s on s.id = r.salon_id join users u on u.id = r.customer_id
    ${tab === "reported" ? sql`where r.status = 'reported' or exists (select 1 from review_reports where review_id = r.id and resolved_at is null)` : sql``}
    order by r.created_at desc limit 200`;
  return (
    <div>
      <PageTitle title={ar ? "مراجعة التقييمات والمحتوى المبلغ عنه" : "Reviews & reported content"} />
      <Flash sp={sp} t={t} />
      <Tabs active={tab} items={[{ key: "reported", label: ar ? "المبلغ عنها" : "Reported", href: "?tab=reported" }, { key: "all", label: t.common.all, href: "?tab=all" }]} />
      {rows.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="space-y-2">{rows.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-start gap-3 p-4 text-sm">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-gold-500">{"★".repeat(r.rating)}</span><b>{r.salon}</b><span className="text-muted">{r.customer} · {formatDate(r.created_at, locale)}</span><Badge status={r.status} />{r.reports > 0 && <span className="badge bg-red-50 text-red-700">⚑ {r.reports}</span>}</div>
              <p className="mt-1">{r.comment}</p>
              {r.reasons && <p className="mt-1 text-xs text-red-700">{r.reasons}</p>}
            </div>
            <form action={moderateReview} className="flex gap-1"><input type="hidden" name="id" value={r.id} />
              <button name="status" value="published" className="btn-outline btn-sm">{ar ? "نشر" : "Publish"}</button>
              <button name="status" value="hidden" className="btn-danger btn-sm">{ar ? "إخفاء" : "Hide"}</button></form>
          </div>
        ))}</div>
      )}
    </div>
  );
}
