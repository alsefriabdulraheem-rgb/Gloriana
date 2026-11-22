import ExcelJS from "exceljs";
import { requireAdmin } from "@/lib/auth/session";
import { api } from "@/lib/api";
import { reportData, REPORT_TYPES, type ReportType } from "@/lib/reports";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { addDays, todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Excel export: /api/admin/export?type=bookings&from=2026-01-01&to=2026-01-31 */
export const GET = api(async (req: Request) => {
  const admin = await requireAdmin();
  const p = new URL(req.url).searchParams;
  const type = p.get("type") as ReportType;
  if (!REPORT_TYPES.includes(type)) throw new AppError("validation", "Unknown report");
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const from = date.test(p.get("from") ?? "") ? p.get("from")! : addDays(todayLocal(), -30);
  const to = date.test(p.get("to") ?? "") ? p.get("to")! : todayLocal();
  const { columns, rows } = await reportData(type, from, to);
  const wb = new ExcelJS.Workbook();
  wb.creator = "TREMLY";
  const ws = wb.addWorksheet(type);
  ws.addRow([`TREMLY — ${type}`, `${from} → ${to}`]).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(columns);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5C264C" } }; });
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => { c.width = 18; });
  ws.views = [{ state: "frozen", ySplit: 3 }];
  const buf = await wb.xlsx.writeBuffer();
  await audit(admin.id, "report.exported", "report", type, { from, to, rows: rows.length });
  return new Response(buf as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="tremly-${type}-${from}-${to}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
