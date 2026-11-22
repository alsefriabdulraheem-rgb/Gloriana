import { getDict } from "@/lib/i18n";
import { REPORT_TYPES } from "@/lib/reports";
import { addDays, todayLocal } from "@/lib/time";
import { PageTitle } from "@/components/ui";

export default async function Reports() {
  const { locale } = await getDict();
  const ar = locale === "ar";
  const from = addDays(todayLocal(), -30), to = todayLocal();
  return (
    <div>
      <PageTitle title={ar ? "التقارير المالية والتشغيلية" : "Financial & operational reports"} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {REPORT_TYPES.map((type) => (
          <form key={type} className="card space-y-3 p-4" action="/api/admin/export" method="get">
            <h2 className="font-semibold">{type.replace(/_/g, " ")}</h2>
            <input type="hidden" name="type" value={type} />
            <div className="grid grid-cols-2 gap-2"><input type="date" name="from" defaultValue={from} className="input" /><input type="date" name="to" defaultValue={to} className="input" /></div>
            <div className="flex gap-2">
              <button className="btn-primary btn-sm">Excel (.xlsx)</button>
              <button formAction="/admin/reports/print" formTarget="_blank" className="btn-outline btn-sm">PDF</button>
            </div>
          </form>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">{ar ? "PDF: تفتح نسخة قابلة للطباعة — اختر «حفظ كـ PDF» من نافذة الطباعة." : "PDF opens a print-ready report — choose “Save as PDF” in the print dialog."}</p>
    </div>
  );
}
