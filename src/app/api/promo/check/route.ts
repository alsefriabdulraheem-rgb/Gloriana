import { z } from "zod";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { evaluatePromotion } from "@/lib/booking/service";
import { rateLimit } from "@/lib/rate-limit";
import { sql } from "@/lib/db";

const Body = z.object({ code: z.string().min(1).max(40), salonId: z.string().uuid(), serviceIds: z.array(z.string().uuid()).min(1).max(10) });

export const POST = api(async (req: Request) => {
  const user = await requireUser();
  await rateLimit(`promo:${user.id}`, 30, 600);
  const b = Body.parse(await req.json());
  const [{ subtotal }] = await sql<{ subtotal: number }[]>`select coalesce(sum(price_halalas), 0)::int as subtotal from services where salon_id = ${b.salonId} and is_active and id in ${sql(b.serviceIds)}`;
  const p = await evaluatePromotion(sql, b.code.trim(), b.salonId, user.id, subtotal);
  return { discount: p.discount, subtotal };
});
