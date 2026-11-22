import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { reconcilePayment } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

/**
 * Customer returns here from hosted checkout. Query-string status is NOT trusted:
 * we always re-verify with the gateway server-to-server before changing anything.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pid = url.searchParams.get("pid") ?? "";
  const base = process.env.APP_URL ?? url.origin;
  if (!/^[0-9a-f-]{36}$/i.test(pid)) return NextResponse.redirect(new URL("/account", base));
  const [p] = await sql<{ reference: string }[]>`select b.reference from payments p join bookings b on b.id = p.booking_id where p.id = ${pid}`;
  if (!p) return NextResponse.redirect(new URL("/account", base));
  let result = "pending";
  try { result = (await reconcilePayment(pid)).status; } catch (e) { console.error("callback reconcile", (e as Error).message); result = "error"; }
  return NextResponse.redirect(new URL(`/bookings/${p.reference}?payment=${result}`, base));
}
