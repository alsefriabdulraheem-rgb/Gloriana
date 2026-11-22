import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDict, pick } from "@/lib/i18n";
import { destroySession, pageUser, requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { Badge, Empty, Flash } from "@/components/ui";
import { fd, runAction } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

async function saveProfile(formData: FormData) {
  "use server";
  await runAction("/account", async () => {
    const u = await requireUser();
    const f = fd(formData);
    const p = z.object({ name: z.string().max(80), email: z.string().email().max(200).or(z.literal("")), gender: z.enum(["female", "male", ""]) })
      .parse({ name: f.str("name"), email: f.str("email"), gender: f.str("gender") });
    await sql`update users set full_name = ${p.name || null}, email = ${p.email || null}, gender = ${p.gender || null}, updated_at = now() where id = ${u.id}`;
  });
}

async function savePrefs(formData: FormData) {
  "use server";
  await runAction("/account", async () => {
    const u = await requireUser();
    const f = fd(formData);
    await sql`insert into notification_preferences (user_id, sms, email, whatsapp, reminders, marketing, updated_at)
      values (${u.id}, ${f.bool("sms")}, ${f.bool("email")}, ${f.bool("whatsapp")}, ${f.bool("reminders")}, ${f.bool("marketing")}, now())
      on conflict (user_id) do update set sms = excluded.sms, email = excluded.email, whatsapp = excluded.whatsapp, reminders = excluded.reminders, marketing = excluded.marketing, updated_at = now()`;
    await sql`update users set marketing_opt_in = ${f.bool("marketing")} where id = ${u.id}`;
  });
}

async function markRead() {
  "use server";
  const u = await requireUser();
  await sql`update notifications set read_at = now() where user_id = ${u.id} and channel = 'in_app' and read_at is null`;
  redirect("/account#notifications");
}

/** PDPL right to erasure: anonymises personal data; financial records are retained (legal obligation) without identity. */
async function deleteAccount(formData: FormData) {
  "use server";
  await runAction("/account", async () => {
    const u = await requireUser();
    if (formData.get("confirm") !== "DELETE") throw new AppError("validation", "Type DELETE to confirm");
    const [active] = await sql`select 1 from bookings where customer_id = ${u.id} and status in ('pending_payment','pending_approval','confirmed') and starts_at > now()`;
    if (active) throw new AppError("has_active_bookings", "Cancel your upcoming bookings first");
    await sql`update users set phone = null, email = null, full_name = null, password_hash = null, status = 'deleted', updated_at = now() where id = ${u.id}`;
    await sql`delete from sessions where user_id = ${u.id}`;
    await audit(u.id, "user.deleted_self", "user", u.id);
    await destroySession();
    redirect("/");
  });
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const user = await pageUser("/account");
  const bookings = await sql<{ reference: string; status: string; payment_status: string; starts_at: Date; total_halalas: number; name_ar: string; name_en: string | null; slug: string }[]>`
    select b.reference, b.status, b.payment_status, b.starts_at, b.total_halalas, s.name_ar, s.name_en, s.slug from bookings b join salons s on s.id = b.salon_id
    where b.customer_id = ${user.id} order by b.starts_at desc limit 100`;
  const [prefs] = await sql<{ sms: boolean; email: boolean; whatsapp: boolean; reminders: boolean; marketing: boolean }[]>`select * from notification_preferences where user_id = ${user.id}`;
  const p = prefs ?? { sms: true, email: true, whatsapp: false, reminders: true, marketing: false };
  const notes = await sql<{ id: string; body: string; created_at: Date; read_at: Date | null }[]>`select id, body, created_at, read_at from notifications where user_id = ${user.id} and channel = 'in_app' order by created_at desc limit 20`;
  const now = new Date();
  const upcoming = bookings.filter((b) => b.starts_at >= now && ["pending_payment", "pending_approval", "confirmed"].includes(b.status));
  const past = bookings.filter((b) => !upcoming.includes(b));
  type Row = (typeof bookings)[number];
  const List = ({ rows }: { rows: Row[] }) => rows.length === 0 ? <Empty>{t.account.none}</Empty> : (
    <div className="space-y-2">
      {rows.map((b) => (
        <Link key={b.reference} href={`/bookings/${b.reference}`} className="card flex flex-wrap items-center gap-3 p-4 hover:border-plum-200">
          <div className="flex-1"><div className="font-medium">{pick(b, "name", locale)}</div><div className="text-xs text-muted">{formatDateTime(b.starts_at, locale)} · {b.reference}</div></div>
          <Badge status={b.status} label={t.status[b.status as keyof typeof t.status]} />
          <span className="font-semibold tabular-nums">{sar(b.total_halalas, locale)}</span>
        </Link>
      ))}
    </div>
  );
  return (
    <div className="container-x max-w-4xl py-10">
      <h1 className="mb-6 font-display text-3xl font-semibold">{t.account.title}</h1>
      <Flash sp={sp} t={t} />
      <section className="mb-10"><h2 className="mb-3 text-lg font-semibold">{t.account.upcoming}</h2><List rows={upcoming} /></section>
      <section className="mb-10"><h2 className="mb-3 text-lg font-semibold">{t.account.past}</h2><List rows={past} /></section>
      <section id="notifications" className="mb-10">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">{t.account.notifications}</h2>
          <form action={markRead}><button className="btn-ghost btn-sm">✓</button></form></div>
        {notes.length === 0 ? <Empty>{t.common.none}</Empty> : <ul className="card divide-y divide-line text-sm">{notes.map((n) => <li key={n.id} className={`p-3 ${n.read_at ? "text-muted" : ""}`}>{n.body}<div className="text-xs text-muted">{formatDateTime(n.created_at, locale)}</div></li>)}</ul>}
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <form action={saveProfile} className="card space-y-3 p-5">
          <h2 className="font-semibold">{t.account.profile}</h2>
          <div><label className="label">{t.common.phone}</label><input className="input bg-paper" dir="ltr" value={user.phone ?? ""} disabled /></div>
          <div><label className="label">{t.auth.name}</label><input name="name" className="input" defaultValue={user.full_name ?? ""} maxLength={80} /></div>
          <div><label className="label">{t.common.email}</label><input name="email" type="email" className="input" defaultValue={user.email ?? ""} /></div>
          <div><label className="label">{t.account.gender}</label><select name="gender" className="input" defaultValue={user.gender ?? ""}><option value="">—</option><option value="female">{t.account.female}</option><option value="male">{t.account.male}</option></select></div>
          <button className="btn-primary">{t.common.save}</button>
        </form>
        <form action={savePrefs} className="card space-y-3 p-5">
          <h2 className="font-semibold">{t.account.prefs}</h2>
          {(["sms", "email", "whatsapp", "reminders", "marketing"] as const).map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 text-sm"><span>{t.account[k]}</span><input type="checkbox" name={k} defaultChecked={p[k]} className="h-5 w-5 accent-plum-700" /></label>
          ))}
          <button className="btn-primary">{t.common.save}</button>
        </form>
      </div>
      <details className="mt-10 text-sm">
        <summary className="cursor-pointer text-red-700">{t.account.deleteAccount}</summary>
        <form action={deleteAccount} className="mt-3 flex gap-2"><input name="confirm" className="input max-w-xs" placeholder="DELETE" dir="ltr" /><button className="btn-danger">{t.common.delete}</button></form>
      </details>
    </div>
  );
}
