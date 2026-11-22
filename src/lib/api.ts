import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";

/** Uniform JSON error handling for route handlers (used by the web app and future mobile apps). */
export function api<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      if (e instanceof z.ZodError) return NextResponse.json({ error: "validation", message: "Invalid input", issues: e.issues }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: "server_error", message: "Unexpected error" }, { status: 500 });
    }
  };
}

/** Rejects cross-site state-changing requests from browsers (defence in depth on top of SameSite cookies). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (mobile) authenticate with bearer tokens
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host || new URL(origin).host !== host) throw new AppError("bad_origin", "Cross-origin request rejected", 403);
}
