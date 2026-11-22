import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/i18n";
import { CITIES, cityName } from "@/lib/i18n/dict";
import { searchSalons, type SearchFilters } from "@/lib/catalog";
import { SalonCard } from "@/components/salon-card";
import { SearchBar } from "@/components/search-bar";
import { Empty } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const parts = [sp.audience ? t.audience[sp.audience as "women" | "men"] : t.nav.search, sp.city ? cityName(sp.city, locale) : null].filter(Boolean);
  return { title: parts.join(" — "), description: t.taglineSub, alternates: { canonical: "/search" } };
}

const num = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const page = Math.max(1, num(sp.page) ?? 1);
  const f: SearchFilters = {
    q: sp.q, city: sp.city || undefined, neighborhood: sp.neighborhood || undefined,
    audience: sp.audience === "women" || sp.audience === "men" ? sp.audience : undefined,
    category: sp.category || undefined, serviceCategory: sp.type || undefined,
    priceMin: num(sp.min) != null ? num(sp.min)! * 100 : undefined, priceMax: num(sp.max) != null ? num(sp.max)! * 100 : undefined,
    ratingMin: num(sp.rating), date: sp.date || undefined, sort: (sp.sort as SearchFilters["sort"]) || "featured", limit: 24, offset: (page - 1) * 24,
  };
  const { rows, total } = await searchSalons(f);
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/search?${p.toString()}`;
  };
  return (
    <div className="container-x py-8">
      <div className="mb-6"><SearchBar t={t} locale={locale} defaults={sp} /></div>
      <div className="mb-6 flex flex-wrap gap-2">
        {([undefined, "women", "men"] as const).map((a) => (
          <Link key={a ?? "all"} href={qs({ audience: a, page: undefined })} className={`chip ${f.audience === a ? "border-plum-700 bg-plum-700 text-white" : ""}`}>
            {a ? t.audience[a] : t.search.all}
          </Link>
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside>
          <form action="/search" className="card sticky top-20 space-y-4 p-4">
            <h2 className="font-semibold">{t.search.filters}</h2>
            {["q", "audience", "neighborhood"].map((k) => sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null)}
            <div><label className="label">{t.search.city}</label>
              <select name="city" defaultValue={sp.city ?? ""} className="input"><option value="">{t.search.anyCity}</option>{CITIES.map((c) => <option key={c.id} value={c.id}>{c[locale]}</option>)}</select></div>
            <div><label className="label">{t.search.type}</label>
              <select name="type" defaultValue={sp.type ?? ""} className="input"><option value="">{t.search.all}</option>{Object.entries(t.serviceCategory).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="label">{t.salon.about}</label>
              <select name="category" defaultValue={sp.category ?? ""} className="input"><option value="">{t.search.all}</option>{Object.entries(t.category).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">{t.search.priceMin}</label><input name="min" type="number" min={0} defaultValue={sp.min} className="input" /></div>
              <div><label className="label">{t.search.priceMax}</label><input name="max" type="number" min={0} defaultValue={sp.max} className="input" /></div>
            </div>
            <div><label className="label">{t.search.rating}</label>
              <select name="rating" defaultValue={sp.rating ?? ""} className="input"><option value="">{t.search.anyRating}</option>{[4.5, 4, 3.5, 3].map((r) => <option key={r} value={r}>{r}+ ★</option>)}</select></div>
            <div><label className="label">{t.search.openOn}</label><input type="date" name="date" defaultValue={sp.date} className="input" /></div>
            <div><label className="label">{t.search.sort}</label>
              <select name="sort" defaultValue={sp.sort ?? "featured"} className="input">
                <option value="featured">{t.search.sortFeatured}</option><option value="rating">{t.search.sortRating}</option><option value="price">{t.search.sortPriceAsc}</option><option value="new">{t.search.sortNew}</option>
              </select></div>
            <button className="btn-primary w-full">{t.search.button}</button>
          </form>
        </aside>
        <section>
          <p className="mb-4 text-sm text-muted">{total} {t.search.results}</p>
          {rows.length === 0 ? <Empty>{t.search.none}</Empty> : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((s) => <SalonCard key={s.id} s={s} t={t} locale={locale} />)}
            </div>
          )}
          {total > page * 24 && <div className="mt-8 text-center"><Link className="btn-outline" href={qs({ page: String(page + 1) })}>→</Link></div>}
        </section>
      </div>
    </div>
  );
}
