import { headers } from "next/headers";
import { z } from "zod";
import { api, assertSameOrigin } from "@/lib/api";
import { requestOtp } from "@/lib/auth/otp";
import { clientIp } from "@/lib/auth/session";
import { normalizeSaudiPhone } from "@/lib/phone";
import { AppError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n";

const Body = z.object({ phone: z.string().min(9).max(20) });

export const POST = api(async (req: Request) => {
  assertSameOrigin(req);
  const { phone } = Body.parse(await req.json());
  const p = normalizeSaudiPhone(phone);
  if (!p) throw new AppError("invalid_phone", "Enter a valid Saudi mobile number");
  return requestOtp(p, clientIp(await headers()), await getLocale());
});
