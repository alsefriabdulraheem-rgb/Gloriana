import { env } from "../env";

export type SendResult = { ok: true; ref?: string } | { ok: false; error: string; skipped?: boolean };

/**
 * SMS providers. Saudi regulations (CST/CITC) require a pre-registered sender ID.
 * - Unifonic:  https://docs.unifonic.com  (AppSid)
 * - Taqnyat:   https://dev.taqnyat.sa     (Bearer token)
 * - console:   development only — prints the message to the server log. Rejected in production.
 */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const e = env();
  try {
    switch (e.SMS_PROVIDER) {
      case "unifonic": {
        if (!e.UNIFONIC_APP_SID) return { ok: false, skipped: true, error: "UNIFONIC_APP_SID missing" };
        const r = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ AppSid: e.UNIFONIC_APP_SID, SenderID: e.SMS_SENDER_ID ?? "TREMLY", Body: body, Recipient: to.replace("+", "") }),
        });
        const j = (await r.json().catch(() => ({}))) as { success?: boolean | string; data?: { MessageID?: string }; message?: string };
        return r.ok && String(j.success) === "true" ? { ok: true, ref: j.data?.MessageID } : { ok: false, error: j.message ?? `HTTP ${r.status}` };
      }
      case "taqnyat": {
        if (!e.TAQNYAT_BEARER_TOKEN) return { ok: false, skipped: true, error: "TAQNYAT_BEARER_TOKEN missing" };
        const r = await fetch("https://api.taqnyat.sa/v1/messages", {
          method: "POST",
          headers: { Authorization: `Bearer ${e.TAQNYAT_BEARER_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: [to.replace("+", "")], body, sender: e.SMS_SENDER_ID ?? "TREMLY" }),
        });
        const j = (await r.json().catch(() => ({}))) as { messageId?: string | number; message?: string };
        return r.ok ? { ok: true, ref: String(j.messageId ?? "") } : { ok: false, error: j.message ?? `HTTP ${r.status}` };
      }
      case "console":
        if (e.NODE_ENV === "production" && process.env.ALLOW_CONSOLE_SMS_IN_PRODUCTION_BUILD !== "1") return { ok: false, error: "console SMS provider disabled in production" };
        console.info(`[sms:console] to=${to} body=${body}`);
        return { ok: true, ref: "console" };
      default:
        return { ok: false, skipped: true, error: "SMS provider not configured" };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Email via Resend (https://resend.com/docs/api-reference/emails/send-email). */
export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const e = env();
  if (!e.RESEND_API_KEY || !e.EMAIL_FROM) return { ok: false, skipped: true, error: "Email provider not configured" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: e.EMAIL_FROM, to: [to], subject, text }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    return r.ok ? { ok: true, ref: j.id } : { ok: false, error: j.message ?? `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * WhatsApp Business Cloud API. Business-initiated messages MUST use a Meta-approved template;
 * templates are named `tremly_<template>` with body parameters in the order given by `params`.
 */
export async function sendWhatsApp(to: string, template: string, lang: "ar" | "en", params: string[]): Promise<SendResult> {
  const e = env();
  if (!e.WHATSAPP_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID) return { ok: false, skipped: true, error: "WhatsApp not configured" };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: to.replace("+", ""), type: "template",
        template: { name: `tremly_${template}`, language: { code: lang }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] },
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
    return r.ok ? { ok: true, ref: j.messages?.[0]?.id } : { ok: false, error: j.error?.message ?? `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
