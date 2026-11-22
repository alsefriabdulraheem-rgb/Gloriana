import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getDict, pick } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/dict";
import { pageUser, requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { sar } from "@/lib/money";
import { formatDateTime, formatTime, todayLocal } from "@/lib/time";
import { Badge, Flash } from "@/components/ui";
import { cancelBooking, cancellationQuote } from "@/lib/booking/service";
import { startCheckout } from "@/lib/payments/service";
import { runAction } from "@/lib/actions";
import { AppError, forbidden } from "@/lib/errors";
import { recomputeRatings } from "@/lib/catalog";
import { humanCode } from "@/lib/crypto";
import { RescheduleForm } from "@/components/reschedule-form";

export const metadata: Metadata = { title: "Booking", robots: { index: false } };
type P = { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | undefined>> };

async function loadOwned(ref: string, userId: string) {
  const [b] = await sql<{ id: string; customer_id: string; reference: string }[]>`select id, customer_id, reference from bookings where reference = ${ref}`;
  if (!b) throw new AppError("not_found", "Booking not found", 404);
  if (b.customer_id !== userId) throw forbidden();
  return b;
}

async function payAction(formData: FormData) {
  "use server";
  const ref = String(formData.get("ref"));
  await runAction(`/bookings/${ref}`, async () => {
    const u = await requireUser();
    const b = await loadOwned(ref, u.id);
    redirect((await startCheckout(b.id, u.id)).url); // hosted checkout (external)
  });
}

async function cancelAction(formData: FormData) {
  "use server";
  const ref = String(formData.get("ref"));
  await runAction(`/bookings/${ref}`, async () => {
    const u = await requireUser();
    const b = await loadOwned(ref, u.id);
    await cancelBooking(b.id, { kind: "customer", userId: u.id }, String(formData.get("reason") || "").slice(0, 500));
  });
}

async function reviewAction(formData: FormData) {
  "use server";
  const ref = String(formData.get("ref"));
  await runAction(`/bookings/${ref}`, async () => {
    const u = await requireUser();
    const b = await loadOwned(ref, u.id);
    const { rating, comment } = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().max(2000) }).parse({ rating: formData.get("rating"), comment: formData.get("comment") ?? "" });
    const [bk] = await sql<{ status: string; salon_id: string; employee_id: string }[]>`select status, salon_id, employee_id from bookings where id = ${b.id}`;
    if (bk.status !== "completed") throw new AppError("invalid_state", "Only completed bookings can be reviewed");
    await sql`insert into reviews (booking_id, salon_id, employee_id, customer_id, rating, comment) values (${b.id}, ${bk.salon_id}, ${bk.employee_id}, ${u.id}, ${rating}, ${comment || null})`;
    await recomputeRatings(bk.salon_id, bk.employee_id);
  });
}

async function complaintAction(formData: FormData) {
  "use server";
  const ref = String(formData.get("ref"));
  await runAction(`/bookings/${ref}`, async () => {
    const u = await requireUser();
    const b = await loadOwned(ref, u.id);
    const subject = String(formData.get("subject") || "").trim().slice(0, 200), body = String(formData.get("body") || "").trim().slice(0, 4000);
    if (subject.length < 3 || body.length < 10) throw new AppError("validation", "Please describe the issue");
    const [bk] = await sql<{ salon_id: string }[]>`select salon_id from bookings where id = ${b.id}`;
    await sql`insert into complaints (reference, customer_id, salon_id, booking_id, subject, body) values (${"CP-" + humanCode(6)}, ${u.id}, ${bk.salon_id}, ${b.id}, ${subject}, ${body})`;
    return "✓";
  });
}

