import { moyasar } from "./moyasar";
import type { PaymentProvider } from "./provider";

let provider: PaymentProvider = moyasar;

export function paymentProvider(): PaymentProvider {
  return provider;
}

/** Test-only hook to inject a gateway double. Refuses to run in production. */
export function __setPaymentProviderForTests(p: PaymentProvider) {
  if (process.env.NODE_ENV === "production") throw new Error("not allowed in production");
  provider = p;
}
