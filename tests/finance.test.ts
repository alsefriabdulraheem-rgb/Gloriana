import { describe, expect, it } from "vitest";
import { resolveRule, splitCommission, type CommissionRule } from "@/lib/finance/commission";
import { cancellationQuote } from "@/lib/booking/service";
import { normalizeSaudiPhone } from "@/lib/phone";
import { localToUtc, utcToLocal } from "@/lib/time";

const rule = (r: Partial<CommissionRule>): CommissionRule => ({ scope: "default", salon_id: null, category: null, online_percent: 10, cash_percent: 10, effective_from: new Date("2020-01-01"), ...r });

describe("commission rules", () => {
  const rules = [
    rule({}),
    rule({ scope: "category", category: "spa", online_percent: 12, cash_percent: 8 }),
    rule({ scope: "salon", salon_id: "S1", online_percent: 7, cash_percent: 5 }),
    rule({ scope: "salon", salon_id: "S1", online_percent: 6, cash_percent: 4, effective_from: new Date("2030-01-01") }),
  ];
  it("salon override beats category beats default", () => {
    expect(resolveRule(rules, "S1", "spa", new Date("2026-06-01"))).toMatchObject({ online: 7, cash: 5, scope: "salon" });
    expect(resolveRule(rules, "S2", "spa", new Date("2026-06-01"))).toMatchObject({ online: 12, cash: 8, scope: "category" });
    expect(resolveRule(rules, "S2", "salon", new Date("2026-06-01"))).toMatchObject({ online: 10, cash: 10, scope: "default" });
  });
  it("future-dated versions apply only from their effective date", () => {
    expect(resolveRule(rules, "S1", "spa", new Date("2031-01-01"))).toMatchObject({ online: 6, cash: 4 });
  });
  it("splits online vs cash commission", () => {
    expect(splitCommission({ onlineNet: 10000, cashCollected: 5000 }, { online: 10, cash: 5 })).toEqual({ onlineCommission: 1000, cashCommission: 250, salonEarnings: 13750, platformRevenue: 1250 });
  });
});

describe("cancellation policy", () => {
  const policy = { free_cancel_hours: 24, late_cancel_fee_percent: 50 };
  const now = new Date("2026-01-01T10:00:00Z");
  const b = (hoursAhead: number) => ({ starts_at: new Date(now.getTime() + hoursAhead * 3600_000), total_halalas: 20000, amount_paid_halalas: 20000, amount_refunded_halalas: 0 });
  it("free cancellation outside the window", () => expect(cancellationQuote(b(48), policy, "customer", now)).toMatchObject({ late: false, fee: 0, refund: 20000 }));
  it("late fee inside the window", () => expect(cancellationQuote(b(2), policy, "customer", now)).toMatchObject({ late: true, fee: 10000, refund: 10000 }));
  it("salon cancellation always refunds fully", () => expect(cancellationQuote(b(2), policy, "salon", now)).toMatchObject({ fee: 0, refund: 20000 }));
  it("fee never exceeds what was paid (deposit)", () => expect(cancellationQuote({ ...b(2), amount_paid_halalas: 4000 }, policy, "customer", now)).toMatchObject({ fee: 4000, refund: 0 }));
});

describe("helpers", () => {
  it("normalises Saudi mobiles", () => {
    expect(normalizeSaudiPhone("0551234567")).toBe("+966551234567");
    expect(normalizeSaudiPhone("+966 55 123 4567")).toBe("+966551234567");
    expect(normalizeSaudiPhone("٠٥٥١٢٣٤٥٦٧")).toBe("+966551234567");
    expect(normalizeSaudiPhone("0112345678")).toBeNull();
  });
  it("Riyadh time conversion is UTC+3", () => {
    expect(localToUtc("2026-03-01", "09:30").toISOString()).toBe("2026-03-01T06:30:00.000Z");
    expect(utcToLocal(new Date("2026-03-01T22:15:00Z"))).toMatchObject({ date: "2026-03-02", time: "01:15", weekday: 1 });
  });
});
