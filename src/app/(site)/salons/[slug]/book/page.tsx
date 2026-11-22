import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDict, pick } from "@/lib/i18n";
import { getSalonBySlug } from "@/lib/catalog";
import { allowedPaymentMethods } from "@/lib/booking/service";
import { paymentProvider } from "@/lib/payments";
import { currentUser } from "@/lib/auth/session";
import { todayLocal } from "@/lib/time";
import { BookingWizard } from "@/components/booking-wizard";

type P = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const { t, locale } = await getDict();
  const d = await getSalonBySlug(slug);
  return { title: d ? `${t.book.title} — ${pick(d.salon, "name", locale)}` : t.book.title, robots: { index: false } };
}

export default async function BookPage({ params, searchParams }: P) {
  const { slug } = await params;
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const d = await getSalonBySlug(slug);
  if (!d || !d.branches.length) notFound();
  const user = await currentUser();
  const methods = await allowedPaymentMethods(d.salon, paymentProvider().isConfigured());
  const validService = new Set(d.services.map((s) => s.id));
  return (
    <div className="container-x py-8">
      <h1 className="mb-6 font-display text-2xl font-semibold sm:text-3xl">{t.book.title} — {pick(d.salon, "name", locale)}</h1>
      <BookingWizard
        t={t} locale={locale} today={todayLocal()} loggedIn={!!user} needsName={!!user && !user.full_name} methods={methods}
        salon={{ id: d.salon.id, slug: d.salon.slug, name: pick(d.salon, "name", locale), deposit_percent: d.salon.deposit_percent, requires_approval: d.salon.requires_approval, show_staff_photos: d.salon.show_staff_photos, max_advance_days: d.salon.max_advance_days }}
        branches={d.branches.map((b) => ({ id: b.id, name: pick(b, "name", locale) }))}
        services={d.services.map((s) => ({ id: s.id, name: pick(s, "name", locale), description: pick(s, "description", locale), category: s.category, duration_min: s.duration_min, price_halalas: s.price_halalas }))}
        employees={d.employees.map((e) => ({ id: e.id, name: pick(e, "display_name", locale), title: pick(e, "title", locale), photo_url: e.photo_url, branch_id: e.branch_id, serviceIds: d.empServices.filter((x) => x.employee_id === e.id).map((x) => x.service_id) }))}
        initial={{
          services: (sp.services ?? "").split(",").filter((x) => validService.has(x)),
          employee: d.employees.some((e) => e.id === sp.employee) ? sp.employee! : null,
          date: sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date >= todayLocal() ? sp.date : null,
          time: sp.time && /^\d{2}:\d{2}$/.test(sp.time) ? sp.time : null,
        }}
      />
    </div>
  );
}
