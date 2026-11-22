/**
 * Creates or promotes a platform administrator.
 * Usage: npx tsx scripts/create-admin.ts admin@yourdomain.sa '+9665XXXXXXXX' 'Full Name'
 * The password is read from the ADMIN_PASSWORD env var (min 12 chars) so it never lands in shell history.
 */
import "dotenv/config";
import postgres from "postgres";
import { hashPassword } from "../src/lib/crypto";

async function main() {
  const [email, phone, name] = process.argv.slice(2);
  const pw = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !phone) throw new Error("usage: create-admin.ts <email> <+9665XXXXXXXX> [name]");
  if (pw.length < 12) throw new Error("Set ADMIN_PASSWORD (min 12 characters)");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql`insert into users (email, phone, full_name, role, password_hash, phone_verified_at) values (${email}, ${phone}, ${name ?? "Admin"}, 'admin', ${await hashPassword(pw)}, now())
    on conflict (email) do update set role = 'admin', password_hash = excluded.password_hash`;
  await sql`insert into audit_logs (action, entity, entity_id, data) values ('admin.created_cli', 'user', ${email}, '{}')`;
  console.log("admin ready:", email);
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
