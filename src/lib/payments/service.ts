import { sql } from "../db";
import { env } from "../env";
import { AppError, forbidden, notFound } from "../errors";
import { paymentProvider } from ".";
import { postOnlinePayment, postRefund } from "../finance/ledger";
import { commissionFor } from "../finance/commission";
import { notifyUser } from "../notifications";
import { bookingNotificationData, sendBookingCreatedNotifications } from "../booking/service";
import { sar } from "../money";
import { audit } from "../audit";

/**
 * Starts (or resumes) hosted checkout for a booking awaiting online payment.
 * Idempotent: repeated clicks reuse the same open checkout instead of creating duplicate charges.
 */
export async function startCheckout(bookingId: string, customerId: string) {
  const provider = paymentProvider();
  if (!provider.isConfigured()) throw new AppError("payments_not_configured", "Online payment is not configured yet", 503);
  const [b] = await sql<{ id: string; reference: string; customer_id: string; status: string; hold_expires_at: Date | null; amount_due_online_halalas: number; payment_method: string; salon_name: string }[]>`
    select b.*, s.name_en as salon_name from bookings b join salons s on s.id = b.salon_id where b.id = ${bookingId}`;
  if (!b) throw notFound("booking");
  if (b.customer_id !== customerId) throw forbidden();
  if (b.status !== "pending_payment" || !b.hold_expires_at || b.hold_expires_at < new Date())
    throw new AppError("hold_expired", "This booking is no longer awaiting payment", 409);

  const [open] = await sql<{ id: string; checkout_url: string | null; status: string }[]>`
    select id, checkout_url, status from payments where booking_id = ${b.id} and status = 'initiated' order by created_at desc limit 1`;
  if (open?.checkout_url) return { paymentId: open.id, url: open.checkout_url };

  // Lock the idempotency slot BEFORE calling the gateway, so concurrent requests cannot both create checkouts.
  const attempt = (await sql<{ n: number }[]>`select count(*)::int as n from payments where booking_id = ${b.id}`)[0].n;
  const key = `${b.id}:${attempt}`;
  const inserted = await sql<{ id: string }[]>`
    insert into payments (booking_id, provider, idempotency_key, amount_halalas, kind, status)
    values (${b.id}, ${provider.name}, ${key}, ${b.amount_due_online_halalas}, ${b.payment_method === "deposit" ? "deposit" : "online"}, 'initiated')
    on conflict (idempotency_key) do nothing returning id`;
  if (!inserted.length) throw new AppError("checkout_in_progress", "A checkout is already being created, please retry in a moment", 409);
  const paymentId = inserted[0].id;
  const base = env().APP_URL;
  try {
    const c = await provider.createCheckout({
      amount: b.amount_due_online_halalas,
      description: `TREMLY booking ${b.reference} — ${b.salon_name ?? ""}`.slice(0, 250),
      callbackUrl: `${base}/api/payments/callback?pid=${paymentId}`,
      backUrl: `${base}/bookings/${b.reference}`,
      expiresAt: b.hold_expires_at,
      metadata: { booking_id: b.id, booking_reference: b.reference, payment_id: paymentId },
    });
    await sql`update payments set provider_ref = ${c.providerRef}, checkout_url = ${c.url}, raw = ${sql.json(c.raw as never)}, updated_at = now() where id = ${paymentId}`;
    return { paymentId, url: c.url };
  } catch (e) {
    await sql`update payments set status = 'failed', raw = ${sql.json({ error: (e as Error).message })}, updated_at = now() where id = ${paymentId}`;
    throw e;
  }
}

/**
 * Re-verifies a payment with the gateway (server-to-server) and applies the result.
 * This is the ONLY code path that can mark a payment as paid. Safe to call repeatedly (callback + webhook + cron).
 */
