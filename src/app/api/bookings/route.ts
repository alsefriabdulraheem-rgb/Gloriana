import { z } from "zod";
import { api, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createBooking } from "@/lib/booking/service";
import { startCheckout } from "@/lib/payments/service";
import { paymentProvider } from "@/lib/payments";
import { rateLimit } from "@/lib/rate-limit";
import { sql } from "@/lib/db";

const Body = z.object({
  salonId: z.string().uuid(), branchId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).min(1).max(10),
  employeeId: z.string().uuid().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/),
  paymentMethod: z.enum(["online", "deposit", "cash"]),
  promoCode: z.string().max(40).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  customerName: z.string().trim().min(2).max(80).optional(),
});

export const POST = api(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser();
  await rateLimit(`booking:create:${user.id}`, 15, 3600);
  const b = Body.parse(await req.json());
  if (b.customerName && !user.full_name) await sql`update users set full_name = ${b.customerName} where id = ${user.id}`;
  const booking = await createBooking({ ...b, customerId: user.id, onlinePaymentsAvailable: paymentProvider().isConfigured() });
  let checkoutUrl: string | null = null;
  if (booking.status === "pending_payment") {
    // If the gateway is briefly unavailable the slot stays held; the customer can retry "Pay now" from the booking page.
    try { checkoutUrl = (await startCheckout(booking.id, user.id)).url; } catch (e) { console.error("checkout start failed", (e as Error).message); }
  }
  return { reference: booking.reference, status: booking.status, checkoutUrl };
});

/** List the signed-in customer's bookings (mobile API). */
export const GET = api(async () => {
  const user = await requireUser();
  return sql`select b.reference, b.status, b.payment_status, b.starts_at, b.total_halalas, s.name_ar, s.name_en, s.slug
    from bookings b join salons s on s.id = b.salon_id where b.customer_id = ${user.id} order by b.starts_at desc limit 100`;
});
