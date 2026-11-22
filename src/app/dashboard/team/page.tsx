import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth/rbac";
import { Flash, PageTitle } from "@/components/ui";
import { addMember, removeMember } from "../actions";

export default async function Team({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/team", "team.manage");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const members = await sql<{ id: string; role: string; full_name: string | null; phone: string | null; employee: string | null }[]>`
    select m.id, m.role, u.full_name, u.phone, e.display_name_ar as employee from salon_members m join users u on u.id = m.user_id left join employees e on e.id = m.employee_id
    where m.salon_id = ${ctx.salonId} order by m.created_at`;
  const employees = await sql<{ id: string; display_name_ar: string }[]>`select id, display_name_ar from employees where salon_id = ${ctx.salonId} and is_active`;
  const roles = ["owner", "manager", "receptionist", "stylist"] as const;
  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "صلاحيات فريق الإدارة" : "Team access & roles"} />
      <Flash sp={sp} t={t} />
      <form action={addMember} className="card grid gap-3 p-4 sm:grid-cols-5">
        <input name="phone" className="input" placeholder="05XXXXXXXX" dir="ltr" required />
        <input name="name" className="input" placeholder={t.auth.name} />
        <select name="role" className="input"><option value="manager">manager</option><option value="receptionist">receptionist</option><option value="stylist">stylist</option></select>
        <select name="employee_id" className="input"><option value="">— {ar ? "ربط بموظف" : "link employee"} —</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.display_name_ar}</option>)}</select>
        <button className="btn-primary">{t.common.add}</button>
        <p className="text-xs text-muted sm:col-span-5">{ar ? "يسجل العضو الدخول برقم جواله عبر رمز التحقق." : "Members sign in with their mobile number via OTP."}</p>
      </form>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>{t.common.name}</th><th>{t.common.phone}</th><th>{ar ? "الدور" : "Role"}</th><th>{ar ? "الموظف" : "Employee"}</th><th /></tr></thead>
        <tbody>{members.map((m) => (
          <tr key={m.id}><td>{m.full_name ?? "—"}</td><td dir="ltr">{m.phone}</td><td>{m.role}</td><td>{m.employee ?? "—"}</td>
            <td>{m.role !== "owner" && <form action={removeMember}><input type="hidden" name="id" value={m.id} /><button className="text-red-700">✕</button></form>}</td></tr>
        ))}</tbody>
      </table></div>
      <div className="card overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">{ar ? "مصفوفة الصلاحيات" : "Permission matrix"}</h2>
        <table className="table text-xs">
          <thead><tr><th /> {roles.map((r) => <th key={r}>{r}</th>)}</tr></thead>
          <tbody>{Object.entries(PERMISSIONS).map(([p, allowed]) => <tr key={p}><td className="font-mono">{p}</td>{roles.map((r) => <td key={r}>{(allowed as readonly string[]).includes(r) ? "✓" : ""}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
