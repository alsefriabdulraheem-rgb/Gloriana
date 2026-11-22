import Link from "next/link";
import type { SalonCardRow } from "@/lib/catalog";
import { cityName, type Dict } from "@/lib/i18n/dict";
import { pick, type Locale } from "@/lib/i18n";
import { sar } from "@/lib/money";
import { Cover, Stars } from "./ui";

export function SalonCard({ s, t, locale }: { s: SalonCardRow; t: Dict; locale: Locale }) {
  const name = pick(s, "name", locale);
  return (
    <Link href={`/salons/${s.slug}`} className="group card overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Cover url={s.cover_url} alt={name} className="transition duration-500 group-hover:scale-105" />
        <span className={`badge absolute start-3 top-3 ${s.audience === "women" ? "bg-plum-700 text-white" : "bg-slate-men text-white"}`}>{s.audience === "women" ? t.audience.womenShort : t.audience.menShort}</span>
        {s.offer_percent ? <span className="badge absolute end-3 top-3 bg-gold-500 text-white">-{s.offer_percent}%</span> : null}
      </div>
      <div className="space-y-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-semibold">{name}</h3>
          <Stars value={s.rating_avg} count={s.rating_count} />
        </div>
        <p className="line-clamp-1 text-xs text-muted">
          {(t.category as Record<string, string>)[s.category]} · {s.city ? cityName(s.city, locale) : ""}{s.neighborhood ? ` · ${s.neighborhood}` : ""}
        </p>
        {s.min_price != null && <p className="text-sm"><span className="text-muted">{t.search.from} </span><span className="font-semibold">{sar(s.min_price, locale)}</span></p>}
      </div>
    </Link>
  );
}
