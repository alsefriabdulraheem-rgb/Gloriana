import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __tremlySql: postgres.Sql | undefined;
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    // Serverless (Vercel): keep each function instance small and rely on Supabase's pooler (port 6543).
    max: Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 2 : 10)),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !url.includes("pooler.supabase.com"), // Supabase transaction pooler does not support prepared statements
    transform: { undefined: null },
    types: { bigint: postgres.BigInt },
  });
}

export const sql: postgres.Sql = globalThis.__tremlySql ?? (globalThis.__tremlySql = create());
export type Tx = postgres.TransactionSql;
export type Db = postgres.Sql | postgres.TransactionSql;
