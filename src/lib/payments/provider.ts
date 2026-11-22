export type CheckoutStatus = "pending" | "paid" | "failed" | "expired" | "refunded";

export type CheckoutResult = { providerRef: string; url: string; raw: unknown };
export type VerifiedPayment = {
  providerRef: string;            // invoice id
  status: CheckoutStatus;
  paidAmount: number;             // halalas actually captured
  currency: string;
  paymentId: string | null;       // underlying payment id (used for refunds)
  sourceType: string | null;      // mada / creditcard / applepay / stcpay
  raw: unknown;
};
export type WebhookEvent = { eventId: string; type: string; invoiceId: string | null; paymentId: string | null; raw: unknown };

export interface PaymentProvider {
  name: string;
  isConfigured(): boolean;
  mode(): "live" | "test" | "not_configured";
  createCheckout(input: { amount: number; description: string; callbackUrl: string; backUrl: string; expiresAt: Date; metadata: Record<string, string> }): Promise<CheckoutResult>;
  /** Server-to-server lookup — the ONLY source of truth for marking a payment successful. */
  fetchCheckout(providerRef: string): Promise<VerifiedPayment>;
  refund(paymentId: string, amount: number): Promise<{ ok: boolean; ref?: string; error?: string; raw: unknown }>;
  /** Authenticates a webhook delivery. Returns null if the signature/secret is invalid. */
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
}
