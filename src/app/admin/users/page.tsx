import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/time";
import { Badge, Flash, PageTitle } from "@/components/ui";
import { setUserRole, setUserStatus } from "../actions";

export default async function Users({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const q = sp.q?.trim() || null, role = sp.role || null;
  const rows = await sql<{ id: string; phone: string | null; email: string | null; full_name: string | null; role: string; status: string; created_at: Date; bookings: number; salons: string | null }[]>`
    select u.id, u.phone, u.email::text, u.full_name, u.role, u.status, u.created_at,
      (select count(*)::int from bookings where customer_id = u.id) as bookings,
      (select string_agg(s.name_ar || ' (' || m.role || ')', '، ') from salon_members m join salons s on s.id = m.salon_id where m.user_id = u.id) as salons
    from users u where u.status <> 'deleted' ${q ? sql`and (u.phone like ${"%" + q + "%"} or u.full_name ilike ${"%" + q + "%"} or u.email ilike ${"%" + q + "%"})` : sql``} ${role ? sql`and u.role = ${role}` : sql``}
    order by u.created_at desc limit 300`;
  return (
    <div>
      <PageTitle title={ar ? "المستخدمون والصلاحيات" : "Users & permissions"} />
      <Flash sp={sp} t={t} />
      <form className="mb-4 flex flex-wrap gap-2"><input name="q" defaultValue={q ?? ""} className="input max-w-xs" placeholder="phone / name / email" />
        <select name="role" defaultValue={role ?? ""} className="input max-w-xs"><option value="">{t.common.all}</option>{["customer", "salon_owner", "salon_staff", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}</select><button className="btn-outline">{t.common.search}</button></form>
      <div className="card overflow-x-auto"><table className="table text-xs">
        <thead><tr><th>{t.common.name}</th><th>{t.common.phone}</th><th>{t.common.email}</th><th>{ar ? "الدور" : "Role"}</th><th>{ar ? "الصالونات" : "Salons"}</th><th>{ar ? "الحجوزات" : "Bookings"}</th><th>{ar ? "التسجيل" : "Joined"}</th><th>{t.common.status}</th><th /></tr></thead>
        <tbody>{rows.map((u) => (
          <tr key={u.id}><td>{u.full_name ?? "—"}</td><td dir="ltr">{u.phone}</td><td>{u.email}</td>
            <td><form action={setUserRole} className="flex gap-1"><input type="hidden" name="id" value={u.id} /><select name="role" defaultValue={u.role} className="input w-32 py-1">{["customer", "salon_owner", "salon_staff", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}</select><button className="btn-outline btn-sm">✓</button></form></td>
            <td>{u.salons}</td><td>{u.bookings}</td><td>{formatDate(u.created_at, locale)}</td><td><Badge status={u.status === "active" ? "approved" : "suspended"} label={u.status} /></td>
            <td><form action={setUserStatus}><input type="hidden" name="id" value={u.id} /><button name="status" value={u.status === "active" ? "suspended" : "active"} className={u.status === "active" ? "btn-danger btn-sm" : "btn-outline btn-sm"}>{u.status === "active" ? (ar ? "تعليق" : "Suspend") : (ar ? "تفعيل" : "Activate")}</button></form></td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
