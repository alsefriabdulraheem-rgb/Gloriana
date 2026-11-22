import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  CRON_SECRET: z.string().min(16).optional(),

  // Payments — Moyasar (https://moyasar.com) supports mada, Visa, Mastercard, Apple Pay, STC Pay.
  MOYASAR_SECRET_KEY: z.string().optional(),
  MOYASAR_PUBLISHABLE_KEY: z.string().optional(),
  MOYASAR_WEBHOOK_SECRET: z.string().optional(),

  // SMS — Unifonic or Taqnyat (Saudi CITC-registered sender IDs)
  SMS_PROVIDER: z.enum(["unifonic", "taqnyat", "console", "none"]).default("none"),
  UNIFONIC_APP_SID: z.string().optional(),
  TAQNYAT_BEARER_TOKEN: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),

  // Email — Resend API
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // WhatsApp Business Cloud API (Meta) — requires approved templates
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // Storage — Supabase Storage (falls back to local /public/uploads in development)
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("tremly-media"),

  // Analytics
  NEXT_PUBLIC_GA_ID: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Invalid environment: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.SMS_PROVIDER === "console") {
    throw new Error("SMS_PROVIDER=console is not allowed in production");
  }
  cached = parsed.data;
  return cached;
}

export function integrationStatus() {
  const e = env();
  return {
    payments: !!(e.MOYASAR_SECRET_KEY && e.MOYASAR_WEBHOOK_SECRET),
    paymentsMode: e.MOYASAR_SECRET_KEY?.startsWith("sk_live_") ? "live" : e.MOYASAR_SECRET_KEY ? "test" : "not_configured",
    sms:
      (e.SMS_PROVIDER === "unifonic" && !!e.UNIFONIC_APP_SID) ||
      (e.SMS_PROVIDER === "taqnyat" && !!e.TAQNYAT_BEARER_TOKEN) ||
      e.SMS_PROVIDER === "console",
    smsProvider: e.SMS_PROVIDER,
    email: !!(e.RESEND_API_KEY && e.EMAIL_FROM),
    whatsapp: !!(e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID),
    storage: e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local",
  } as const;
}
