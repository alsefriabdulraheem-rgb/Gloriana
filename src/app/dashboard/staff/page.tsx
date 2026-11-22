import Link from "next/link";
import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { Avatar, Badge, Empty, Flash, PageTitle } from "@/components/ui";
import { saveEmployee } from "../actions";

export default async function Staff({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/staff", "staff.manage");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const branches = await sql<{ id: string; name_ar: string }[]>`select id, name_ar from salon_branches where salon_id = ${ctx.salonId} order by created_at`;
  const staff = await sql<{ id: string; display_name_ar: string; title_ar: string | null; photo_url: string | null; is_active: boolean; rating_avg: number; rating_count: number; branch: string; month_count: number; month_rev: number; services: number }[]>`
    select e.id, e.display_name_ar, e.title_ar, e.photo_url, e.is_active, e.rating_avg::float as rating_avg, e.rating_count, b.name_ar as branch,
      (select count(*)::int from bookings where employee_id = e.id and status = 'completed' and completed_at > now() - interval '30 days') as month_count,
      (select coalesce(sum(total_halalas),0)::int from bookings where employee_id = e.id and status = 'completed' and completed_at > now() - interval '30 days') as month_rev,
      (select count(*)::int from employee_services where employee_id = e.id) as services
    from employees e join salon_branches b on b.id = e.branch_id where e.salon_id = ${ctx.salonId} order by e.is_active desc, e.created_at`;
  return (
    <div>
      <PageTitle title={ar ? "الموظفون" : "Staff"} />
      <Flash sp={sp} t={t} />
      <details className="card mb-6" open={staff.length === 0}>
        <summary className="cursor-pointer p-4 font-semibold">+ {ar ? "إضافة موظف" : "Add employee"}</summary>
        <form action={saveEmployee} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="label">{ar ? "الاسم (عربي)" : "Name (Arabic)"}</label><input name="display_name_ar" className="input" required /></div>
          <div><label className="label">{ar ? "الاسم (إنجليزي)" : "Name (English)"}</label><input name="display_name_en" className="input" dir="ltr" /></div>
          <div><label className="label">{t.book.branch}</label><select name="branch_id" className="input">{branches.map((b) => <option key={b.id} value={b.id}>{b.name_ar}</option>)}</select></div>
          <div><label className="label">{ar ? "المسمى / التخصص" : "Title / specialty"}</label><input name="title_ar" className="input" /></div>
          <div><label className="label">{ar ? "المسمى (إنجليزي)" : "Title (English)"}</label><input name="title_en" className="input" dir="ltr" /></div>
          <div><label className="label">{ar ? "الصورة" : "Photo"}</label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">{ar ? "نبذة" : "Bio"}</label><input name="bio_ar" className="input" /></div>
          <div className="flex items-end"><button className="btn-primary">{t.common.add}</button></div>
          <p className="text-xs text-muted sm:col-span-3">{ar ? "سيتم نسخ ساعات عمل الفرع كجدول افتراضي وإسناد كل الخدمات — يمكنك تعديلها لاحقاً." : "Branch hours are copied as the default schedule and all services assigned — adjust afterwards."}</p>
        </form>
      </details>
      {staff.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {staff.map((e) => (
            <Link key={e.id} href={`/dashboard/staff/${e.id}`} className="card flex gap-3 p-4 hover:border-plum-200">
              <Avatar name={e.display_name_ar} url={e.photo_url} size={56} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex items-center gap-2 font-semibold">{e.display_name_ar} {!e.is_active && <Badge status="hidden" label={t.common.inactive} />}</div>
                <div className="text-xs text-muted">{e.title_ar} · {e.branch}</div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                  <span>★ {e.rating_avg ? e.rating_avg.toFixed(1) : "—"} ({e.rating_count})</span>
                  <span>{e.month_count} {ar ? "/30ي" : "/30d"}</span>
                  <span>{sar(e.month_rev, locale)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
