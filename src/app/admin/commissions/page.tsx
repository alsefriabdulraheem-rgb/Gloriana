import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/time";
import { Flash, PageTitle } from "@/components/ui";
import { saveCommissionRule } from "../actions";

export default async function Commissions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const rules = await sql<{ id: string; scope: string; salon: string | null; category: string | null; online_percent: string; cash_percent: string; effective_from: Date; created_at: Date }[]>`
    select r.id, r.scope, s.name_ar as salon, r.category, r.online_percent::text, r.cash_percent::text, r.effective_from, r.created_at from commission_rules r left join salons s on s.id = r.salon_id
    order by r.scope, r.effective_from desc`;
  const salons = await sql<{ id: string; name_ar: string }[]>`select id, name_ar from salons where status in ('approved','pending_review','suspended') order by name_ar`;
  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "قواعد العمولة" : "Commission rules"} />
      <Flash sp={sp} t={t} />
      <p className="text-sm text-muted">{ar ? "الأولوية: قاعدة الصالون ← قاعدة الفئة ← القاعدة الافتراضية. القواعد لا تُعدّل بل تُضاف بإصدار جديد بتاريخ سريان، للحفاظ على قابلية التدقيق." : "Priority: salon rule → category rule → default. Rules are never edited; add a new version with an effective date so history stays auditable."}</p>
      <form action={saveCommissionRule} className="card grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-7">
        <div><label className="label">{ar ? "النطاق" : "Scope"}</label><select name="scope" defaultValue={sp.salon ? "salon" : "default"} className="input"><option value="default">default</option><option value="category">category</option><option value="salon">salon</option></select></div>
        <div className="lg:col-span-2"><label className="label">{ar ? "الصالون" : "Salon"}</label><select name="salon_id" defaultValue={sp.salon ?? ""} className="input"><option value="">—</option>{salons.map((s) => <option key={s.id} value={s.id}>{s.name_ar}</option>)}</select></div>
        <div><label className="label">{ar ? "الفئة" : "Category"}</label><select name="category" className="input"><option value="">—</option>{Object.entries(t.category).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">{ar ? "أونلاين %" : "Online %"}</label><input name="online_percent" type="number" step="0.01" min={0} max={100} className="input" required /></div>
        <div><label className="label">{ar ? "نقدي %" : "Cash %"}</label><input name="cash_percent" type="number" step="0.01" min={0} max={100} className="input" required /></div>
        <div><label className="label">{ar ? "يسري من" : "Effective from"}</label><input name="effective_from" type="date" className="input" /></div>
        <div className="lg:col-span-7"><button className="btn-primary">{t.common.add}</button></div>
      </form>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>{ar ? "النطاق" : "Scope"}</th><th>{ar ? "الهدف" : "Target"}</th><th>{ar ? "أونلاين" : "Online"}</th><th>{ar ? "نقدي" : "Cash"}</th><th>{ar ? "يسري من" : "Effective"}</th><th>{ar ? "أنشئ" : "Created"}</th></tr></thead>
        <tbody>{rules.map((r) => <tr key={r.id}><td>{r.scope}</td><td>{r.salon ?? r.category ?? "—"}</td><td>{r.online_percent}%</td><td>{r.cash_percent}%</td><td>{formatDate(r.effective_from, locale)}</td><td className="text-xs text-muted">{formatDate(r.created_at, locale)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
