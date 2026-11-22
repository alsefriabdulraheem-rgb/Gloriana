import { NextResponse } from "next/server";
import { releaseExpiredHolds } from "@/lib/booking/service";
import { reconcileOpenPayments } from "@/lib/payments/service";
import { dispatchQueued } from "@/lib/notifications";
import { safeEqual } from "@/lib/crypto";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Background worker — call every minute (Vercel Cron, Supabase pg_cron + pg_net, or any scheduler):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://tremly.sa/api/cron/tick
 * Releases expired unpaid holds, re-verifies open payments (missed webhooks), and sends queued notifications/reminders.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !safeEqual(got, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const released = await releaseExpiredHolds();
  const reconciled = await reconcileOpenPayments();
  const notifications = await dispatchQueued(200);
  await sql`update bookings set reminder_sent_at = now() where reminder_sent_at is null and status = 'confirmed' and starts_at < now() + interval '24 hours' and starts_at > now()`;
  await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  await sql`delete from sessions where expires_at < now()`;
  return NextResponse.json({ released, reconciled, notifications });
}
