import { sql, type Tx, type Db } from "../db";
import { humanCode } from "../crypto";
import { AppError } from "../errors";
import { commissionFor, splitCommission } from "./commission";
import { percentOf } from "../money";

type Entry = {
  salon_id: string; booking_id?: string | null; payment_id?: string | null; refund_id?: string | null;
  entry_type: string; account: string; amount_halalas: number; commission_percent?: number | null; memo?: string | null; created_by?: string | null;
};

export async function post(db: Db, entries: Entry[]) {
  for (const e of entries) {
    if (e.amount_halalas === 0) continue;
    await db`insert into ledger_entries (salon_id, booking_id, payment_id, refund_id, entry_type, account, amount_halalas, commission_percent, memo, created_by)
      values (${e.salon_id}, ${e.booking_id ?? null}, ${e.payment_id ?? null}, ${e.refund_id ?? null}, ${e.entry_type}, ${e.account},
              ${e.amount_halalas}, ${e.commission_percent ?? null}, ${e.memo ?? null}, ${e.created_by ?? null})
      on conflict do nothing`;
  }
}

/** Verified online payment: TREMLY now holds the funds on behalf of the salon. */
export async function postOnlinePayment(tx: Tx, p: { salonId: string; bookingId: string; paymentId: string; amount: number }) {
  await post(tx, [
    { salon_id: p.salonId, booking_id: p.bookingId, payment_id: p.paymentId, entry_type: "online_payment", account: "platform_cash", amount_halalas: p.amount },
    { salon_id: p.salonId, booking_id: p.bookingId, payment_id: p.paymentId, entry_type: "online_payment", account: "salon_payable", amount_halalas: p.amount },
  ]);
}

export async function postRefund(tx: Tx, p: { salonId: string; bookingId: string; paymentId: string; refundId: string; amount: number; reverseCommissionPercent?: number }) {
  const entries: Entry[] = [
    { salon_id: p.salonId, booking_id: p.bookingId, payment_id: p.paymentId, refund_id: p.refundId, entry_type: "refund", account: "platform_cash", amount_halalas: -p.amount },
    { salon_id: p.salonId, booking_id: p.bookingId, payment_id: p.paymentId, refund_id: p.refundId, entry_type: "refund", account: "salon_payable", amount_halalas: -p.amount },
  ];
  if (p.reverseCommissionPercent) {
    const c = percentOf(p.amount, p.reverseCommissionPercent);
    entries.push(
      { salon_id: p.salonId, booking_id: p.bookingId, refund_id: p.refundId, entry_type: "refund_commission_reversal", account: "platform_revenue", amount_halalas: -c, commission_percent: p.reverseCommissionPercent },
      { salon_id: p.salonId, booking_id: p.bookingId, refund_id: p.refundId, entry_type: "refund_commission_reversal", account: "salon_payable", amount_halalas: c, commission_percent: p.reverseCommissionPercent },
    );
  }
  await post(tx, entries);
}

/**
 * Commission on a completed (or late-cancelled, fee retained) booking.
 * - Online portion: deducted from what TREMLY owes the salon.
 * - Cash portion: the SALON holds the cash, so the commission becomes a receivable owed BY the salon.
 *   Recording a cash payment never implies the platform has received its commission.
 */
export async function postCommission(tx: Tx, b: { salonId: string; bookingId: string; onlineNet: number; cashCollected: number; at: Date; actorId?: string | null }) {
  const rates = await commissionFor(b.salonId, b.at, tx);
  const s = splitCommission({ onlineNet: b.onlineNet, cashCollected: b.cashCollected }, rates);
  await post(tx, [
    { salon_id: b.salonId, booking_id: b.bookingId, entry_type: "online_commission", account: "salon_payable", amount_halalas: -s.onlineCommission, commission_percent: rates.online, created_by: b.actorId },
    { salon_id: b.salonId, booking_id: b.bookingId, entry_type: "online_commission", account: "platform_revenue", amount_halalas: s.onlineCommission, commission_percent: rates.online, created_by: b.actorId },
    { salon_id: b.salonId, booking_id: b.bookingId, entry_type: "cash_collected", account: "salon_cash", amount_halalas: b.cashCollected, memo: "Cash collected by salon (informational)", created_by: b.actorId },
    { salon_id: b.salonId, booking_id: b.bookingId, entry_type: "cash_commission", account: "commission_receivable", amount_halalas: s.cashCommission, commission_percent: rates.cash, created_by: b.actorId },
    { salon_id: b.salonId, booking_id: b.bookingId, entry_type: "cash_commission", account: "platform_revenue", amount_halalas: s.cashCommission, commission_percent: rates.cash, created_by: b.actorId },
  ]);
  return { ...s, rates };
}

