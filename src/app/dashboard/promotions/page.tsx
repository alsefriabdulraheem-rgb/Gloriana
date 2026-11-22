import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { Badge, Empty, Flash, PageTitle } from "@/components/ui";
import { savePromotion, togglePromotion } from "../actions";

export default async function Promotions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/promotions", "promotions.manage");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const promos = await sql<{ id: string; code: string | null; title_ar: string; discount_type: string; discount_value: number; min_subtotal_halalas: number; starts_at: Date; ends_at: Date | null; redemptions: number; max_redemptions: number | null; is_active: boolean; is_public: boolean }[]>`
    select id, code::text, title_ar, discount_type, discount_value, min_subtotal_halalas, starts_at, ends_at, redemptions, max_redemptions, is_active, is_public from promotions where salon_id = ${ctx.salonId} order by created_at desc`;
  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "العروض وأكواد الخصم" : "Promotions & discount codes"} />
      <Flash sp={sp} t={t} />
      <form action={savePromotion} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><label className="label">{ar ? "العنوان" : "Title"}</label><input name="title_ar" className="input" required /></div>
        <div><label className="label">Title (EN)</label><input name="title_en" className="input" dir="ltr" /></div>
        <div><label className="label">{ar ? "الكود (اختياري)" : "Code (optional)"}</label><input name="code" className="input uppercase" dir="ltr" pattern="[A-Za-z0-9]{3,20}" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">{ar ? "النوع" : "Type"}</label><select name="discount_type" className="input"><option value="percent">%</option><option value="fixed">{t.common.sar}</option></select></div>
          <div><label className="label">{ar ? "القيمة" : "Value"}</label><input name="discount_value" type="number" min={1} step="0.01" className="input" required /></div>
        </div>
        <div><label className="label">{ar ? "الحد الأدنى (ر.س)" : "Min spend (SAR)"}</label><input name="min" type="number" min={0} step="0.01" className="input" /></div>
        <div><label className="label">{ar ? "أقصى خصم (ر.س)" : "Max discount (SAR)"}</label><input name="max_discount" type="number" min={0} step="0.01" className="input" /></div>
        <div><label className="label">{t.common.from}</label><input name="starts" type="date" className="input" /></div>
        <div><label className="label">{t.common.to}</label><input name="ends" type="date" className="input" /></div>
        <div><label className="label">{ar ? "أقصى استخدام" : "Max redemptions"}</label><input name="max_redemptions" type="number" min={1} className="input" /></div>
        <div><label className="label">{ar ? "لكل عميل" : "Per customer"}</label><input name="per_customer" type="number" min={1} defaultValue={1} className="input" /></div>
        <label className="flex items-end gap-2 text-sm"><input type="checkbox" name="is_public" defaultChecked className="h-5 w-5 accent-plum-700" />{ar ? "عرض في صفحة العروض" : "Show on offers page"}</label>
        <div className="flex items-end"><button className="btn-primary">{t.common.add}</button></div>
      </form>
      {promos.length === 0 ? <Empty>{t.common.none}</Empty> : (
        <div className="card overflow-x-auto"><table className="table">
          <thead><tr><th>{ar ? "العنوان" : "Title"}</th><th>{ar ? "الكود" : "Code"}</th><th>{ar ? "الخصم" : "Discount"}</th><th>{ar ? "الفترة" : "Period"}</th><th>{ar ? "الاستخدام" : "Used"}</th><th>{t.common.status}</th><th /></tr></thead>
          <tbody>{promos.map((p) => (
            <tr key={p.id}><td>{p.title_ar}</td><td className="font-mono">{p.code ?? "—"}</td><td>{p.discount_type === "percent" ? `${p.discount_value}%` : sar(p.discount_value, locale)}{p.min_subtotal_halalas ? ` (≥ ${sar(p.min_subtotal_halalas, locale)})` : ""}</td>
              <td className="text-xs">{formatDate(p.starts_at, locale)} → {p.ends_at ? formatDate(p.ends_at, locale) : "∞"}</td><td>{p.redemptions}{p.max_redemptions ? ` / ${p.max_redemptions}` : ""}</td>
              <td><Badge status={p.is_active ? "approved" : "hidden"} label={p.is_active ? t.common.active : t.common.inactive} /></td>
              <td><form action={togglePromotion}><input type="hidden" name="id" value={p.id} /><button className="btn-outline btn-sm">{p.is_active ? (ar ? "إيقاف" : "Disable") : (ar ? "تفعيل" : "Enable")}</button></form></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
