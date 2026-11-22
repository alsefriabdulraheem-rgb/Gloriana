import { headers } from "next/headers";
import { z } from "zod";
import { api, assertSameOrigin } from "@/lib/api";
import { clientIp, createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const POST = api(async (req: Request) => {
  assertSameOrigin(req);
  const b = Body.parse(await req.json());
  const ip = clientIp(await headers()) ?? "unknown";
  await rateLimit(`pw:ip:${ip}`, 20, 900);
  await rateLimit(`pw:email:${b.email.toLowerCase()}`, 8, 900);
  const [u] = await sql<{ id: string; password_hash: string | null; status: string; role: string }[]>`select id, password_hash, status, role from users where email = ${b.email}`;
  const ok = await verifyPassword(b.password, u?.password_hash ?? "scrypt$AAAA$AAAA"); // constant-ish time on unknown emails
  if (!u || !ok) {
    await audit(u?.id ?? null, "auth.password_failed", "user", u?.id ?? null, { email: b.email, ip });
    throw new AppError("invalid_credentials", "Incorrect email or password", 401);
  }
  if (u.status !== "active") throw new AppError("account_suspended", "This account is suspended", 403);
  const token = await createSession(u.id);
  await audit(u.id, "auth.login", "user", u.id, { method: "password", ip });
  return { user: { id: u.id, role: u.role }, token };
});
