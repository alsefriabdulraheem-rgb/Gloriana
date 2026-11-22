import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

export async function migrate(url: string, log = true) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: !url.includes("pooler.supabase.com") });
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
    for (const f of files) {
      if (done.has(f)) continue;
      const body = fs.readFileSync(path.join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${f})`;
      });
      if (log) console.log("applied", f);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  // Prefer a direct / session-mode URL for DDL (Supabase: port 5432), falling back to DATABASE_URL.
  migrate(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!).then(() => console.log("migrations complete"), (e) => {
    console.error(e);
    process.exit(1);
  });
}
