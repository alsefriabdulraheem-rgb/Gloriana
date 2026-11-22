import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "../db";
import { randomToken, sha256 } from "../crypto";
import { forbidden, unauthorized } from "../errors";

export const SESSION_COOKIE = "tremly_session";
const SESSION_DAYS = 30;

export type Role = "customer" | "salon_owner" | "salon_staff" | "admin";
export type SessionUser = {
  id: string; phone: string | null; email: string | null; full_name: string | null;
  role: Role; status: string; locale: "ar" | "en"; gender: string | null;
};

/** Creates a DB-backed session. Returns the raw token (also set as an httpOnly cookie). */
export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const h = await headers();
  await sql`insert into sessions (user_id, token_hash, user_agent, ip, expires_at)
    values (${userId}, ${sha256(token)}, ${h.get("user-agent")?.slice(0, 300) ?? null}, ${clientIp(h)},
            now() + make_interval(days => ${SESSION_DAYS}))`;
  const c = await cookies();
  c.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400,
  });
  return token;
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) await sql`delete from sessions where token_hash = ${sha256(token)}`;
  c.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

export async function userFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const [u] = await sql<SessionUser[]>`
    select u.id, u.phone, u.email::text as email, u.full_name, u.role, u.status, u.locale, u.gender
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now() and u.status = 'active'`;
  return u ?? null;
}

/** Reads the session from the cookie, or from `Authorization: Bearer` (mobile apps). */
export async function currentUser(): Promise<SessionUser | null> {
  const c = await cookies();
  let token = c.get(SESSION_COOKIE)?.value;
  if (!token) {
    const auth = (await headers()).get("authorization");
    if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  }
  return userFromToken(token);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw unauthorized();
  return u;
}
export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "admin") throw forbidden();
  return u;
}

/** For server-rendered pages: redirect to login instead of throwing. */
export async function pageUser(next: string, roles?: Role[]): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (roles && !roles.includes(u.role)) redirect("/?denied=1");
  return u;
}

export function clientIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? null;
}
