import { z } from "zod";
import { api, assertSameOrigin } from "@/lib/api";
import { verifyOtp } from "@/lib/auth/otp";
import { createSession } from "@/lib/auth/session";
import { normalizeSaudiPhone } from "@/lib/phone";
import { AppError } from "@/lib/errors";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getLocale } from "@/lib/i18n";

const Body = z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/), name: z.string().trim().max(80).optional() });

export const POST = api(async (req: Request) => {
  assertSameOrigin(req);
  const b = Body.parse(await req.json());
  const phone = normalizeSaudiPhone(b.phone);
  if (!phone) throw new AppError("invalid_phone", "Invalid phone");
  if (!(await verifyOtp(phone, b.code))) throw new AppError("invalid_otp", "Invalid or expired code", 401);
  const locale = await getLocale();
  const [user] = await sql<{ id: string; role: string; status: string; full_name: string | null; created: boolean }[]>`
    insert into users (phone, phone_verified_at, full_name, locale) values (${phone}, now(), ${b.name || null}, ${locale})
    on conflict (phone) do update set phone_verified_at = now(), full_name = coalesce(users.full_name, excluded.full_name), updated_at = now()
    returning id, role, status, full_name, (xmax = 0) as created`;
  if (user.status !== "active") throw new AppError("account_suspended", "This account is suspended", 403);
  if (user.created) await sql`insert into notification_preferences (user_id) values (${user.id}) on conflict do nothing`;
  const token = await createSession(user.id);
  await audit(user.id, user.created ? "auth.signup" : "auth.login", "user", user.id, { method: "otp" });
  return { user: { id: user.id, role: user.role, full_name: user.full_name }, token, needsName: !user.full_name };
});
