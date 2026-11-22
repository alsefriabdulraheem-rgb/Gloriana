import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDict, pick } from "@/lib/i18n";
import { cityName, fmt } from "@/lib/i18n/dict";
import { getSalonBySlug } from "@/lib/catalog";
import { getAvailability } from "@/lib/booking/service";
import { sar } from "@/lib/money";
import { addDays, formatDate, todayLocal } from "@/lib/time";
import { Avatar, Cover, Stars } from "@/components/ui";
import { currentUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

type P = { params: Promise<{ slug: string }> };
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const { locale } = await getDict();
  const d = await getSalonBySlug(slug);
  if (!d) return { title: "Not found", robots: { index: false } };
  const name = pick(d.salon, "name", locale);
  const city = d.branches[0] ? cityName(d.branches[0].city, locale) : "";
  const desc = (pick(d.salon, "description", locale) || `${name} — ${city}`).slice(0, 160);
  return {
    title: `${name}${city ? ` — ${city}` : ""}`,
    description: desc,
    alternates: { canonical: `/salons/${slug}` },
    openGraph: { title: name, description: desc, images: d.salon.cover_url ? [{ url: d.salon.cover_url }] : undefined, url: `/salons/${slug}` },
  };
}

async function reportReview(formData: FormData) {
  "use server";
  const u = await currentUser();
  const slug = String(formData.get("slug"));
  if (!u) redirect(`/login?next=/salons/${slug}`);
  const reviewId = String(formData.get("review_id"));
  await sql`insert into review_reports (review_id, reporter_id, reason) values (${reviewId}, ${u.id}, ${String(formData.get("reason") || "inappropriate").slice(0, 300)}) on conflict do nothing`;
  await sql`update reviews set status = 'reported' where id = ${reviewId} and status = 'published' and (select count(*) from review_reports where review_id = ${reviewId}) >= 3`;
  redirect(`/salons/${slug}?reported=1#reviews`);
}

