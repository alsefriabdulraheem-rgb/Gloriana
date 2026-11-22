import { sql, type Db } from "../db";
import { percentOf } from "../money";

export type CommissionRule = {
  scope: "default" | "category" | "salon"; salon_id: string | null; category: string | null;
  online_percent: number; cash_percent: number; effective_from: Date;
};

/** Resolution order: salon-specific > salon category > platform default; newest effective rule wins. */
export function resolveRule(rules: CommissionRule[], salonId: string, category: string, at: Date): { online: number; cash: number; scope: string } {
  const active = rules.filter((r) => new Date(r.effective_from) <= at).sort((a, b) => +new Date(b.effective_from) - +new Date(a.effective_from));
  const pick = active.find((r) => r.scope === "salon" && r.salon_id === salonId)
    ?? active.find((r) => r.scope === "category" && r.category === category)
    ?? active.find((r) => r.scope === "default");
  if (!pick) return { online: 0, cash: 0, scope: "none" };
  return { online: Number(pick.online_percent), cash: Number(pick.cash_percent), scope: pick.scope };
}

export async function commissionFor(salonId: string, at: Date, db: Db = sql) {
  const [salon] = await db<{ category: string }[]>`select category from salons where id = ${salonId}`;
  const rules = await db<CommissionRule[]>`select scope, salon_id, category, online_percent, cash_percent, effective_from from commission_rules
    where scope = 'default' or salon_id = ${salonId} or category = ${salon?.category ?? ""}`;
  return resolveRule(rules, salonId, salon?.category ?? "salon", at);
}

export type BookingMoney = { onlineNet: number; cashCollected: number };

/** Commission split for a completed booking. */
export function splitCommission(m: BookingMoney, rates: { online: number; cash: number }) {
  const onlineCommission = percentOf(m.onlineNet, rates.online);
  const cashCommission = percentOf(m.cashCollected, rates.cash);
  return {
    onlineCommission, cashCommission,
    salonEarnings: m.onlineNet + m.cashCollected - onlineCommission - cashCommission,
    platformRevenue: onlineCommission + cashCommission,
  };
}
