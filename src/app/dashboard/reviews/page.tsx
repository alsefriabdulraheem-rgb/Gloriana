import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/time";
import { Badge, Empty, Flash, PageTitle } from "@/components/ui";
import { replyReview } from "../actions";

export default async function Reviews({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/reviews", "reviews.reply");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const rows = await sql<{ id: string; rating: number; comment: string | null; salon_reply: string | null; status: string; created_at: Date; customer: string | null; employee: string | null; reference: string }[]>`
    select r.id, r.rating, r.comment, r.salon_reply, r.status, r.created_at, split_part(coalesce(u.full_name,''),' ',1) as customer, e.display_name_ar as employee, b.reference
    from reviews r join users u on u.id = r.customer_id join bookings b on b.id = r.booking_id left join employees e on e.id = r.employee_id
    where r.salon_id = ${ctx.salonId} order by r.created_at desc limit 200`;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: rows.filter((r) => r.rating === n).length }));
  return (
    <div>
      <PageTitle title={ar ? "تقييمات العملاء" : "Customer reviews"} />
      <Flash sp={sp} t={t} />
      <div className="card mb-6 grid gap-1 p-4 text-sm sm:max-w-sm">
        {dist.map((d) => <div key={d.n} className="flex items-center gap-2"><span className="w-6">{d.n}★</span><div className="h-2 flex-1 rounded bg-plum-50"><div className="h-2 rounded bg-gold-500" style={{ width: `${rows.length ? (100 * d.c) / rows.length : 0}%` }} /></div><span className="w-8 text-end">{d.c}</span></div>)}
      </div>
      {rows.length === 0 ? <Empty>{t.salon.noReviews}</Empty> : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-gold-500">{"★".repeat(r.rating)}</span><b>{r.customer}</b><span className="text-muted">· {r.employee} · {r.reference} · {formatDate(r.created_at, locale)}</span>{r.status !== "published" && <Badge status={r.status} />}</div>
              {r.comment && <p className="mt-2 text-sm">{r.comment}</p>}
              <form action={replyReview} className="mt-3 flex gap-2"><input type="hidden" name="id" value={r.id} /><input name="reply" defaultValue={r.salon_reply ?? ""} className="input" placeholder={t.salon.reply} maxLength={1000} /><button className="btn-outline btn-sm">{t.common.save}</button></form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