export async function reconcilePayment(paymentId: string) {
  const [p] = await sql<{ id: string; booking_id: string; provider_ref: string | null; status: string; amount_halalas: number }[]>`select * from payments where id = ${paymentId}`;
  if (!p) throw notFound("payment");
  if (!p.provider_ref) return { status: p.status };
  if (p.status !== "initiated") return { status: p.status };
  const v = await paymentProvider().fetchCheckout(p.provider_ref);

  if (v.status === "paid") {
    if (v.currency !== "SAR" || v.paidAmount !== p.amount_halalas) {
      await sql`update payments set raw = ${sql.json(v.raw as never)}, updated_at = now() where id = ${p.id}`;
      await audit(null, "payment.amount_mismatch", "payment", p.id, { expected: p.amount_halalas, got: v.paidAmount, currency: v.currency });
      throw new AppError("amount_mismatch", "Payment amount does not match booking", 409);
    }
    const outcome = await sql.begin(async (tx) => {
      const [locked] = await tx<{ status: string }[]>`select status from payments where id = ${p.id} for update`;
      if (locked.status !== "initiated") return { applied: false, needsRefund: false };
      await tx`update payments set status = 'paid', provider_payment_id = ${v.paymentId}, source_type = ${v.sourceType}, verified_at = now(),
        raw = ${tx.json(v.raw as never)}, updated_at = now() where id = ${p.id}`;
      const [b] = await tx<{ id: string; salon_id: string; status: string; requires_approval: boolean; payment_method: string; total_halalas: number; amount_paid_halalas: number }[]>`
        select b.id, b.salon_id, b.status, s.requires_approval, b.payment_method, b.total_halalas, b.amount_paid_halalas
        from bookings b join salons s on s.id = b.salon_id where b.id = ${p.booking_id} for update of b`;
      const paidTotal = b.amount_paid_halalas + p.amount_halalas;
      const paymentStatus = paidTotal >= b.total_halalas ? "paid" : "partially_paid";
      await postOnlinePayment(tx, { salonId: b.salon_id, bookingId: b.id, paymentId: p.id, amount: p.amount_halalas });
      let newStatus = b.status;
      let needsRefund = false;
      if (b.status === "pending_payment") newStatus = b.requires_approval ? "pending_approval" : "confirmed";
      else if (b.status === "expired") {
        // Payment arrived after the hold lapsed: re-claim the slot if it's still free, otherwise refund automatically.
        try {
          await tx.savepoint(async (sp) => { await sp`update bookings set status = ${b.requires_approval ? "pending_approval" : "confirmed"} where id = ${b.id}`; });
          newStatus = b.requires_approval ? "pending_approval" : "confirmed";
        } catch { needsRefund = true; }
      } else if (["cancelled", "rejected"].includes(b.status)) needsRefund = true;
      await tx`update bookings set status = ${newStatus}, amount_paid_halalas = ${paidTotal}, payment_status = ${paymentStatus}, hold_expires_at = null, updated_at = now() where id = ${b.id}`;
      await tx`insert into booking_events (booking_id, event, data) values (${b.id}, 'payment_verified', ${tx.json({ paymentId: p.id, amount: p.amount_halalas, source: v.sourceType })})`;
      return { applied: true, needsRefund, wasPending: b.status !== newStatus };
    });
    if (outcome.applied) {
      const { b, data } = await bookingNotificationData(p.booking_id);
      await notifyUser(b.customer_id, "payment_received", { ...data, amount: sar(p.amount_halalas, b.locale) });
      if (outcome.needsRefund) await refundBooking(p.booking_id, p.amount_halalas, "Payment received after booking was released", null);
      else if (outcome.wasPending) await sendBookingCreatedNotifications(p.booking_id);
    }
    return { status: "paid" };
  }
  if (v.status === "failed" || v.status === "expired") {
    await sql`update payments set status = ${v.status}, raw = ${sql.json(v.raw as never)}, updated_at = now() where id = ${p.id} and status = 'initiated'`;
    return { status: v.status };
  }
  return { status: "initiated" };
}

