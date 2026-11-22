import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { Badge, Empty, Flash, PageTitle } from "@/components/ui";
import { saveService } from "../actions";
import type { Dict } from "@/lib/i18n/dict";

type Svc = { id: string; name_ar: string; name_en: string | null; description_ar: string | null; description_en: string | null; category: string; duration_min: number; price_halalas: number; is_active: boolean; sort: number };

function ServiceForm({ s, t, ar, employees, assigned }: { s?: Svc; t: Dict; ar: boolean; employees: { id: string; display_name_ar: string }[]; assigned: string[] }) {
  return (
    <form action={saveService} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {s && <input type="hidden" name="id" value={s.id} />}
      <div><label className="label">{ar ? "الاسم (عربي)" : "Name (Arabic)"}</label><input name="name_ar" defaultValue={s?.name_ar} className="input" required /></div>
      <div><label className="label">{ar ? "الاسم (إنجليزي)" : "Name (English)"}</label><input name="name_en" defaultValue={s?.name_en ?? ""} className="input" dir="ltr" /></div>
      <div><label className="label">{t.search.type}</label><select name="category" defaultValue={s?.category ?? "hair"} className="input">{Object.entries(t.serviceCategory).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">{t.common.duration} ({t.salon.min})</label><input name="duration_min" type="number" min={5} max={600} step={5} defaultValue={s?.duration_min ?? 30} className="input" required /></div>
        <div><label className="label">{t.common.price} ({t.common.sar})</label><input name="price" type="number" min={0} step="0.01" defaultValue={s ? (s.price_halalas / 100).toFixed(2) : ""} className="input" required /></div>
      </div>
      <div className="sm:col-span-2"><label className="label">{ar ? "الوصف (عربي)" : "Description (Arabic)"}</label><input name="description_ar" defaultValue={s?.description_ar ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><label className="label">{ar ? "الوصف (إنجليزي)" : "Description (English)"}</label><input name="description_en" defaultValue={s?.description_en ?? ""} className="input" dir="ltr" /></div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className="label">{ar ? "الموظفون المؤهلون" : "Qualified staff"}</label>
        <div className="flex flex-wrap gap-2">{employees.map((e) => <label key={e.id} className="chip cursor-pointer"><input type="checkbox" name="employees" value={e.id} defaultChecked={s ? assigned.includes(e.id) : true} className="accent-plum-700" />{e.display_name_ar}</label>)}</div>
      </div>
      <div className="flex items-end gap-3">
        <input type="hidden" name="sort" value={s?.sort ?? 0} />
        {s && <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="is_active" defaultChecked={s.is_active} className="accent-plum-700" />{t.common.active}</label>}
        <button className="btn-primary">{s ? t.common.save : t.common.add}</button>
      </div>
    </form>
  );
}

export default async function Services({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/services", "catalog.manage");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const services = await sql<Svc[]>`select * from services where salon_id = ${ctx.salonId} order by is_active desc, sort, category, name_ar`;
  const employees = await sql<{ id: string; display_name_ar: string }[]>`select id, display_name_ar from employees where salon_id = ${ctx.salonId} and is_active order by created_at`;
  const links = await sql<{ employee_id: string; service_id: string }[]>`select es.* from employee_services es join services s on s.id = es.service_id where s.salon_id = ${ctx.salonId}`;
  return (
    <div>
      <PageTitle title={ar ? "الخدمات والأسعار" : "Services & prices"} />
      <Flash sp={sp} t={t} />
      <details className="card mb-6" open={services.length === 0}>
        <summary className="cursor-pointer p-4 font-semibold">+ {ar ? "إضافة خدمة" : "Add service"}</summary>
        <ServiceForm t={t} ar={ar} employees={employees} assigned={[]} />
      </details>
      {services.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="space-y-2">
          {services.map((s) => (
            <details key={s.id} className="card">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                <span className="flex-1 font-medium">{s.name_ar} {s.name_en && <span className="text-muted">/ {s.name_en}</span>}</span>
                <span className="text-xs text-muted">{(t.serviceCategory as Record<string, string>)[s.category]}</span>
                <span className="text-sm">{s.duration_min} {t.salon.min}</span>
                <span className="font-semibold">{sar(s.price_halalas, locale)}</span>
                <span className="text-xs text-muted">👤 {links.filter((l) => l.service_id === s.id).length}</span>
                {!s.is_active && <Badge status="hidden" label={t.common.inactive} />}
              </summary>
              <div className="border-t border-line"><ServiceForm s={s} t={t} ar={ar} employees={employees} assigned={links.filter((l) => l.service_id === s.id).map((l) => l.employee_id)} /></div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
