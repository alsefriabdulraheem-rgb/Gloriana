import type { Metadata } from "next";
import Link from "next/link";
import { getDict, pick } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { Cover, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.home.offers, description: t.taglineSub, alternates: { canonical: "/offers" } };
}

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const { t, locale } = await getDict();
  const { audience } = await searchParams;
  const aud = audience === "women" || audience === "men" ? audience : null;
  const offers = await sql<{ id: string; code: string | null; title_ar: string; title_en: string | null; discount_type: string; discount_value: number; min_subtotal_halalas: number; ends_at: Date | null; slug: string | null; name_ar: string | null; name_en: string | null; cover_url: string | null; audience: string | null }[]>`
    select p.id, p.code::text, p.title_ar, p.title_en, p.discount_type, p.discount_value, p.min_subtotal_halalas, p.ends_at, s.slug, s.name_ar, s.name_en, s.cover_url, s.audience
    from promotions p left join salons s on s.id = p.salon_id
    where p.is_active and p.is_public and p.starts_at <= now() and (p.ends_at is null or p.ends_at > now()) and (p.salon_id is null or s.status = 'approved')
      ${aud ? sql`and (s.audience = ${aud} or p.salon_id is null)` : sql``}
    order by p.salon_id nulls first, p.created_at desc limit 60`;
  return (
    <div className="container-x py-10">
      <h1 className="h-section mb-2">{t.home.offers}</h1>
      <div className="mb-6 flex gap-2">
        {[null, "women", "men"].map((a) => <Link key={a ?? "all"} href={a ? `/offers?audience=${a}` : "/offers"} className={`chip ${aud === a ? "border-plum-700 bg-plum-700 text-white" : ""}`}>{a ? t.audience[a as "women"] : t.search.all}</Link>)}
      </div>
      {offers.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((o) => (
            <Link key={o.id} href={o.slug ? `/salons/${o.slug}` : "/search"} className="card overflow-hidden hover:shadow-lg">
              <div className="h-36"><Cover url={o.cover_url} alt="" /></div>
              <div className="space-y-1 p-4">
                <div className="text-2xl font-bold text-plum-700">{o.discount_type === "percent" ? `-${o.discount_value}%` : `-${sar(o.discount_value, locale)}`}</div>
                <div className="font-medium">{pick(o, "title", locale)}</div>
                <div className="text-sm text-muted">{o.name_ar ? pick(o, "name", locale) : "TREMLY"}</div>
                <div className="flex flex-wrap gap-2 pt-1 text-xs">
                  {o.code && <span className="badge bg-gold-300/40 font-mono text-ink">{o.code}</span>}
                  {o.min_subtotal_halalas > 0 && <span className="text-muted">≥ {sar(o.min_subtotal_halalas, locale)}</span>}
                  {o.ends_at && <span className="text-muted">→ {formatDate(o.ends_at, locale)}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
