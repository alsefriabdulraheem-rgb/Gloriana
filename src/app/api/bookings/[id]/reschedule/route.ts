import { z } from "zod";
import { api, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { rescheduleBooking } from "@/lib/booking/service";

const Body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) });

export const POST = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  await rescheduleBooking(id, { kind: "customer", userId: user.id }, Body.parse(await req.json()));
  return { ok: true };
});
