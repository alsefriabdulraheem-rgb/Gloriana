import { NextResponse } from "next/server";
import { handleWebhook } from "@/lib/payments/service";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Configure this URL in the Moyasar dashboard: {APP_URL}/api/payments/webhook (events: payment_paid, payment_failed, payment_refunded). */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  try {
    return NextResponse.json(await handleWebhook(raw, req.headers));
  } catch (e) {
    if (e instanceof AppError && e.status === 401) return NextResponse.json({ error: e.code }, { status: 401 });
    console.error("webhook", e);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 }); // gateway will retry
  }
}