/** Refunds up to `amount` across the booking's paid payments via the gateway. */
export async function refundBooking(bookingId: string, amount: number, reason: string, actorId: string | null) {
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError("invalid_amount", "Refund amount must be positive");
  const payments = await sql<{ id: string; provider_payment_id: string | null; amount_halalas: number; refunded_halalas: number; salon_id: string }[]>`
    select p.id, p.provider_payment_id, p.amount_halalas, p.refunded_halalas, b.salon_id from payments p join bookings b on b.id = p.booking_id
    where p.booking_id = ${bookingId} and p.status in ('paid', 'partially_refunded') order by p.created_at`;
  const refundable = payments.reduce((a, p) => a + p.amount_halalas - p.refunded_halalas, 0);
  if (amount > refundable) throw new AppError("refund_exceeds", `Maximum refundable is ${refundable} halalas`);
  let remaining = amount;
  const results: { refundId: string; ok: boolean; error?: string }[] = [];
  for (const p of payments) {
    if (remaining <= 0) break;
    const part = Math.min(remaining, p.amount_halalas - p.refunded_halalas);
    if (part <= 0) continue;
    const [r] = await sql<{ id: string }[]>`insert into refunds (payment_id, booking_id, amount_halalas, reason, requested_by) values (${p.id}, ${bookingId}, ${part}, ${reason}, ${actorId}) returning id`;
    if (!p.provider_payment_id) { await sql`update refunds set status = 'failed', raw = ${sql.json({ error: "missing provider payment id" })} where id = ${r.id}`; results.push({ refundId: r.id, ok: false }); continue; }
    const res = await paymentProvider().refund(p.provider_payment_id, part);
    if (!res.ok) {
      await sql`update refunds set status = 'failed', raw = ${sql.json({ error: res.error, raw: res.raw } as never)}, updated_at = now() where id = ${r.id}`;
      results.push({ refundId: r.id, ok: false, error: res.error });
      continue;
    }
    await sql.begin(async (tx) => {
      await tx`update refunds set status = 'succeeded', provider_ref = ${res.ref ?? null}, raw = ${tx.json(res.raw as never)}, updated_at = now() where id = ${r.id}`;
      const [up] = await tx<{ refunded_halalas: number; amount_halalas: number }[]>`update payments set refunded_halalas = refunded_halalas + ${part},
        status = case when refunded_halalas + ${part} >= amount_halalas then 'refunded'::payment_tx_status else 'partially_refunded'::payment_tx_status end, updated_at = now()
        where id = ${p.id} returning refunded_halalas, amount_halalas`;
      void up;
      const [b] = await tx<{ status: string; amount_paid_halalas: number; amount_refunded_halalas: number }[]>`update bookings set amount_refunded_halalas = amount_refunded_halalas + ${part}, updated_at = now()
        where id = ${bookingId} returning status, amount_paid_halalas, amount_refunded_halalas`;
      await tx`update bookings set payment_status = ${b.amount_refunded_halalas >= b.amount_paid_halalas ? "refunded" : "partially_refunded"} where id = ${bookingId}`;
      // If commission was already taken (completed / no-show / late fee), reverse it proportionally.
      const [taken] = await tx<{ pct: string | null }[]>`select max(commission_percent)::text as pct from ledger_entries where booking_id = ${bookingId} and entry_type = 'online_commission'`;
      const pct = taken?.pct ? Number(taken.pct) : undefined;
      await postRefund(tx, { salonId: p.salon_id, bookingId, paymentId: p.id, refundId: r.id, amount: part, reverseCommissionPercent: b.status === "cancelled" || b.status === "rejected" ? undefined : pct });
      await tx`insert into booking_events (booking_id, actor_id, event, data) values (${bookingId}, ${actorId}, 'refunded', ${tx.json({ amount: part, reason })})`;
    });
    remaining -= part;
    results.push({ refundId: r.id, ok: true });
    const { b, data } = await bookingNotificationData(bookingId);
    await notifyUser(b.customer_id, "refund_processed", { ...data, amount: sar(part, b.locale) });
  }
  if (results.some((r) => !r.ok)) await audit(actorId, "refund.failed", "booking", bookingId, { results });
  return { refunded: amount - remaining, results };
}

/** Webhook entry point: authenticate, store once, then reconcile by re-fetching from the gateway. */
export async function handleWebhook(rawBody: string, headers: Headers) {
  const provider = paymentProvider();
  const ev = provider.parseWebhook(rawBody, headers);
  if (!ev) throw new AppError("invalid_signature", "Webhook authentication failed", 401);
  const inserted = await sql`insert into payment_webhook_events (provider, event_id, event_type, payload) values (${provider.name}, ${ev.eventId}, ${ev.type}, ${sql.json(ev.raw as never)})
    on conflict (provider, event_id) do nothing returning id`;
  if (!inserted.length) {
    const [prev] = await sql<{ processed_at: Date | null }[]>`select processed_at from payment_webhook_events where provider = ${provider.name} and event_id = ${ev.eventId}`;
    if (prev?.processed_at) return { duplicate: true };
  }
  try {
    const payments = ev.invoiceId ? await sql<{ id: string }[]>`select id from payments where provider_ref = ${ev.invoiceId}` : [];
    for (const p of payments) await reconcilePayment(p.id);
    await sql`update payment_webhook_events set processed_at = now(), error = null where provider = ${provider.name} and event_id = ${ev.eventId}`;
    return { ok: true, matched: payments.length };
  } catch (e) {
    await sql`update payment_webhook_events set error = ${(e as Error).message} where provider = ${provider.name} and event_id = ${ev.eventId}`;
    throw e;
  }
}

/** Cron: re-verify checkouts that are still open (covers missed webhooks). */
export async function reconcileOpenPayments() {
  const open = await sql<{ id: string }[]>`select id from payments where status = 'initiated' and provider_ref is not null and created_at > now() - interval '2 days' and created_at < now() - interval '2 minutes' limit 100`;
  let n = 0;
  for (const p of open) { try { await reconcilePayment(p.id); n++; } catch (e) { console.error("reconcile", p.id, (e as Error).message); } }
  return n;
}

export { commissionFor };
