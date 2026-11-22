import { sql, type Db } from "../db";
import { render, WHATSAPP_PARAMS, type TemplateData, type TemplateName } from "./templates";
import { sendEmail, sendSms, sendWhatsApp, type SendResult } from "./providers";

/**
 * Queue notifications for a user across every channel they opted into. Delivery happens in
 * `dispatchQueued()` (called inline after commits and by the cron worker), so a provider outage
 * never rolls back a booking transaction.
 */
export async function notifyUser(
  userId: string, template: TemplateName, data: TemplateData,
  opts: { db?: Db; sendAfter?: Date; inApp?: boolean; isReminder?: boolean } = {},
) {
  const db = opts.db ?? sql;
  const [u] = await db<{ phone: string | null; email: string | null; locale: "ar" | "en"; sms: boolean | null; email_on: boolean | null; whatsapp: boolean | null; reminders: boolean | null }[]>`
    select u.phone, u.email::text as email, u.locale, p.sms, p.email as email_on, p.whatsapp, p.reminders
    from users u left join notification_preferences p on p.user_id = u.id where u.id = ${userId}`;
  if (!u) return;
  if (opts.isReminder && u.reminders === false) return;
  const { body, subject } = render(template, u.locale, data);
  const after = opts.sendAfter ?? new Date();
  const rows: { channel: string; recipient: string; payload: object }[] = [];
  if (u.phone && u.sms !== false) rows.push({ channel: "sms", recipient: u.phone, payload: { data } });
  if (u.email && u.email_on !== false) rows.push({ channel: "email", recipient: u.email, payload: { data, subject } });
  if (u.phone && u.whatsapp === true && WHATSAPP_PARAMS[template]) rows.push({ channel: "whatsapp", recipient: u.phone, payload: { data, lang: u.locale } });
  if (opts.inApp !== false) rows.push({ channel: "in_app", recipient: userId, payload: { data, subject } });
  for (const r of rows) {
    await db`insert into notifications (user_id, channel, recipient, template, payload, body, send_after, status)
      values (${userId}, ${r.channel}, ${r.recipient}, ${template}, ${db.json(r.payload as never)}, ${body}, ${after},
              ${r.channel === "in_app" ? "sent" : "queued"})`;
  }
}

/** Notify all owners/managers of a salon (new booking alerts etc). */
export async function notifySalon(salonId: string, template: TemplateName, data: TemplateData, db: Db = sql) {
  const members = await db<{ user_id: string }[]>`select user_id from salon_members where salon_id = ${salonId} and role in ('owner','manager','receptionist')`;
  for (const m of members) await notifyUser(m.user_id, template, data, { db });
}

export async function dispatchQueued(limit = 50) {
  const batch = await sql<{ id: string; channel: string; recipient: string; template: TemplateName; body: string; payload: { data: TemplateData; subject?: string; lang?: "ar" | "en" } }[]>`
    update notifications set attempts = attempts + 1
    where id in (select id from notifications where status = 'queued' and send_after <= now() and attempts < 5
                 order by send_after limit ${limit} for update skip locked)
    returning id, channel, recipient, template, body, payload`;
  let sent = 0;
  for (const n of batch) {
    let res: SendResult;
    if (n.channel === "sms") res = await sendSms(n.recipient, n.body);
    else if (n.channel === "email") res = await sendEmail(n.recipient, n.payload.subject ?? "TREMLY", n.body);
    else if (n.channel === "whatsapp") {
      const keys = WHATSAPP_PARAMS[n.template] ?? [];
      res = await sendWhatsApp(n.recipient, n.template, n.payload.lang ?? "ar", keys.map((k) => String(n.payload.data?.[k] ?? "")));
    } else res = { ok: true };
    if (res.ok) {
      sent++;
      await sql`update notifications set status = 'sent', sent_at = now(), provider_ref = ${res.ref ?? null}, error = null where id = ${n.id}`;
    } else {
      await sql`update notifications set status = ${res.skipped ? "skipped" : "queued"}, error = ${res.error},
        send_after = now() + interval '2 minutes' where id = ${n.id}`;
      if (!res.skipped) await sql`update notifications set status = 'failed' where id = ${n.id} and attempts >= 5`;
    }
  }
  return { processed: batch.length, sent };
}
