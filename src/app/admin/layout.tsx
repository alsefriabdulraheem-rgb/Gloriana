import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/shell";
import { pageUser } from "@/lib/auth/session";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await pageUser("/admin", ["admin"]);
  const { locale } = await getDict();
  const ar = locale === "ar";
  const [c] = await sql<{ salons: number; complaints: number; reports: number }[]>`select
    (select count(*)::int from salons where status = 'pending_review') as salons,
    (select count(*)::int from complaints where status in ('open','in_progress')) as complaints,
    (select count(distinct review_id)::int from review_reports where resolved_at is null) as reports`;
  const items: [string, string, number?][] = [
    ["/admin", ar ? "لوحة المؤشرات" : "Overview"],
    ["/admin/salons", ar ? "الصالونات" : "Salons", c.salons],
    ["/admin/bookings", ar ? "الحجوزات" : "Bookings"],
    ["/admin/payments", ar ? "المدفوعات والمستردات" : "Payments & refunds"],
    ["/admin/commissions", ar ? "العمولات" : "Commissions"],
    ["/admin/settlements", ar ? "التسويات" : "Settlements"],
    ["/admin/users", ar ? "المستخدمون" : "Users"],
    ["/admin/promotions", ar ? "الحملات والعروض" : "Campaigns"],
    ["/admin/complaints", ar ? "الشكاوى والنزاعات" : "Complaints", c.complaints],
    ["/admin/reviews", ar ? "مراجعة التقييمات" : "Review moderation", c.reports],
    ["/admin/reports", ar ? "التقارير والتصدير" : "Reports & export"],
    ["/admin/notifications", ar ? "سجل الإشعارات" : "Notification log"],
    ["/admin/audit", ar ? "سجل التدقيق" : "Audit log"],
  ];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="bg-plum-900 text-white/85 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto no-print">
        <div className="p-4"><Logo light /><div className="mt-1 text-[11px] tracking-widest text-gold-300">SUPER ADMIN</div></div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-4 text-sm lg:flex-col">
          {items.map(([href, label, n]) => (
            <Link key={href} href={href} className="flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 hover:bg-white/10">
              {label}{n ? <span className="badge bg-gold-500 text-white">{n}</span> : null}
            </Link>
          ))}
          <Link href="/" className="rounded-lg px-3 py-2 text-white/50 hover:bg-white/10">← TREMLY</Link>
        </nav>
      </aside>
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
