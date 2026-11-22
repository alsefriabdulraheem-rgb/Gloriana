"use server";

import { z } from "zod";
import { sql } from "@/lib/db";
import { fd, runAction } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { notifySalon } from "@/lib/notifications";
import { refundBooking, reconcilePayment } from "@/lib/payments/service";
import { cancelBooking } from "@/lib/booking/service";
import { createSettlement, markSettlementPaid } from "@/lib/finance/ledger";
import { recomputeRatings } from "@/lib/catalog";
import { localToUtc } from "@/lib/time";

const back = (f: FormData, def: string) => {
  const b = String(f.get("back") || def);
  return b.startsWith("/admin") ? b : def;
};

export async function setSalonStatus(formData: FormData) {
  await runAction(back(formData, "/admin/salons"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const id = f.str("id");
    const status = z.enum(["approved", "rejected", "suspended", "deactivated", "pending_review"]).parse(f.str("status"));
    const reason = f.opt("reason");
    if (["rejected", "suspended", "deactivated"].includes(status) && !reason) throw new AppError("validation", "A reason is required");
    const [s] = await sql<{ name_ar: string }[]>`update salons set status = ${status}, status_reason = ${reason},
      approved_at = case when ${status} = 'approved' and approved_at is null then now() else approved_at end, updated_at = now() where id = ${id} returning name_ar`;
    if (!s) throw new AppError("not_found", "Salon not found", 404);
    await audit(admin.id, `salon.${status}`, "salon", id, { reason });
    await notifySalon(id, "salon_status_changed", { salon: s.name_ar, status, reason: reason ?? "" });
  });
}

export async function setFeatured(formData: FormData) {
  await runAction(back(formData, "/admin/salons"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    await sql`update salons set is_featured = ${f.bool("is_featured")}, featured_rank = ${f.str("rank") ? f.int("rank") : null} where id = ${f.str("id")}`;
    await audit(admin.id, "salon.featured", "salon", f.str("id"), { featured: f.bool("is_featured") });
  });
}

export async function saveCommissionRule(formData: FormData) {
  await runAction(back(formData, "/admin/commissions"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const scope = z.enum(["default", "category", "salon"]).parse(f.str("scope"));
    const online = Number(f.str("online_percent")), cash = Number(f.str("cash_percent"));
    if (!(online >= 0 && online <= 100 && cash >= 0 && cash <= 100)) throw new AppError("validation", "Percentages must be 0–100");
    const salonId = scope === "salon" ? f.str("salon_id") : null, category = scope === "category" ? f.str("category") : null;
    if (scope === "salon" && !salonId) throw new AppError("validation", "Choose a salon");
    if (scope === "category" && !category) throw new AppError("validation", "Choose a category");
    const effective = f.str("effective_from") ? localToUtc(f.str("effective_from"), "00:00") : new Date();
    // Rules are versioned (never edited) so historical commissions stay auditable.
    await sql`insert into commission_rules (scope, salon_id, category, online_percent, cash_percent, effective_from, created_by) values (${scope}, ${salonId}, ${category}, ${online}, ${cash}, ${effective}, ${admin.id})`;
    await audit(admin.id, "commission.rule_added", "commission_rule", null, { scope, salonId, category, online, cash, effective });
  });
}

export async function setUserStatus(formData: FormData) {
  await runAction(back(formData, "/admin/users"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const id = f.str("id");
    if (id === admin.id) throw new AppError("validation", "You cannot change your own account here");
    const status = z.enum(["active", "suspended"]).parse(f.str("status"));
    await sql`update users set status = ${status}, updated_at = now() where id = ${id}`;
    if (status === "suspended") await sql`delete from sessions where user_id = ${id}`;
    await audit(admin.id, `user.${status}`, "user", id);
  });
}

export async function setUserRole(formData: FormData) {
  await runAction(back(formData, "/admin/users"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const id = f.str("id");
    if (id === admin.id) throw new AppError("validation", "You cannot change your own role");
    const role = z.enum(["customer", "salon_owner", "salon_staff", "admin"]).parse(f.str("role"));
    await sql`update users set role = ${role}, updated_at = now() where id = ${id}`;
    await sql`delete from sessions where user_id = ${id}`;
    await audit(admin.id, "user.role_changed", "user", id, { role });
  });
}

export async function adminRefund(formData: FormData) {
  await runAction(back(formData, "/admin/payments"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const amount = f.sar("amount");
    const reason = f.str("reason");
    if (!reason) throw new AppError("validation", "Reason required");
    const r = await refundBooking(f.str("booking_id"), amount, `Admin: ${reason}`, admin.id);
    await audit(admin.id, "refund.issued", "booking", f.str("booking_id"), { amount, reason, result: r });
    if (r.refunded < amount) throw new AppError("refund_partial", `Refunded ${r.refunded / 100} SAR of ${amount / 100} SAR — see payment log`);
  });
}

export async function adminReconcile(formData: FormData) {
  await runAction(back(formData, "/admin/payments"), async () => {
    await requireAdmin();
    const r = await reconcilePayment(String(formData.get("payment_id")));
    return `status: ${r.status}`;
  });
}

