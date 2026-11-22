import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/shell";
import { dashPage } from "@/lib/dashboard";
import { can, salonMemberships, type Permission } from "@/lib/auth/rbac";
import { getDict, pick } from "@/lib/i18n";
import { switchSalon } from "./actions";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const ctx = await dashPage("/dashboard");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const items: [string, string, Permission | null][] = [
    ["/dashboard", ar ? "نظرة عامة" : "Overview", null],
    ["/dashboard/calendar", ar ? "التقويم" : "Calendar", "bookings.complete_own"],
    ["/dashboard/bookings", ar ? "الحجوزات" : "Bookings", "bookings.complete_own"],
    ["/dashboard/services", ar ? "الخدمات" : "Services", "catalog.manage"],
    ["/dashboard/staff", ar ? "الموظفون" : "Staff", "staff.manage"],
    ["/dashboard/branches", ar ? "الفروع وساعات العمل" : "Branches & hours", "profile.manage"],
    ["/dashboard/profile", ar ? "ملف الصالون" : "Salon profile", "profile.manage"],
    ["/dashboard/policies", ar ? "سياسات الحجز" : "Booking policies", "policies.manage"],
    ["/dashboard/promotions", ar ? "العروض" : "Promotions", "promotions.manage"],
    ["/dashboard/reviews", ar ? "التقييمات" : "Reviews", "reviews.reply"],
    ["/dashboard/finance", ar ? "المالية والتسويات" : "Finance & settlements", "finance.view"],
    ["/dashboard/team", ar ? "فريق الإدارة" : "Team access", "team.manage"],
  ];
  const memberships = await salonMemberships(ctx.user.id);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="border-e border-line bg-white lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto no-print">
        <div className="flex items-center justify-between p-4"><Logo /></div>
        <div className="px-4 pb-3">
          <div className="text-sm font-semibold">{pick(ctx.salon, "name", locale)}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted"><Badge status={ctx.salon.status} /> <span>{ctx.role}</span></div>
          {memberships.length > 1 && (
            <form action={switchSalon} className="mt-2 flex gap-1">
              <select name="salon_id" defaultValue={ctx.salonId} className="input py-1 text-xs">{memberships.map((m) => <option key={m.salon_id} value={m.salon_id}>{pick(m, "name", locale)}</option>)}</select>
              <button className="btn-outline btn-sm">↻</button>
            </form>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 text-sm lg:flex-col lg:overflow-visible">
          {items.filter(([, , p]) => !p || can(ctx, p)).map(([href, label]) => (
            <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-2 hover:bg-plum-50">{label}</Link>
          ))}
          <Link href={`/salons/${ctx.salon.slug}`} className="whitespace-nowrap rounded-lg px-3 py-2 text-muted hover:bg-plum-50">↗ {ar ? "صفحة الصالون" : "Public page"}</Link>
          <Link href="/" className="whitespace-nowrap rounded-lg px-3 py-2 text-muted hover:bg-plum-50">← {t.nav.home}</Link>
        </nav>
      </aside>
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
