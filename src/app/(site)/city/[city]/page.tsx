import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDict } from "@/lib/i18n";
import { CITIES, cityName } from "@/lib/i18n/dict";
import { searchSalons } from "@/lib/catalog";
import { SalonCard } from "@/components/salon-card";
import { SearchBar } from "@/components/search-bar";
import { Empty } from "@/components/ui";

type P = { params: Promise<{ city: string }>; searchParams: Promise<{ audience?: string }> };

/** SEO landing pages: /city/riyadh, /city/jeddah?audience=men … */
export async function generateMetadata({ params, searchParams }: P): Promise<Metadata> {
  const { city } = await params;
  const { audience } = await searchParams;
  const { t, locale } = await getDict();
  const a = audience === "men" ? t.audience.men : audience === "women" ? t.audience.women : `${t.audience.women} & ${t.audience.men}`;
  const title = `${a} — ${cityName(city, locale)}`;
  return { title, description: `${title}. ${t.taglineSub}`, alternates: { canonical: `/city/${city}${audience ? `?audience=${audience}` : ""}` } };
}

export default async function CityPage({ params, searchParams }: P) {
  const { city } = await params;
  const { audience } = await searchParams;
  if (!CITIES.some((c) => c.id === city)) notFound();
  const { t, locale } = await getDict();
  const aud = audience === "women" || audience === "men" ? audience : undefined;
  const { rows, total } = await searchSalons({ city, audience: aud, sort: "rating", limit: 48 });
  return (
    <div className="container-x py-10">
      <h1 className="h-section mb-2">{aud ? t.audience[aud] : t.nav.search} — {cityName(city, locale)}</h1>
      <p className="mb-6 text-muted">{total} {t.search.results}</p>
      <div className="mb-8"><SearchBar t={t} locale={locale} defaults={{ city, audience: aud }} /></div>
      {rows.length === 0 ? <Empty>{t.search.none}</Empty> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{rows.map((s) => <SalonCard key={s.id} s={s} t={t} locale={locale} />)}</div>}
    </div>
  );
}
