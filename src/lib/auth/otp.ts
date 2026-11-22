import { sql } from "../db";
import { hmac, otpCode, safeEqual } from "../crypto";
import { AppError } from "../errors";
import { rateLimit } from "../rate-limit";
import { sendSms } from "../notifications/providers";
import { render } from "../notifications/templates";

const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;

export async function requestOtp(phone: string, ip: string | null, locale: "ar" | "en" = "ar") {
  await rateLimit(`otp:phone:${phone}`, 5, 3600);
  if (ip) await rateLimit(`otp:ip:${ip}`, 20, 3600);
  const [recent] = await sql`select 1 from otp_codes where phone = ${phone} and created_at > now() - interval '45 seconds'`;
  if (recent) throw new AppError("otp_cooldown", "Please wait before requesting another code", 429);

  const code = otpCode();
  await sql`update otp_codes set consumed_at = now() where phone = ${phone} and consumed_at is null`;
  await sql`insert into otp_codes (phone, code_hash, expires_at)
    values (${phone}, ${hmac(`${phone}:${code}`)}, now() + make_interval(mins => ${OTP_TTL_MIN}))`;
  const res = await sendSms(phone, render("otp", locale, { code }).body);
  if (!res.ok) throw new AppError("sms_unavailable", "SMS delivery is not available: " + res.error, 503);
  return { expiresInSec: OTP_TTL_MIN * 60 };
}

/** Verifies an OTP; returns true once, then the code is consumed. */
export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  await rateLimit(`otp:verify:${phone}`, 10, 900);
  const [row] = await sql<{ id: string; code_hash: string; attempts: number }[]>`
    select id, code_hash, attempts from otp_codes
    where phone = ${phone} and consumed_at is null and expires_at > now()
    order by created_at desc limit 1`;
  if (!row) return false;
  if (row.attempts >= MAX_ATTEMPTS) {
    await sql`update otp_codes set consumed_at = now() where id = ${row.id}`;
    return false;
  }
  if (!safeEqual(row.code_hash, hmac(`${phone}:${code}`))) {
    await sql`update otp_codes set attempts = attempts + 1 where id = ${row.id}`;
    return false;
  }
  const consumed = await sql`update otp_codes set consumed_at = now() where id = ${row.id} and consumed_at is null returning id`;
  return consumed.length === 1;
}
