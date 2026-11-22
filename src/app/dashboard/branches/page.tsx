import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { CITIES } from "@/lib/i18n/dict";
import { sql } from "@/lib/db";
import { Flash, PageTitle } from "@/components/ui";
import { addHoliday, removeHoliday, saveBranch, saveHours } from "../actions";

type Branch = { id: string; name_ar: string; name_en: string | null; city: string; neighborhood: string | null; address_ar: string | null; address_en: string | null; lat: string | null; lng: string | null; phone: string | null; is_active: boolean };

export default async function Branches({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/branches", "profile.manage");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const branches = await sql<Branch[]>`select * from salon_branches where salon_id = ${ctx.salonId} order by created_at`;
  const hours = branches.length ? await sql<{ branch_id: string; weekday: number; is_closed: boolean; open_time: string | null; close_time: string | null }[]>`
    select branch_id, weekday, is_closed, to_char(open_time,'HH24:MI') as open_time, to_char(close_time,'HH24:MI') as close_time from branch_hours where branch_id in ${sql(branches.map((b) => b.id))}` : [];
  const holidays = branches.length ? await sql<{ id: string; branch_id: string; date: string; reason: string | null }[]>`
    select id, branch_id, to_char(date,'YYYY-MM-DD') as date, reason from branch_holidays where branch_id in ${sql(branches.map((b) => b.id))} and date >= current_date order by date` : [];

  const BranchForm = ({ b }: { b?: Branch }) => (
    <form action={saveBranch} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {b && <input type="hidden" name="id" value={b.id} />}
      <div><label className="label">{ar ? "اسم الفرع" : "Branch name"}</label><input name="name_ar" defaultValue={b?.name_ar} className="input" required /></div>
      <div><label className="label">Name (EN)</label><input name="name_en" defaultValue={b?.name_en ?? ""} className="input" dir="ltr" /></div>
      <div><label className="label">{t.common.city}</label><select name="city" defaultValue={b?.city ?? "riyadh"} className="input">{CITIES.map((c) => <option key={c.id} value={c.id}>{c[locale]}</option>)}</select></div>
      <div><label className="label">{t.search.neighborhood}</label><input name="neighborhood" defaultValue={b?.neighborhood ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><label className="label">{ar ? "العنوان (عربي)" : "Address (Arabic)"}</label><input name="address_ar" defaultValue={b?.address_ar ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><label className="label">Address (EN)</label><input name="address_en" defaultValue={b?.address_en ?? ""} className="input" dir="ltr" /></div>
      <div><label className="label">{ar ? "خط العرض" : "Latitude"}</label><input name="lat" defaultValue={b?.lat ?? ""} className="input" dir="ltr" placeholder="24.7136" /></div>
      <div><label className="label">{ar ? "خط الطول" : "Longitude"}</label><input name="lng" defaultValue={b?.lng ?? ""} className="input" dir="ltr" placeholder="46.6753" /></div>
      <div><label className="label">{t.common.phone}</label><input name="phone" defaultValue={b?.phone ?? ""} className="input" dir="ltr" /></div>
      <div className="flex items-end gap-3">{b && <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="is_active" defaultChecked={b.is_active} className="accent-plum-700" />{t.common.active}</label>}<button className="btn-primary">{b ? t.common.save : t.common.add}</button></div>
    </form>
  );

  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "الفروع وساعات العمل" : "Branches & opening hours"} />
      <Flash sp={sp} t={t} />
      {branches.map((b) => (
        <section key={b.id} className="card space-y-5 p-4">
          <h2 className="font-semibold">{b.name_ar}</h2>
          <BranchForm b={b} />
          <form action={saveHours} className="overflow-x-auto">
            <input type="hidden" name="branch_id" value={b.id} />
            <h3 className="mb-2 text-sm font-semibold">{t.salon.hours}</h3>
            <table className="table max-w-xl"><tbody>{t.days.map((d, w) => {
              const h = hours.find((x) => x.branch_id === b.id && x.weekday === w);
              return <tr key={w}><td>{d}</td><td><label className="flex items-center gap-1 text-xs"><input type="checkbox" name={`closed_${w}`} defaultChecked={h?.is_closed} className="accent-plum-700" />{t.salon.closed}</label></td>
                <td><input type="time" name={`open_${w}`} defaultValue={h?.open_time ?? "10:00"} className="input py-1" /></td><td><input type="time" name={`close_${w}`} defaultValue={h?.close_time ?? "22:00"} className="input py-1" /></td></tr>;
            })}</tbody></table>
            <button className="btn-primary btn-sm mt-2">{t.common.save}</button>
          </form>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{ar ? "العطل الرسمية والإغلاق" : "Holidays & closures"}</h3>
            <form action={addHoliday} className="mb-2 flex flex-wrap gap-2"><input type="hidden" name="branch_id" value={b.id} /><input type="date" name="date" className="input w-44" required /><input name="reason" className="input w-56" placeholder={ar ? "مثال: اليوم الوطني" : "e.g. National Day"} /><button className="btn-outline btn-sm">{t.common.add}</button></form>
            <ul className="flex flex-wrap gap-2">{holidays.filter((h) => h.branch_id === b.id).map((h) => (
              <li key={h.id} className="chip">{h.date} {h.reason}<form action={removeHoliday}><input type="hidden" name="id" value={h.id} /><button className="text-red-700">✕</button></form></li>
            ))}</ul>
          </div>
        </section>
      ))}
      <details className="card p-4"><summary className="cursor-pointer font-semibold">+ {ar ? "إضافة فرع" : "Add branch"}</summary><div className="mt-4"><BranchForm /></div></details>
    </div>
  );
}
