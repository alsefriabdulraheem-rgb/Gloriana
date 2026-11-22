import Link from "next/link";
import { getDict, pick } from "@/lib/i18n";
import { homeSections, type SalonCardRow } from "@/lib/catalog";
import { SalonCard } from "@/components/salon-card";
import { SearchBar } from "@/components/search-bar";
import { Cover, Empty } from "@/components/ui";
import { sar } from "@/lib/money";
import type { Dict } from "@/lib/i18n/dict";

export const dynamic = "force-dynamic";

function Row({ title, items, t, locale, href }: { title: string; items: SalonCardRow[]; t: Dict; locale: "ar" | "en"; href: string }) {
  if (!items.length) return null;
  return (
    <section className="container-x mt-14">
      <div className="mb-5 flex items-end justify-between">
        <h2 className="h-section">{title}</h2>
        <Link href={href} className="text-sm font-semibold text-plum-700 hover:underline">{t.home.browse}</Link>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((s) => <SalonCard key={s.id} s={s} t={t} locale={locale} />)}
      </div>
    </section>
  );
}

export default async function Home() {
  const { t, locale } = await getDict();
  const h = await homeSections();
  const nothing = !h.featured.length && !h.recent.length;
  return (
    <>
      <section className="relative overflow-hidden bg-plum-900 text-white">
        <div className="absolute inset-0 opacity-40">
          <img src="https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=2000&q=70" alt="" className="h-full w-full object-cover" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-plum-900 via-plum-900/70 to-plum-900/30" />
        <div className="container-x relative py-20 sm:py-28">
          <p className="mb-4 text-sm font-semibold tracking-[0.3em] text-gold-300">TREMLY</p>
          <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-6xl">{t.tagline}</h1>
          <p className="mt-4 max-w-2xl text-base text-white/80 sm:text-lg">{t.taglineSub}</p>
          <div className="mt-8 max-w-4xl text-ink"><SearchBar t={t} locale={locale} /></div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/search?audience=women" className="btn bg-white text-plum-700 hover:bg-plum-50">♀ {t.audience.women}</Link>
            <Link href="/search?audience=men" className="btn border border-white/30 text-white hover:bg-white/10">♂ {t.audience.men}</Link>
          </div>
        </div>
      </section>

      <section className="container-x mt-12">
        <div className="grid gap-4 sm:grid-cols-2">
          {(["women", "men"] as const).map((a) => (
            <Link key={a} href={`/search?audience=${a}`} className={`group relative flex h-44 items-end overflow-hidden rounded-3xl p-6 text-white ${a === "women" ? "bg-plum-700" : "bg-slate-men"}`}>
              <img alt="" className="absolute inset-0 h-full w-full object-cover opacity-50 transition duration-700 group-hover:scale-105" src={a === "women"
                ? "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=70"
                : "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=70"} />
              <div className="relative">
                <div className="font-display text-2xl font-semibold">{t.audience[a]}</div>
                <div className="text-sm text-white/80">{a === "women" ? `${t.category.salon} · ${t.category.spa} · ${t.category.nails} · ${t.category.makeup}` : `${t.category.barbershop} · ${t.category.grooming} · ${t.category.spa}`}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {h.popular.length > 0 && (
        <section className="container-x mt-12">
          <h2 className="h-section mb-4">{t.home.popular}</h2>
          <div className="flex flex-wrap gap-2">
            {h.popular.map((p) => (
              <Link key={p.category} href={`/search?type=${p.category}`} className="chip hover:border-plum-200 hover:bg-plum-50">
                {(t.serviceCategory as Record<string, string>)[p.category] ?? p.category}
              </Link>
            ))}
          </div>
        </section>
      )}

      {nothing && <div className="container-x mt-14"><Empty>{t.search.none}</Empty></div>}
      <Row title={t.home.featured} items={h.featured} t={t} locale={locale} href="/search?sort=featured" />

      {h.offers.length > 0 && (
        <section className="container-x mt-14">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="h-section">{t.home.offers}</h2>
            <Link href="/offers" className="text-sm font-semibold text-plum-700 hover:underline">{t.home.browse}</Link>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
            {h.offers.map((o) => (
              <Link key={o.id} href={o.slug ? `/salons/${o.slug}` : "/offers"} className="card relative w-72 shrink-0 overflow-hidden">
                <div className="h-28"><Cover url={o.cover_url} alt="" /></div>
                <div className="p-4">
                  <div className="text-lg font-bold text-plum-700">{o.discount_type === "percent" ? `-${o.discount_value}%` : `-${sar(o.discount_value, locale)}`}</div>
                  <div className="text-sm font-medium">{pick(o, "title", locale)}</div>
                  <div className="text-xs text-muted">{o.name_ar ? pick(o, "name", locale) : "TREMLY"}{o.code ? ` · ${o.code}` : ""}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Row title={t.home.topRated} items={h.topRated} t={t} locale={locale} href="/search?sort=rating" />
      <Row title={t.home.recent} items={h.recent} t={t} locale={locale} href="/search?sort=new" />

      <section className="container-x mt-16">
        <h2 className="h-section mb-6 text-center">{t.home.howTitle}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[t.home.how1, t.home.how2, t.home.how3].map((s, i) => (
            <div key={i} className="card p-6 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-plum-100 font-bold text-plum-700">{i + 1}</div>
              <p className="font-medium">{s}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container-x mt-16">
        <div className="flex flex-col items-start gap-4 rounded-3xl bg-gradient-to-br from-plum-700 to-plum-900 p-8 text-white sm:flex-row sm:items-center sm:justify-between sm:p-12">
          <div>
            <h2 className="font-display text-3xl font-semibold">{t.home.partner}</h2>
            <p className="mt-2 max-w-xl text-white/80">{t.home.partnerSub}</p>
          </div>
          <Link href="/for-salons" className="btn-gold">{t.nav.forSalons}</Link>
        </div>
      </section>
    </>
  );
}