export async function salonBalances(salonId: string, db: Db = sql) {
  const [r] = await db<{ payable: string; receivable: string; revenue: string; cash: string }[]>`
    select coalesce(sum(amount_halalas) filter (where account = 'salon_payable'), 0) as payable,
           coalesce(sum(amount_halalas) filter (where account = 'commission_receivable'), 0) as receivable,
           coalesce(sum(amount_halalas) filter (where account = 'platform_revenue'), 0) as revenue,
           coalesce(sum(amount_halalas) filter (where account = 'salon_cash'), 0) as cash
    from ledger_entries where salon_id = ${salonId}`;
  return { payable: Number(r.payable), receivable: Number(r.receivable), revenue: Number(r.revenue), cash: Number(r.cash), net: Number(r.payable) - Number(r.receivable) };
}

/** Draft a settlement statement covering all unsettled entries up to period_end (inclusive, Riyadh dates). */
export async function createSettlement(salonId: string, periodStart: string, periodEnd: string, actorId: string) {
  return sql.begin(async (tx) => {
    const cutoff = new Date(periodEnd + "T23:59:59.999+03:00");
    const entries = await tx<{ id: string; entry_type: string; account: string; amount_halalas: number }[]>`
      select id, entry_type, account, amount_halalas from ledger_entries
      where salon_id = ${salonId} and settlement_id is null and created_at <= ${cutoff}
        and entry_type not in ('settlement_payout', 'settlement_collection')
      for update`;
    if (!entries.length) throw new AppError("nothing_to_settle", "No unsettled ledger entries in this period");
    const sum = (f: (e: (typeof entries)[number]) => boolean) => entries.filter(f).reduce((a, e) => a + e.amount_halalas, 0);
    const onlineGross = sum((e) => e.entry_type === "online_payment" && e.account === "salon_payable");
    const onlineCommission = -sum((e) => e.entry_type === "online_commission" && e.account === "salon_payable");
    const cashGross = sum((e) => e.entry_type === "cash_collected");
    const cashCommission = sum((e) => e.account === "commission_receivable");
    const refunds = -sum((e) => e.entry_type === "refund" && e.account === "salon_payable");
    const payable = sum((e) => e.account === "salon_payable");
    const net = payable - cashCommission;
    const [s] = await tx<{ id: string; reference: string }[]>`
      insert into settlements (reference, salon_id, period_start, period_end, online_gross_halalas, online_commission_halalas, cash_gross_halalas,
        cash_commission_halalas, refunds_halalas, net_payable_halalas, created_by)
      values (${"ST-" + humanCode(8)}, ${salonId}, ${periodStart}, ${periodEnd}, ${onlineGross}, ${onlineCommission}, ${cashGross},
        ${cashCommission}, ${refunds}, ${net}, ${actorId})
      returning id, reference`;
    await tx`update ledger_entries set settlement_id = ${s.id} where id in ${tx(entries.map((e) => e.id))}`;
    return s;
  });
}

/** Marks a settlement paid and posts the closing ledger movements. */
export async function markSettlementPaid(settlementId: string, paymentReference: string, actorId: string) {
  return sql.begin(async (tx) => {
    const [s] = await tx<{ id: string; salon_id: string; status: string; net_payable_halalas: number; cash_commission_halalas: number }[]>`
      select * from settlements where id = ${settlementId} for update`;
    if (!s) throw new AppError("not_found", "Settlement not found", 404);
    if (s.status === "paid") return s;
    if (s.status === "void") throw new AppError("invalid_state", "Settlement is void");
    const payable = s.net_payable_halalas + s.cash_commission_halalas;
    await tx`insert into ledger_entries (salon_id, settlement_id, entry_type, account, amount_halalas, memo, created_by) values
      (${s.salon_id}, ${s.id}, 'settlement_payout', 'salon_payable', ${-payable}, ${paymentReference}, ${actorId}),
      (${s.salon_id}, ${s.id}, 'settlement_payout', 'platform_cash', ${-payable}, ${paymentReference}, ${actorId}),
      (${s.salon_id}, ${s.id}, 'settlement_collection', 'commission_receivable', ${-s.cash_commission_halalas}, ${paymentReference}, ${actorId}),
      (${s.salon_id}, ${s.id}, 'settlement_collection', 'platform_cash', ${s.cash_commission_halalas}, ${paymentReference}, ${actorId})`;
    await tx`update settlements set status = 'paid', paid_at = now(), payment_reference = ${paymentReference} where id = ${s.id}`;
    return s;
  });
}
