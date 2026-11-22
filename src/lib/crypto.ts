import crypto from "node:crypto";
import { env } from "./env";

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
export function hmac(s: string, secret = env().APP_SECRET) {
  return crypto.createHmac("sha256", secret).update(s).digest("hex");
}
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}
export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
export function humanCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
export function otpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function scrypt(pw: string, salt: Buffer) {
  return new Promise<Buffer>((res, rej) => crypto.scrypt(pw, salt, 64, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
}
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, s, k] = stored.split("$");
  const key = await scrypt(pw, Buffer.from(s, "base64"));
  const expected = Buffer.from(k, "base64");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
