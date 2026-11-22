import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { integrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Uptime / deploy check. Reports which integrations are configured (never their values). */
export async function GET() {
  const started = Date.now();
  try {
    const [r] = await sql<{ migrations: number }[]>`select count(*)::int as migrations from schema_migrations`;
    return NextResponse.json({ ok: true, db: "up", dbLatencyMs: Date.now() - started, migrations: r.migrations, integrations: integrationStatus() });
  } catch (e) {
    console.error("health", (e as Error).message);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
