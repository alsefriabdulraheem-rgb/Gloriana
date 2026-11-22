import { z } from "zod";
import { api, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { cancelBooking } from "@/lib/booking/service";

const Body = z.object({ reason: z.string().max(500).optional() });

export const POST = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  const { reason } = Body.parse(await req.json().catch(() => ({})));
  return cancelBooking(id, { kind: "customer", userId: user.id }, reason);
});
