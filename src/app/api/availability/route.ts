import { z } from "zod";
import { api } from "@/lib/api";
import { getAvailability } from "@/lib/booking/service";
import { rateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { clientIp } from "@/lib/auth/session";

const Q = z.object({
  salonId: z.string().uuid(), branchId: z.string().uuid(),
  serviceIds: z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(z.string().uuid()).min(1).max(10)),
  employeeId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const dynamic = "force-dynamic";

export const GET = api(async (req: Request) => {
  await rateLimit(`avail:${clientIp(await headers()) ?? "anon"}`, 300, 60);
  const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const r = await getAvailability(q);
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
});
