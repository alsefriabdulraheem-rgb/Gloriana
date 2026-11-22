import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { maskPhone } from "@/lib/phone";
import { Badge, PageTitle, Stat } from "@/components/ui";

export default async function NotificationLog() {
  const { locale } = await getDict();
  const ar = locale === "ar";
  const [s] = await sql<{ queued: number; sent: number; failed: number; skipped: number }[]>`select count(*) filter (where status='queued')::int as queued, count(*) filter (where status='sent')::int as sent,
    count(*) filter (where status='failed')::int as failed, count(*) filter (where status='skipped')::int as skipped from notifications where channel <> 'in_app' and created_at > now() - interval '7 days'`;
  const rows = await sql<{ id: string; created_at: Date; channel: string; recipient: string; template: string; status: string; attempts: number; error: string | null; send_after: Date }[]>`
    select id, created_at, channel, recipient, template, status, attempts, error, send_after from notifications where channel <> 'in_app' order by created_at desc limit 200`;
  return (
    <div>
      <PageTitle title={ar ? "سجل الإشعارات (7 أيام)" : "Notification log (7 days)"} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="queued" value={s.queued} /><Stat label="sent" value={s.sent} /><Stat label="failed" value={s.failed} /><Stat label={ar ? "متجاوز (غير مهيأ)" : "skipped (not configured)"} value={s.skipped} /></div>
      <div className="card overflow-x-auto"><table className="table text-xs">
        <thead><tr><th>Created</th><th>Send after</th><th>Channel</th><th>To</th><th>Template</th><th>Status</th><th>Attempts</th><th>Error</th></tr></thead>
        <tbody>{rows.map((n) => <tr key={n.id}><td>{formatDateTime(n.created_at, locale)}</td><td>{formatDateTime(n.send_after, locale)}</td><td>{n.channel}</td><td dir="ltr">{n.recipient.startsWith("+") ? maskPhone(n.recipient) : n.recipient.replace(/(.{2}).+(@.+)/, "$1•••$2")}</td><td>{n.template}</td><td><Badge status={n.status} /></td><td>{n.attempts}</td><td className="text-red-700">{n.error}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
