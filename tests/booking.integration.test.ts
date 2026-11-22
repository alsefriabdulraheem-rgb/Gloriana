import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { resetDb, makeSalon, makeUser, tomorrow } from "./helpers";
import { sql } from "@/lib/db";
import { cancelBooking, completeBooking, createBooking, getAvailability, rescheduleBooking, releaseExpiredHolds, decideBooking } from "@/lib/booking/service";
import { __setPaymentProviderForTests } from "@/lib/payments";
import type { PaymentProvider, VerifiedPayment } from "@/lib/payments/provider";
import { handleWebhook, reconcilePayment, startCheckout } from "@/lib/payments/service";
import { createSettlement, markSettlementPaid, salonBalances } from "@/lib/finance/ledger";

// ---- Gateway double: behaves like the hosted checkout, but state is controlled by the test.
const gw = new Map<string, { amount: number; status: VerifiedPayment["status"]; paidAmount: number }>();
const refunds: { id: string; amount: number }[] = [];
let seq = 0;
const fake: PaymentProvider = {
  name: "moyasar", isConfigured: () => true, mode: () => "test",
  async createCheckout({ amount }) { const id = `inv_${++seq}`; gw.set(id, { amount, status: "pending", paidAmount: 0 }); return { providerRef: id, url: `https://checkout.test/${id}`, raw: {} }; },
  async fetchCheckout(ref) { const g = gw.get(ref)!; return { providerRef: ref, status: g.status, paidAmount: g.paidAmount, currency: "SAR", paymentId: g.status === "paid" ? `pay_${ref}` : null, sourceType: "mada", raw: {} }; },
  async refund(id, amount) { refunds.push({ id, amount }); return { ok: true, ref: `rf_${refunds.length}`, raw: {} }; },
  parseWebhook(body) { const j = JSON.parse(body); return j.secret_token === "whsec_test" ? { eventId: j.id, type: j.type, invoiceId: j.data.invoice_id, paymentId: j.data.id, raw: j } : null; },
};
const pay = (ref: string, amount?: number) => { const g = gw.get(ref)!; g.status = "paid"; g.paidAmount = amount ?? g.amount; };

beforeAll(async () => { await resetDb(); __setPaymentProviderForTests(fake); });
afterAll(async () => { await sql.end(); });
beforeEach(() => { refunds.length = 0; });

const base = (s: Awaited<ReturnType<typeof makeSalon>>, customerId: string, over: Partial<Parameters<typeof createBooking>[0]> = {}) => ({
  customerId, salonId: s.salonId, branchId: s.branchId, serviceIds: [s.services.cut], employeeId: s.employees[0],
  date: tomorrow(), time: "10:00", paymentMethod: "cash" as const, onlinePaymentsAvailable: true, ...over,
});

describe("availability", () => {
  it("lists slots and removes booked ones", async () => {
    const s = await makeSalon({ interval: 30 });
    const c = await makeUser();
    const before = await getAvailability({ salonId: s.salonId, branchId: s.branchId, serviceIds: [s.services.cut], employeeId: s.employees[0], date: tomorrow() });
    expect(before.slots.map((x) => x.time)).toContain("10:00");
    expect(before.slots.map((x) => x.time)).not.toContain("12:30"); // 12:30-13:30 overlaps the 13:00 break
    await createBooking(base(s, c));
    const after = await getAvailability({ salonId: s.salonId, branchId: s.branchId, serviceIds: [s.services.cut], employeeId: s.employees[0], date: tomorrow() });
    expect(after.slots.map((x) => x.time)).not.toContain("10:00");
    expect(after.slots.map((x) => x.time)).not.toContain("09:30");
    expect(after.slots.map((x) => x.time)).toContain("11:00");
  });

  it("multi-service bookings sum duration and chain items", async () => {
    const s = await makeSalon();
    const b = await createBooking(base(s, await makeUser(), { serviceIds: [s.services.cut, s.services.color] }));
    expect((b.ends_at.getTime() - b.starts_at.getTime()) / 60000).toBe(90);
    expect(b.total_halalas).toBe(15000);
    const items = await sql`select starts_at, ends_at from booking_items where booking_id = ${b.id} order by sort`;
    expect(items[1].starts_at.getTime()).toBe(items[0].ends_at.getTime());
  });
});

