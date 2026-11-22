import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pageUser, requireUser } from "./auth/session";
import { assertCan, salonContext, type Permission, type SalonContext } from "./auth/rbac";
import { forbidden } from "./errors";
import type { Actor } from "./booking/service";

export const SALON_COOKIE = "tremly_salon";

/** For dashboard pages: resolves the active salon or redirects. */
export async function dashPage(path: string, perm?: Permission): Promise<SalonContext> {
  const user = await pageUser(path);
  const chosen = (await cookies()).get(SALON_COOKIE)?.value;
  const ctx = (chosen && (await salonContext(user, chosen))) || (await salonContext(user));
  if (!ctx) redirect("/for-salons");
  if (perm) { try { assertCan(ctx, perm); } catch { redirect("/dashboard?error=forbidden"); } }
  return ctx;
}

/** For server actions: throws instead of redirecting. */
export async function dashAction(perm: Permission): Promise<SalonContext> {
  const user = await requireUser();
  const chosen = (await cookies()).get(SALON_COOKIE)?.value;
  const ctx = (chosen && (await salonContext(user, chosen))) || (await salonContext(user));
  if (!ctx) throw forbidden();
  assertCan(ctx, perm);
  return ctx;
}

export function actorOf(ctx: SalonContext): Actor {
  return { kind: "salon", userId: ctx.user.id, salonId: ctx.salonId, ownEmployeeOnly: ctx.role === "stylist" ? ctx.employeeId ?? "00000000-0000-0000-0000-000000000000" : null };
}
