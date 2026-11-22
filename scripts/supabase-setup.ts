/**
 * One-shot, idempotent Supabase setup over HTTPS (Management API) — no direct DB connection needed.
 *   1. Applies db/migrations/*.sql (tracked in schema_migrations)
 *   2. Creates the public storage bucket for salon photos/videos
 *   3. Stores CRON_SECRET in Supabase Vault and schedules /api/cron/tick every minute with pg_cron + pg_net
 *
 * Env: SUPABASE_ACCESS_TOKEN (personal access token), SUPABASE_PROJECT_REF, APP_URL (deployed URL), CRON_SECRET,
 *      SUPABASE_STORAGE_BUCKET (default tremly-media). Flags: --skip-cron, --only-migrations
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const API = "https://api.supabase.com/v1";
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const args = new Set(process.argv.slice(2));

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function query<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const r = await fetch(`${API}/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase query failed (${r.status}): ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as T[]) : [];
}

async function migrations() {
  await query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
  const dir = path.join(process.cwd(), "db", "migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) { console.log("✓ already applied", f); continue; }
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    await query(`begin;\n${body}\n;insert into schema_migrations (name) values (${lit(f)});\ncommit;`);
    console.log("✓ applied", f);
  }
}

async function storage() {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "tremly-media";
  await query(`insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (${lit(bucket)}, ${lit(bucket)}, true, 52428800, array['image/jpeg','image/png','image/webp','video/mp4'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types`);
  console.log("✓ storage bucket", bucket);
}

async function cron() {
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!appUrl?.startsWith("https://")) throw new Error("APP_URL must be the deployed https:// URL");
  if (!secret || secret.length < 16) throw new Error("CRON_SECRET missing");
  await query(`create extension if not exists pg_cron; create extension if not exists pg_net;`);
  await query(`do $$ declare sid uuid; begin
      select id into sid from vault.secrets where name = 'tremly_cron_secret';
      if sid is null then perform vault.create_secret(${lit(secret)}, 'tremly_cron_secret');
      else perform vault.update_secret(sid, ${lit(secret)}); end if;
    end $$;`);
  const job = `select net.http_get(
      url := ${lit(appUrl + "/api/cron/tick")},
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tremly_cron_secret')),
      timeout_milliseconds := 30000)`;
  await query(`select cron.schedule('tremly-tick', '* * * * *', ${lit(job)})`);
  await query(`select cron.schedule('tremly-cron-cleanup', '23 2 * * *', ${lit("delete from cron.job_run_details where end_time < now() - interval '3 days'")})`);
  console.log("✓ pg_cron: tremly-tick every minute ->", appUrl + "/api/cron/tick");
}

async function main() {
  if (!token || !ref) throw new Error("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF");
  await migrations();
  if (args.has("--only-migrations")) return;
  await storage();
  if (!args.has("--skip-cron")) await cron();
  console.log("Supabase setup complete.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