describe("double-booking prevention", () => {
  it("only one of many concurrent requests for the same employee/time succeeds", async () => {
    const s = await makeSalon();
    const customers = await Promise.all(Array.from({ length: 8 }, () => makeUser()));
    const results = await Promise.allSettled(customers.map((c) => createBooking(base(s, c))));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) expect(["slot_taken", "slot_unavailable"]).toContain((r as PromiseRejectedResult).reason.code);
    const [{ n }] = await sql`select count(*)::int as n from bookings where salon_id = ${s.salonId} and status in ('confirmed','pending_payment','pending_approval')`;
    expect(n).toBe(1);
  });

  it("database constraint rejects overlapping inserts even if app logic is bypassed", async () => {
    const s = await makeSalon();
    const c = await makeUser();
    const b = await createBooking(base(s, c));
    await expect(sql`insert into bookings (reference, salon_id, branch_id, customer_id, employee_id, starts_at, ends_at, blocked_until, status, payment_method, subtotal_halalas, total_halalas)
      values ('TR-HACK01', ${s.salonId}, ${s.branchId}, ${c}, ${b.employee_id}, ${new Date(b.starts_at.getTime() + 30 * 60000)}, ${new Date(b.ends_at.getTime() + 30 * 60000)}, ${new Date(b.ends_at.getTime() + 30 * 60000)}, 'confirmed', 'cash', 100, 100)`).rejects.toMatchObject({ code: "23P01" });
  });

  it("'any employee' assigns the second employee when the first is taken", async () => {
    const s = await makeSalon();
    const a = await createBooking(base(s, await makeUser(), { employeeId: null }));
    const b = await createBooking(base(s, await makeUser(), { employeeId: null }));
    expect(a.employee_id).not.toBe(b.employee_id);
    await expect(createBooking(base(s, await makeUser(), { employeeId: null }))).rejects.toMatchObject({ code: "slot_unavailable" });
  });

  it("buffer blocks the following slot", async () => {
    const s = await makeSalon({ buffer: 15 });
    await createBooking(base(s, await makeUser(), { time: "10:00" }));
    await expect(createBooking(base(s, await makeUser(), { time: "11:00" }))).rejects.toMatchObject({ code: "slot_unavailable" });
    await createBooking(base(s, await makeUser(), { time: "11:15" }));
  });

  it("time off blocks slots", async () => {
    const s = await makeSalon();
    const d = tomorrow();
    await sql`insert into employee_time_off (employee_id, starts_at, ends_at, kind) values (${s.employees[0]}, ${d + "T09:00:00+03:00"}, ${d + "T12:00:00+03:00"}, 'blocked')`;
    await expect(createBooking(base(s, await makeUser(), { time: "10:00" }))).rejects.toMatchObject({ code: "slot_unavailable" });
  });

  it("expired unpaid holds are released and the slot becomes bookable", async () => {
    const s = await makeSalon();
    const hold = await createBooking(base(s, await makeUser(), { paymentMethod: "online" }));
    expect(hold.status).toBe("pending_payment");
    await expect(createBooking(base(s, await makeUser()))).rejects.toMatchObject({ code: "slot_unavailable" });
    await sql`update bookings set hold_expires_at = now() - interval '1 minute' where id = ${hold.id}`;
    expect(await releaseExpiredHolds()).toBeGreaterThanOrEqual(1);
    const b = await createBooking(base(s, await makeUser()));
    expect(b.status).toBe("confirmed");
  });

  it("reschedule cannot move onto an occupied slot", async () => {
    const s = await makeSalon();
    const a = await createBooking(base(s, await makeUser(), { time: "10:00" }));
    await createBooking(base(s, await makeUser(), { time: "12:00" }));
    await expect(rescheduleBooking(a.id, { kind: "admin", userId: s.owner }, { date: tomorrow(), time: "12:00" })).rejects.toMatchObject({ code: "slot_unavailable" });
    await rescheduleBooking(a.id, { kind: "admin", userId: s.owner }, { date: tomorrow(), time: "14:00" });
    const [r] = await sql`select starts_at from bookings where id = ${a.id}`;
    expect(r.starts_at.toISOString()).toBe(new Date(tomorrow() + "T14:00:00+03:00").toISOString());
  });
});

