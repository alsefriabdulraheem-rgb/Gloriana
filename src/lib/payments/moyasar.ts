import { env } from "../env";
import { safeEqual } from "../crypto";
import { AppError } from "../errors";
import type { CheckoutStatus, PaymentProvider, VerifiedPayment } from "./provider";

/**
 * Moyasar (SAMA-licensed Saudi gateway). Uses the hosted Invoices checkout, so card data never touches
 * TREMLY servers (PCI-DSS SAQ-A). Supports mada, Visa, Mastercard, Apple Pay and STC Pay — the methods shown
 * on the hosted page are those activated on the merchant account.
 * Docs: https://docs.moyasar.com/api/invoices/01-create-invoice , https://docs.moyasar.com/guides/dashboard/webhooks
 */
const API = "https://api.moyasar.com/v1";

type MoyasarPayment = { id: string; status: string; amount: number; currency: string; refunded?: number; source?: { type?: string; company?: string }; invoice_id?: string };
type MoyasarInvoice = { id: string; status: string; amount: number; currency: string; url: string; payments?: MoyasarPayment[] };

function auth() {
  const key = env().MOYASAR_SECRET_KEY;
  if (!key) throw new AppError("payments_not_configured", "Online payment is not configured (MOYASAR_SECRET_KEY missing)", 503);
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: { Authorization: auth(), "Content-Type": "application/json", ...(init.headers ?? {}) }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AppError("gateway_error", `Moyasar ${r.status}: ${(j as { message?: string }).message ?? "error"}`, 502, j);
  return j as T;
}

function mapInvoiceStatus(s: string): CheckoutStatus {
  switch (s) {
    case "paid": return "paid";
    case "refunded": return "refunded";
    case "failed": return "failed";
    case "expired": case "canceled": case "voided": return "expired";
    default: return "pending";
  }
}

export const moyasar: PaymentProvider = {
  name: "moyasar",
  isConfigured: () => !!(env().MOYASAR_SECRET_KEY && env().MOYASAR_WEBHOOK_SECRET),
  mode: () => (!env().MOYASAR_SECRET_KEY ? "not_configured" : env().MOYASAR_SECRET_KEY!.startsWith("sk_live_") ? "live" : "test"),

  async createCheckout({ amount, description, callbackUrl, backUrl, expiresAt, metadata }) {
    const inv = await call<MoyasarInvoice>("/invoices", {
      method: "POST",
      body: JSON.stringify({ amount, currency: "SAR", description, callback_url: callbackUrl, success_url: callbackUrl, back_url: backUrl, expired_at: expiresAt.toISOString(), metadata }),
    });
    return { providerRef: inv.id, url: inv.url, raw: inv };
  },

  async fetchCheckout(providerRef): Promise<VerifiedPayment> {
    const inv = await call<MoyasarInvoice>(`/invoices/${encodeURIComponent(providerRef)}`);
    const paid = (inv.payments ?? []).find((p) => p.status === "paid" || p.status === "refunded" || p.status === "captured");
    return {
      providerRef: inv.id,
      status: mapInvoiceStatus(inv.status),
      paidAmount: paid?.amount ?? 0,
      currency: inv.currency,
      paymentId: paid?.id ?? null,
      sourceType: paid?.source?.company ?? paid?.source?.type ?? null,
      raw: inv,
    };
  },

  async refund(paymentId, amount) {
    try {
      const p = await call<MoyasarPayment>(`/payments/${encodeURIComponent(paymentId)}/refund`, { method: "POST", body: JSON.stringify({ amount }) });
      return { ok: true, ref: p.id, raw: p };
    } catch (e) {
      return { ok: false, error: (e as Error).message, raw: (e as AppError).details ?? null };
    }
  },

  parseWebhook(rawBody) {
    const secret = env().MOYASAR_WEBHOOK_SECRET;
    if (!secret) return null;
    let j: { id?: string; type?: string; secret_token?: string; data?: MoyasarPayment & { invoice_id?: string } };
    try { j = JSON.parse(rawBody); } catch { return null; }
    if (!j.secret_token || !safeEqual(j.secret_token, secret) || !j.id || !j.type) return null;
    return { eventId: j.id, type: j.type, invoiceId: j.data?.invoice_id ?? null, paymentId: j.data?.id ?? null, raw: j };
  },
};