export async function adminCancelBooking(formData: FormData) {
  await runAction(back(formData, "/admin/bookings"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    await cancelBooking(f.str("booking_id"), { kind: "admin", userId: admin.id }, f.opt("reason") ?? "Cancelled by TREMLY");
    await audit(admin.id, "booking.admin_cancel", "booking", f.str("booking_id"), { reason: f.opt("reason") });
  });
}

export async function generateSettlement(formData: FormData) {
  await runAction(back(formData, "/admin/settlements"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const s = await createSettlement(f.str("salon_id"), f.str("period_start"), f.str("period_end"), admin.id);
    await audit(admin.id, "settlement.created", "settlement", s.id);
    return s.reference;
  });
}

export async function generateAllSettlements(formData: FormData) {
  await runAction(back(formData, "/admin/settlements"), async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const salons = await sql<{ salon_id: string }[]>`select distinct salon_id from ledger_entries where settlement_id is null`;
    let n = 0;
    for (const s of salons) {
      try { await createSettlement(s.salon_id, f.str("period_start"), f.str("period_end"), admin.id); n++; } catch (e) { if ((e as AppError).code !== "nothing_to_settle") throw e; }
    }
    await audit(admin.id, "settlement.bulk_created", "settlement", null, { n });
    return `${n} settlements created`;
  });
}

export async function issueSettlement(formData: FormData) {
  await runAction(back(formData, "/admin/settlements"), async () => {
    const admin = await requireAdmin();
    await sql`update settlements set status = 'issued' where id = ${String(formData.get("id"))} and status = 'draft'`;
    await audit(admin.id, "settlement.issued", "settlement", String(formData.get("id")));
  });
}

export async function paySettlement(formData: FormData) {
  await runAction(back(formData, "/admin/settlements"), async () => {
    const admin = await requireAdmin();
    const ref = String(formData.get("payment_reference") || "").trim();
    if (!ref) throw new AppError("validation", "Bank transfer reference required");
    await markSettlementPaid(String(formData.get("id")), ref, admin.id);
    await audit(admin.id, "settlement.paid", "settlement", String(formData.get("id")), { ref });
  });
}

export async function savePlatformPromotion(formData: FormData) {
  await runAction("/admin/promotions", async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const type = f.str("discount_type") === "fixed" ? "fixed" : "percent";
    const value = type === "fixed" ? f.sar("discount_value") : f.int("discount_value");
    const code = f.str("code").toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new AppError("validation", "Code must be 3–20 letters/digits");
    if (value <= 0 || (type === "percent" && value > 100)) throw new AppError("validation", "Invalid value");
    await sql`insert into promotions (salon_id, code, title_ar, title_en, discount_type, discount_value, min_subtotal_halalas, max_discount_halalas, starts_at, ends_at, max_redemptions, per_customer_limit, is_public)
      values (null, ${code}, ${f.str("title_ar")}, ${f.opt("title_en")}, ${type}, ${value}, ${f.str("min") ? f.sar("min") : 0}, ${f.str("max_discount") ? f.sar("max_discount") : null},
        ${f.str("starts") ? localToUtc(f.str("starts"), "00:00") : new Date()}, ${f.str("ends") ? localToUtc(f.str("ends"), "23:59") : null}, ${f.str("max_redemptions") ? f.int("max_redemptions") : null}, ${f.int("per_customer", 1)}, true)`;
    await audit(admin.id, "promotion.platform_created", "promotion", null, { code });
  });
}

export async function togglePromotionAdmin(formData: FormData) {
  await runAction("/admin/promotions", async () => {
    const admin = await requireAdmin();
    await sql`update promotions set is_active = not is_active where id = ${String(formData.get("id"))}`;
    await audit(admin.id, "promotion.toggled", "promotion", String(formData.get("id")));
  });
}

export async function updateComplaint(formData: FormData) {
  await runAction("/admin/complaints", async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const status = z.enum(["open", "in_progress", "resolved", "rejected"]).parse(f.str("status"));
    await sql`update complaints set status = ${status}, resolution = ${f.opt("resolution")}, assigned_to = ${admin.id}, updated_at = now() where id = ${f.str("id")}`;
    await audit(admin.id, "complaint.updated", "complaint", f.str("id"), { status });
  });
}

export async function moderateReview(formData: FormData) {
  await runAction("/admin/reviews", async () => {
    const admin = await requireAdmin();
    const f = fd(formData);
    const status = z.enum(["published", "hidden"]).parse(f.str("status"));
    const [r] = await sql<{ salon_id: string; employee_id: string | null }[]>`update reviews set status = ${status} where id = ${f.str("id")} returning salon_id, employee_id`;
    await sql`update review_reports set resolved_at = now() where review_id = ${f.str("id")} and resolved_at is null`;
    if (r) await recomputeRatings(r.salon_id, r.employee_id);
    await audit(admin.id, `review.${status}`, "review", f.str("id"));
  });
}
