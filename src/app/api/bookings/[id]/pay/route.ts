import { api, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { startCheckout } from "@/lib/payments/service";

export const POST = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  return startCheckout(id, user.id);
});