export default async function BookingPage({ params, searchParams }: P) {
  const { ref } = await params;
  const sp = await searchParams;
  const { t, locale } = await getDict();
  const user = await pageUser(`/bookings/${ref}`);
  const [b] = await sql<{
    id: string; reference: string; customer_id: string; status: string; payment_status: string; payment_method: string; starts_at: Date; ends_at: Date;
    subtotal_halalas: number; discount_halalas: number; total_halalas: number; amount_due_online_halalas: number; amount_paid_halalas: number; amount_refunded_halalas: number;
    hold_expires_at: Date | null; salon_id: string; branch_id: string; employee_id: string; slug: string; name_ar: string; name_en: string | null; emp_ar: string; emp_en: string | null;
    free_cancel_hours: number; late_cancel_fee_percent: number; max_reschedules: number; reschedule_count: number; branch_ar: string; branch_en: string | null; address_ar: string | null; address_en: string | null; cancel_reason: string | null;
  }[]>`select b.*, s.slug, s.name_ar, s.name_en, s.free_cancel_hours, s.late_cancel_fee_percent, s.max_reschedules, e.display_name_ar as emp_ar, e.display_name_en as emp_en,
      br.name_ar as branch_ar, br.name_en as branch_en, br.address_ar, br.address_en
    from bookings b join salons s on s.id = b.salon_id join employees e on e.id = b.employee_id join salon_branches br on br.id = b.branch_id where b.reference = ${ref}`;
  if (!b) notFound();
  const isMember = (await sql`select 1 from salon_members where salon_id = ${b.salon_id} and user_id = ${user.id}`).length > 0;
  if (b.customer_id !== user.id && user.role !== "admin" && !isMember) notFound();
  const isOwner = b.customer_id === user.id;
  const items = await sql<{ service_id: string; service_name_ar: string; service_name_en: string | null; duration_min: number; price_halalas: number; starts_at: Date }[]>`select * from booking_items where booking_id = ${b.id} order by sort`;
  const [review] = await sql`select rating from reviews where booking_id = ${b.id}`;
  const active = ["pending_payment", "pending_approval", "confirmed"].includes(b.status);
  const q = cancellationQuote(b, b, "customer");
  const canReschedule = isOwner && ["pending_approval", "confirmed"].includes(b.status) && b.reschedule_count < b.max_reschedules && q.hoursBefore >= b.free_cancel_hours;
  const title = b.status === "confirmed" ? t.booking.confirmedTitle : b.status === "pending_approval" ? t.booking.pendingApprovalTitle : b.status === "pending_payment" ? t.booking.pendingPaymentTitle : t.booking.details;

  return (
    <div className="container-x max-w-3xl py-10">
      <Flash sp={sp} t={t} />
      {sp.payment === "pending" && <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{t.booking.paymentProcessing}</div>}
      <div className="card overflow-hidden">
        <div className={`p-6 text-white ${b.status === "confirmed" || b.status === "completed" ? "bg-gradient-to-br from-plum-700 to-plum-900" : "bg-zinc-700"}`}>
          <p className="text-sm text-white/70">{t.booking.ref}</p>
          <p className="font-mono text-2xl font-bold tracking-wider">{b.reference}</p>
          <h1 className="mt-2 text-xl font-semibold">{title}</h1>
        </div>
        <div className="space-y-5 p-6">
          <div className="flex flex-wrap gap-2"><Badge status={b.status} label={t.status[b.status as keyof typeof t.status]} /><Badge status={b.payment_status} label={t.pay[b.payment_status as keyof typeof t.pay]} /></div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">{t.salon.about}</dt><dd className="font-medium"><Link className="hover:underline" href={`/salons/${b.slug}`}>{pick(b, "name", locale)}</Link></dd></div>
            <div><dt className="text-muted">{t.book.branch}</dt><dd>{locale === "en" ? b.branch_en || b.branch_ar : b.branch_ar} — {locale === "en" ? b.address_en || b.address_ar : b.address_ar}</dd></div>
            <div><dt className="text-muted">{t.book.date}</dt><dd className="font-medium">{formatDateTime(b.starts_at, locale)} – {formatTime(b.ends_at, locale)}</dd></div>
            <div><dt className="text-muted">{t.book.employee}</dt><dd>{locale === "en" ? b.emp_en || b.emp_ar : b.emp_ar}</dd></div>
          </dl>
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {items.map((i, k) => <li key={k} className="flex justify-between p-3"><span>{locale === "en" ? i.service_name_en || i.service_name_ar : i.service_name_ar} <span className="text-muted">· {i.duration_min} {t.salon.min}</span></span><span className="tabular-nums">{sar(i.price_halalas, locale)}</span></li>)}
          </ul>
          <dl className="space-y-1 text-sm">
            {b.discount_halalas > 0 && <div className="flex justify-between text-emerald-700"><dt>{t.book.discount}</dt><dd>-{sar(b.discount_halalas, locale)}</dd></div>}
            <div className="flex justify-between text-base font-semibold"><dt>{t.book.total}</dt><dd>{sar(b.total_halalas, locale)}</dd></div>
            {b.amount_paid_halalas > 0 && <div className="flex justify-between text-muted"><dt>{t.pay.paid}</dt><dd>{sar(b.amount_paid_halalas, locale)}</dd></div>}
            {b.amount_refunded_halalas > 0 && <div className="flex justify-between text-muted"><dt>{t.pay.refunded}</dt><dd>{sar(b.amount_refunded_halalas, locale)}</dd></div>}
          </dl>

          {isOwner && b.status === "pending_payment" && b.hold_expires_at && b.hold_expires_at > new Date() && (
            <form action={payAction} className="rounded-xl bg-amber-50 p-4">
              <input type="hidden" name="ref" value={b.reference} />
              <p className="mb-3 text-sm">{t.booking.holdUntil} {formatTime(b.hold_expires_at, locale)} — {t.book.payNow}: <b>{sar(b.amount_due_online_halalas, locale)}</b></p>
              <button className="btn-primary">{t.booking.pay}</button>
            </form>
          )}

          {isOwner && canReschedule && (
            <details className="rounded-xl border border-line p-4">
              <summary className="cursor-pointer font-semibold">{t.booking.reschedule}</summary>
              <div className="mt-3"><RescheduleForm t={t} bookingId={b.id} salonId={b.salon_id} branchId={b.branch_id} serviceIds={items.map((i) => i.service_id)} employeeId={b.employee_id} today={todayLocal()} /></div>
            </details>
          )}

          {isOwner && active && b.starts_at > new Date() && (
            <details className="rounded-xl border border-line p-4">
              <summary className="cursor-pointer font-semibold text-red-700">{t.booking.cancel}</summary>
              <form action={cancelAction} className="mt-3 space-y-3">
                <input type="hidden" name="ref" value={b.reference} />
                {b.amount_paid_halalas > 0 && <p className="text-sm">{fmt(t.booking.refundInfo, { r: sar(q.refund, locale), f: sar(q.fee, locale) })}</p>}
                <textarea name="reason" className="input" rows={2} placeholder={t.common.reason} />
                <button className="btn-danger">{t.booking.cancelConfirm}</button>
              </form>
            </details>
          )}

          {isOwner && b.status === "completed" && (review ? <p className="text-sm text-emerald-700">✓ {t.booking.reviewThanks}</p> : (
            <form action={reviewAction} className="space-y-3 rounded-xl border border-line p-4">
              <input type="hidden" name="ref" value={b.reference} />
              <h2 className="font-semibold">{t.booking.review}</h2>
              <div className="flex flex-row-reverse justify-end gap-1 text-2xl">
                {[5, 4, 3, 2, 1].map((n) => (
                  <label key={n} className="cursor-pointer"><input type="radio" name="rating" value={n} required className="peer sr-only" /><span className="text-line peer-checked:text-gold-500">★</span>{n}</label>
                ))}
              </div>
              <textarea name="comment" className="input" rows={3} maxLength={2000} />
              <button className="btn-primary">{t.common.submit}</button>
            </form>
          ))}

          {isOwner && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">{t.booking.complaint}</summary>
              <form action={complaintAction} className="mt-3 space-y-2">
                <input type="hidden" name="ref" value={b.reference} />
                <input name="subject" className="input" placeholder={t.common.reason} required minLength={3} />
                <textarea name="body" className="input" rows={3} required minLength={10} />
                <button className="btn-outline">{t.common.submit}</button>
              </form>
            </details>
          )}
        </div>
      </div>
      <div className="mt-6 text-center"><Link href="/account" className="btn-ghost">{t.nav.bookings}</Link></div>
    </div>
  );
}
