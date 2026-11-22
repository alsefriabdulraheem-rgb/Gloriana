import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { Badge, Flash, PageTitle } from "@/components/ui";
import { savePlatformPromotion, togglePromotionAdmin } from "../actions";

export default async function AdminPromotions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const promos = await sql<{ id: string; code: string | null; title_ar: string; salon: string | null; discount_type: string; discount_value: number; starts_at: Date; ends_at: Date | null; redemptions: number; max_redemptions: number | null; is_active: boolean }[]>`
    select p.id, p.code::text, p.title_ar, s.name_ar as salon, p.discount_type, p.discount_value, p.starts_at, p.ends_at, p.redemptions, p.max_redemptions, p.is_active
    from promotions p left join salons s on s.id = p.salon_id order by p.salon_id nulls first, p.created_at desc limit 300`;
  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "الحملات الترويجية" : "Promotional campaigns"} />
      <Flash sp={sp} t={t} />
      <p className="text-sm text-muted">{ar ? "الحملات على مستوى المنصة تمولها تريملي: يُعوَّض الصالون عن الخصم في التسوية." : "Platform campaigns are funded by TREMLY: the salon is reimbursed for the discount in its settlement."}</p>
      <form action={savePlatformPromotion} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <input name="title_ar" className="input" placeholder={ar ? "العنوان" : "Title (AR)"} required />
        <input name="title_en" className="input" placeholder="Title (EN)" dir="ltr" />
        <input name="code" className="input uppercase" placeholder="CODE" dir="ltr" required />
        <div className="flex gap-1"><select name="discount_type" className="input w-20"><option value="percent">%</option><option value="fixed">SAR</option></select><input name="discount_value" type="number" step="0.01" min={1} className="input" required /></div>
        <input name="max_discount" type="number" step="0.01" className="input" placeholder={ar ? "أقصى خصم" : "Max discount SAR"} />
        <input name="min" type="number" step="0.01" className="input" placeholder={ar ? "حد أدنى" : "Min spend SAR"} />
        <input name="starts" type="date" className="input" /><input name="ends" type="date" className="input" />
        <input name="max_redemptions" type="number" className="input" placeholder={ar ? "أقصى استخدام" : "Max redemptions"} />
        <input name="per_customer" type="number" defaultValue={1} min={1} className="input" />
        <button className="btn-primary">{t.common.add}</button>
      </form>
      <div className="card overflow-x-auto"><table className="table text-xs">
        <thead><tr><th>{ar ? "العنوان" : "Title"}</th><th>{ar ? "الصالون" : "Salon"}</th><th>Code</th><th>{ar ? "الخصم" : "Discount"}</th><th>{ar ? "الفترة" : "Period"}</th><th>{ar ? "الاستخدام" : "Used"}</th><th /></tr></thead>
        <tbody>{promos.map((p) => (
          <tr key={p.id}><td>{p.title_ar}</td><td>{p.salon ?? <span className="badge bg-plum-700 text-white">TREMLY</span>}</td><td className="font-mono">{p.code}</td><td>{p.discount_type === "percent" ? `${p.discount_value}%` : sar(p.discount_value, locale)}</td>
            <td>{formatDate(p.starts_at, locale)} → {p.ends_at ? formatDate(p.ends_at, locale) : "∞"}</td><td>{p.redemptions}{p.max_redemptions ? `/${p.max_redemptions}` : ""}</td>
            <td><form action={togglePromotionAdmin}><input type="hidden" name="id" value={p.id} /><button><Badge status={p.is_active ? "approved" : "hidden"} label={p.is_active ? t.common.active : t.common.inactive} /></button></form></td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