export default async function SalonPage({ params }: P) {
  const { slug } = await params;
  const { t, locale } = await getDict();
  const d = await getSalonBySlug(slug);
  if (!d) notFound();
  const { salon: s, branches, services, employees, media, reviews, hours } = d;
  const name = pick(s, "name", locale);
  const branch = branches[0];
  const cats = [...new Set(services.map((x) => x.category))];

  // Real-time next availability for the most popular entry service (first listed), today and tomorrow.
  let nextSlots: { date: string; time: string }[] = [];
  if (branch && services[0] && s.status === "approved") {
    for (const date of [todayLocal(), addDays(todayLocal(), 1)]) {
      try {
        const a = await getAvailability({ salonId: s.id, branchId: branch.id, serviceIds: [services[0].id], date });
        nextSlots.push(...a.slots.slice(0, 6).map((x) => ({ date, time: x.time })));
      } catch { /* closed */ }
      if (nextSlots.length >= 6) break;
    }
    nextSlots = nextSlots.slice(0, 6);
  }

  const jsonLd = {
    "@context": "https://schema.org", "@type": s.category === "barbershop" ? "BarberShop" : s.category === "spa" ? "DaySpa" : s.category === "nails" ? "NailSalon" : "BeautySalon",
    name, url: `${APP_URL}/salons/${s.slug}`, image: s.cover_url ?? undefined, telephone: s.phone ?? undefined, priceRange: "SAR",
    address: branch ? { "@type": "PostalAddress", streetAddress: pick(branch, "address", locale), addressLocality: cityName(branch.city, "en"), addressCountry: "SA" } : undefined,
    geo: branch?.lat ? { "@type": "GeoCoordinates", latitude: Number(branch.lat), longitude: Number(branch.lng) } : undefined,
    aggregateRating: s.rating_count > 0 ? { "@type": "AggregateRating", ratingValue: Number(s.rating_avg).toFixed(1), reviewCount: s.rating_count } : undefined,
    openingHoursSpecification: hours.filter((h) => h.branch_id === branch?.id && !h.is_closed).map((h) => ({
      "@type": "OpeningHoursSpecification", dayOfWeek: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][h.weekday], opens: h.open_time, closes: h.close_time,
    })),
    makesOffer: services.slice(0, 20).map((x) => ({ "@type": "Offer", name: pick(x, "name", "en"), price: (x.price_halalas / 100).toFixed(2), priceCurrency: "SAR" })),
  };

  const lat = branch?.lat ? Number(branch.lat) : null, lng = branch?.lng ? Number(branch.lng) : null;
  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="relative h-56 sm:h-80"><Cover url={s.cover_url} alt={name} /><div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" /></div>
      <div className="container-x -mt-14 relative">
        <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-white shadow"><Cover url={s.logo_url} alt={name} /></div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold sm:text-3xl">{name}</h1>
              <span className={`badge ${s.audience === "women" ? "bg-plum-100 text-plum-700" : "bg-slate-200 text-slate-800"}`}>{t.audience[s.audience]}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
              <Stars value={s.rating_avg} count={s.rating_count} size="lg" />
              {branch && <span>{cityName(branch.city, locale)}{branch.neighborhood ? ` · ${branch.neighborhood}` : ""}</span>}
              <span>{(t.category as Record<string, string>)[s.category]}</span>
            </div>
          </div>
          {s.status === "approved" && <Link href={`/salons/${s.slug}/book`} className="btn-primary px-8 py-3 text-base">{t.salon.bookNow}</Link>}
        </div>
      </div>

      <div className="container-x mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-10">
          {pick(s, "description", locale) && <section><h2 className="mb-3 text-lg font-semibold">{t.salon.about}</h2><p className="whitespace-pre-line leading-7 text-ink/80">{pick(s, "description", locale)}</p></section>}

          {media.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">{t.salon.gallery}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {media.map((m) => m.kind === "video"
                  ? <video key={m.id} src={m.url} controls preload="metadata" className="aspect-square w-full rounded-xl object-cover" />
                  : <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-xl"><img src={m.url} alt={m.caption ?? name} loading="lazy" className="h-full w-full object-cover transition hover:scale-105" /></a>)}
              </div>
            </section>
          )}

          <section id="services">
            <h2 className="mb-3 text-lg font-semibold">{t.salon.services}</h2>
            <div className="space-y-6">
              {cats.map((c) => (
                <div key={c}>
                  <h3 className="mb-2 text-sm font-semibold text-plum-700">{(t.serviceCategory as Record<string, string>)[c] ?? c}</h3>
                  <div className="card divide-y divide-line">
                    {services.filter((x) => x.category === c).map((x) => (
                      <div key={x.id} className="flex items-center gap-4 p-4">
                        <div className="flex-1">
                          <div className="font-medium">{pick(x, "name", locale)}</div>
                          {pick(x, "description", locale) && <div className="text-xs text-muted">{pick(x, "description", locale)}</div>}
                          <div className="mt-1 text-xs text-muted">{x.duration_min} {t.salon.min}</div>
                        </div>
                        <div className="font-semibold">{sar(x.price_halalas, locale)}</div>
                        {s.status === "approved" && <Link href={`/salons/${s.slug}/book?services=${x.id}`} className="btn-outline btn-sm">{t.salon.bookNow}</Link>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t.salon.team}</h2>
            {!s.show_staff_photos && <p className="mb-3 text-xs text-muted">🔒 {t.salon.staffPrivate}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {employees.map((e) => (
                <div key={e.id} className="card flex items-center gap-3 p-4">
                  <Avatar name={pick(e, "display_name", locale)} url={e.photo_url} hidden={!s.show_staff_photos} size={52} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{pick(e, "display_name", locale)}</div>
                    <div className="truncate text-xs text-muted">{pick(e, "title", locale)}</div>
                    <Stars value={e.rating_avg} count={e.rating_count} />
                  </div>
                  {s.status === "approved" && <Link href={`/salons/${s.slug}/book?employee=${e.id}`} className="btn-ghost btn-sm">{t.salon.bookNow}</Link>}
                </div>
              ))}
            </div>
          </section>

          <section id="reviews">
            <h2 className="mb-3 text-lg font-semibold">{t.salon.reviews} <span className="text-muted">({s.rating_count})</span></h2>
            {reviews.length === 0 ? <p className="text-sm text-muted">{t.salon.noReviews}</p> : (
              <div className="space-y-3">
                {reviews.map((r) => (
                  <article key={r.id} className="card p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><span className="font-medium">{r.customer || "—"}</span><span className="badge bg-emerald-50 text-emerald-700">✓ {t.salon.verified}</span></div>
                      <span className="text-gold-500">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span>
                    </div>
                    {r.comment && <p className="mt-2 text-sm leading-6">{r.comment}</p>}
                    {r.employee && <p className="mt-1 text-xs text-muted">{t.book.employee}: {r.employee}</p>}
                    {r.salon_reply && <div className="mt-3 rounded-xl bg-plum-50 p-3 text-sm"><span className="font-semibold">{t.salon.reply}: </span>{r.salon_reply}</div>}
                    <div className="mt-2 flex items-center justify-between text-xs text-muted">
                      <span>{formatDate(r.created_at, locale)}</span>
                      <form action={reportReview}><input type="hidden" name="slug" value={s.slug} /><input type="hidden" name="review_id" value={r.id} /><button className="hover:text-red-700">⚑ {t.salon.report}</button></form>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          {s.status === "approved" && (
            <div className="card p-4">
              <h2 className="mb-3 font-semibold">{t.salon.nextSlots}</h2>
              {nextSlots.length === 0 ? <p className="text-sm text-muted">{t.salon.noSlots}</p> : (
                <div className="grid grid-cols-3 gap-2">
                  {nextSlots.map((x) => (
                    <Link key={x.date + x.time} href={`/salons/${s.slug}/book?services=${services[0].id}&date=${x.date}&time=${x.time}`} className="rounded-lg border border-line px-2 py-1.5 text-center text-sm hover:border-plum-500 hover:bg-plum-50">
                      <div className="font-semibold tabular-nums">{x.time}</div>
                      <div className="text-[10px] text-muted">{x.date === todayLocal() ? (locale === "ar" ? "اليوم" : "Today") : (locale === "ar" ? "غداً" : "Tomorrow")}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="card p-4">
            <h2 className="mb-3 font-semibold">{t.salon.hours}</h2>
            <ul className="space-y-1 text-sm">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const h = hours.find((x) => x.branch_id === branch?.id && x.weekday === d);
                return <li key={d} className="flex justify-between"><span className="text-muted">{t.days[d]}</span><span className="tabular-nums">{!h || h.is_closed ? t.salon.closed : `${h.open_time} – ${h.close_time}`}</span></li>;
              })}
            </ul>
          </div>
          {branch && (
            <div className="card overflow-hidden">
              {lat != null && lng != null && (
                <iframe title={t.salon.location} loading="lazy" className="h-48 w-full border-0"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01}%2C${lat - 0.006}%2C${lng + 0.01}%2C${lat + 0.006}&layer=mapnik&marker=${lat}%2C${lng}`} />
              )}
              <div className="space-y-2 p-4 text-sm">
                <h2 className="font-semibold">{t.salon.location}</h2>
                {branches.map((b) => (
                  <p key={b.id}><span className="font-medium">{pick(b, "name", locale)}</span><br /><span className="text-muted">{pick(b, "address", locale)} {b.neighborhood} — {cityName(b.city, locale)}</span></p>
                ))}
                {lat != null && <a className="text-plum-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}>{t.salon.openMap} ↗</a>}
              </div>
            </div>
          )}
          <div className="card space-y-2 p-4 text-sm">
            <h2 className="font-semibold">{t.salon.policies}</h2>
            <p>✓ {fmt(t.salon.freeCancel, { h: s.free_cancel_hours })}</p>
            {s.late_cancel_fee_percent > 0 && <p>• {fmt(t.salon.lateFee, { p: s.late_cancel_fee_percent })}</p>}
            {s.deposit_percent > 0 && <p>• {fmt(t.salon.deposit, { p: s.deposit_percent })}</p>}
            {s.requires_approval && <p>• {t.salon.approval}</p>}
            {s.accepts_cash && s.deposit_percent === 0 && <p>• {t.salon.cash}</p>}
            {pick(s, "cancellation_policy", locale) && <p className="whitespace-pre-line text-muted">{pick(s, "cancellation_policy", locale)}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
