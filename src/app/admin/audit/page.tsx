import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { PageTitle } from "@/components/ui";

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { locale } = await getDict();
  const q = sp.q?.trim() || null;
  const rows = await sql<{ id: string; created_at: Date; action: string; entity: string; entity_id: string | null; data: unknown; actor: string | null }[]>`
    select a.id, a.created_at, a.action, a.entity, a.entity_id, a.data, coalesce(u.full_name, u.phone) as actor from audit_logs a left join users u on u.id = a.actor_id
    ${q ? sql`where a.action ilike ${"%" + q + "%"} or a.entity_id = ${q}` : sql``} order by a.id desc limit 300`;
  return (
    <div>
      <PageTitle title={locale === "ar" ? "سجل التدقيق" : "Audit log"} />
      <form className="mb-4 flex gap-2"><input name="q" defaultValue={q ?? ""} className="input max-w-sm" placeholder="action / entity id" /><button className="btn-outline">⌕</button></form>
      <div className="card overflow-x-auto"><table className="table text-xs">
        <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Data</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={String(r.id)}><td>{String(r.id)}</td><td className="whitespace-nowrap">{formatDateTime(r.created_at, locale)}</td><td>{r.actor ?? "system"}</td><td className="font-mono">{r.action}</td><td>{r.entity} <span className="font-mono text-muted">{r.entity_id}</span></td><td className="max-w-md truncate font-mono text-muted">{JSON.stringify(r.data)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
