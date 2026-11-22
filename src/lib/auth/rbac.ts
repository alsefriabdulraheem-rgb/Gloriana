import { sql } from "../db";
import { forbidden } from "../errors";
import type { SessionUser } from "./session";

export type MemberRole = "owner" | "manager" | "receptionist" | "stylist";

/**
 * Salon permission matrix. Stylists only see their own calendar; receptionists manage bookings;
 * managers manage catalogue and staff; only owners see finance & policies and manage the team.
 */
export const PERMISSIONS = {
  "bookings.view_all": ["owner", "manager", "receptionist"],
  "bookings.manage": ["owner", "manager", "receptionist"],
  "bookings.complete_own": ["owner", "manager", "receptionist", "stylist"],
  "schedule.block_own": ["owner", "manager", "receptionist", "stylist"],
  "catalog.manage": ["owner", "manager"],
  "staff.manage": ["owner", "manager"],
  "profile.manage": ["owner", "manager"],
  "promotions.manage": ["owner", "manager"],
  "reviews.reply": ["owner", "manager"],
  "finance.view": ["owner"],
  "policies.manage": ["owner"],
  "team.manage": ["owner"],
} as const satisfies Record<string, readonly MemberRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export type SalonContext = {
  salonId: string; role: MemberRole; employeeId: string | null; user: SessionUser;
  salon: { id: string; slug: string; name_ar: string; name_en: string | null; status: string; audience: "women" | "men" };
};

export function can(ctx: Pick<SalonContext, "role">, p: Permission) {
  return (PERMISSIONS[p] as readonly string[]).includes(ctx.role);
}

export async function salonMemberships(userId: string) {
  return sql<{ salon_id: string; role: MemberRole; name_ar: string; name_en: string | null; status: string }[]>`
    select m.salon_id, m.role, s.name_ar, s.name_en, s.status from salon_members m join salons s on s.id = m.salon_id
    where m.user_id = ${userId} order by m.created_at`;
}

export async function salonContext(user: SessionUser, salonId?: string | null): Promise<SalonContext | null> {
  const rows = await sql<(SalonContext["salon"] & { role: MemberRole; employee_id: string | null })[]>`
    select s.id, s.slug, s.name_ar, s.name_en, s.status, s.audience, m.role, m.employee_id
    from salon_members m join salons s on s.id = m.salon_id
    where m.user_id = ${user.id} ${salonId ? sql`and s.id = ${salonId}` : sql``}
    order by m.created_at limit 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    salonId: r.id, role: r.role, employeeId: r.employee_id, user,
    salon: { id: r.id, slug: r.slug, name_ar: r.name_ar, name_en: r.name_en, status: r.status, audience: r.audience },
  };
}

export function assertCan(ctx: SalonContext, p: Permission) {
  if (!can(ctx, p)) throw forbidden();
}