describe("payments", () => {
  it("never confirms without verified gateway payment; confirms after verification", async () => {
    const s = await makeSalon();
    const c = await makeUser();
    const b = await createBooking(base(s, c, { paymentMethod: "online" }));
    const co = await startCheckout(b.id, c);
    const co2 = await startCheckout(b.id, c);
    expect(co2.url).toBe(co.url); // idempotent — no duplicate checkout
    const [p] = await sql`select * from payments where booking_id = ${b.id}`;
    // Customer "returns" from checkout but gateway says pending -> still not paid.
    await reconcilePayment(p.id);
    expect((await sql`select status from bookings where id = ${b.id}`)[0].status).toBe("pending_payment");
    // Forged webhook is rejected.
    await expect(handleWebhook(JSON.stringify({ id: "ev1", type: "payment_paid", secret_token: "nope", data: { id: "x", invoice_id: p.provider_ref } }), new Headers())).rejects.toMatchObject({ code: "invalid_signature" });
    pay(p.provider_ref);
    await handleWebhook(JSON.stringify({ id: "ev2", type: "payment_paid", secret_token: "whsec_test", data: { id: "pay", invoice_id: p.provider_ref } }), new Headers());
    await handleWebhook(JSON.stringify({ id: "ev2", type: "payment_paid", secret_token: "whsec_test", data: { id: "pay", invoice_id: p.provider_ref } }), new Headers()); // replay
    const [bk] = await sql`select status, payment_status, amount_paid_halalas from bookings where id = ${b.id}`;
    expect(bk).toMatchObject({ status: "confirmed", payment_status: "paid", amount_paid_halalas: 10000 });
    const [{ n }] = await sql`select count(*)::int as n from ledger_entries where booking_id = ${b.id} and entry_type = 'online_payment'`;
    expect(n).toBe(2);
  });

  it("rejects amount mismatch", async () => {
    const s = await makeSalon();
    const c = await makeUser();
    const b = await createBooking(base(s, c, { paymentMethod: "online" }));
    await startCheckout(b.id, c);
    const [p] = await sql`select * from payments where booking_id = ${b.id}`;
    pay(p.provider_ref, 100);
    await expect(reconcilePayment(p.id)).rejects.toMatchObject({ code: "amount_mismatch" });
    expect((await sql`select status from bookings where id = ${b.id}`)[0].status).toBe("pending_payment");
  });

  it("deposit booking -> partially paid; completion collects balance in cash and posts both commissions", async () => {
    const s = await makeSalon({ deposit: 20 });
    const c = await makeUser();
    const b = await createBooking(base(s, c, { paymentMethod: "deposit" }));
    expect(b.amount_due_online_halalas).toBe(2000);
    await startCheckout(b.id, c);
    const [p] = await sql`select * from payments where booking_id = ${b.id}`;
    pay(p.provider_ref);
    await reconcilePayment(p.id);
    expect((await sql`select payment_status from bookings where id = ${b.id}`)[0].payment_status).toBe("partially_paid");
    await sql`update bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour', blocked_until = now() - interval '1 hour' where id = ${b.id}`;
    const split = await completeBooking(b.id, { kind: "salon", userId: s.owner, salonId: s.salonId, ownEmployeeOnly: null });
    expect(split).toMatchObject({ onlineCommission: 200, cashCommission: 800, platformRevenue: 1000, salonEarnings: 9000 });
    const bal = await salonBalances(s.salonId);
    expect(bal.payable).toBe(1800);      // deposit 2000 - 10% commission
    expect(bal.receivable).toBe(800);    // salon owes 10% of 8000 cash collected
    expect(bal.net).toBe(1000);
    const st = await createSettlement(s.salonId, "2020-01-01", tomorrow(), s.owner);
    const [row] = await sql`select * from settlements where id = ${st.id}`;
    expect(row).toMatchObject({ online_gross_halalas: 2000, online_commission_halalas: 200, cash_gross_halalas: 8000, cash_commission_halalas: 800, net_payable_halalas: 1000 });
    await markSettlementPaid(st.id, "BANK-123", s.owner);
    expect((await salonBalances(s.salonId)).net).toBe(0);
  });

  it("cash booking commission is a receivable, not platform cash", async () => {
    const s = await makeSalon();
    const b = await createBooking(base(s, await makeUser()));
    expect(b.payment_status).toBe("cash_pending");
    await sql`update bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour', blocked_until = now() - interval '1 hour' where id = ${b.id}`;
    await completeBooking(b.id, { kind: "admin", userId: s.owner }, 10000);
    const [r] = await sql`select coalesce(sum(amount_halalas) filter (where account='platform_cash'),0)::int as cash, coalesce(sum(amount_halalas) filter (where account='commission_receivable'),0)::int as recv from ledger_entries where booking_id = ${b.id}`;
    expect(r).toMatchObject({ cash: 0, recv: 1000 });
    await expect(completeBooking(b.id, { kind: "admin", userId: s.owner }, 10000)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("customer free cancellation refunds in full; late cancellation retains fee", async () => {
    const s = await makeSalon();
    await sql`update salons set late_cancel_fee_percent = 50, free_cancel_hours = 48 where id = ${s.salonId}`;
    const c = await makeUser();
    const b = await createBooking(base(s, c, { paymentMethod: "online" }));
    await startCheckout(b.id, c);
    const [p] = await sql`select * from payments where booking_id = ${b.id}`;
    pay(p.provider_ref);
    await reconcilePayment(p.id);
    const r = await cancelBooking(b.id, { kind: "customer", userId: c });
    expect(r).toMatchObject({ fee: 5000, refund: 5000 });
    expect(refunds).toEqual([{ id: `pay_${p.provider_ref}`, amount: 5000 }]);
    const [bk] = await sql`select status, payment_status, amount_refunded_halalas from bookings where id = ${b.id}`;
    expect(bk).toMatchObject({ status: "cancelled", payment_status: "partially_refunded", amount_refunded_halalas: 5000 });
    // other customers cannot cancel
    const b2 = await createBooking(base(s, c, { time: "15:00" }));
    await expect(cancelBooking(b2.id, { kind: "customer", userId: await makeUser() })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("salon rejection of a paid approval-required booking refunds fully", async () => {
    const s = await makeSalon({ requiresApproval: true });
    const c = await makeUser();
    const b = await createBooking(base(s, c, { paymentMethod: "online" }));
    await startCheckout(b.id, c);
    const [p] = await sql`select * from payments where booking_id = ${b.id}`;
    pay(p.provider_ref);
    await reconcilePayment(p.id);
    expect((await sql`select status from bookings where id = ${b.id}`)[0].status).toBe("pending_approval");
    await decideBooking(b.id, { kind: "salon", userId: s.owner, salonId: s.salonId, ownEmployeeOnly: null }, "reject");
    expect(refunds[0].amount).toBe(10000);
    expect((await sql`select payment_status from bookings where id = ${b.id}`)[0].payment_status).toBe("refunded");
  });

  it("stylists cannot manage other employees' bookings", async () => {
    const s = await makeSalon();
    const b = await createBooking(base(s, await makeUser()));
    await expect(cancelBooking(b.id, { kind: "salon", userId: s.owner, salonId: s.salonId, ownEmployeeOnly: s.employees[1] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(cancelBooking(b.id, { kind: "salon", userId: s.owner, salonId: "00000000-0000-0000-0000-000000000000", ownEmployeeOnly: null })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("promo codes apply once per customer", async () => {
    const s = await makeSalon();
    await sql`insert into promotions (salon_id, code, title_ar, discount_type, discount_value) values (${s.salonId}, 'WELCOME20', 'خصم', 'percent', 20)`;
    const c = await makeUser();
    const b = await createBooking(base(s, c, { promoCode: "welcome20" }));
    expect(b).toMatchObject({ discount_halalas: 2000, total_halalas: 8000 });
    await expect(createBooking(base(s, c, { time: "15:00", promoCode: "WELCOME20" }))).rejects.toMatchObject({ code: "promo_used" });
  });
});
