import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "./errors";

function isNextControlFlow(e: unknown) {
  const d = (e as { digest?: string })?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d === "NEXT_NOT_FOUND" || d.startsWith("NEXT_HTTP_ERROR"));
}

/**
 * Runs a server-action body, then redirects back to `path` with ?ok= or ?error=<code>.
 * Keeps every dashboard form working without client JS, and surfaces validation errors consistently.
 */
export async function runAction(path: string, fn: () => Promise<string | void>): Promise<never> {
  let q: string;
  try {
    const r = await fn();
    q = `ok=${encodeURIComponent(r || "saved")}`;
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    if (e instanceof AppError) q = `error=${encodeURIComponent(e.code)}&msg=${encodeURIComponent(e.message)}`;
    else if (e instanceof z.ZodError) q = `error=validation&msg=${encodeURIComponent(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))}`;
    else if ((e as { code?: string }).code === "23505") q = `error=duplicate&msg=${encodeURIComponent("Already exists")}`;
    else if ((e as { code?: string }).code === "23P01") q = `error=slot_taken`;
    else { console.error(e); q = `error=unexpected&msg=${encodeURIComponent("Unexpected error")}`; }
  }
  const clean = path.split("#")[0];
  revalidatePath(clean.split("?")[0]);
  redirect(clean + (clean.includes("?") ? "&" : "?") + q);
}

export function fd(form: FormData) {
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    str: (k: string) => get(k),
    opt: (k: string) => get(k) || null,
    int: (k: string, def?: number) => {
      const v = get(k);
      if (v === "" && def !== undefined) return def;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new AppError("validation", `${k} must be a number`);
      return Math.round(n);
    },
    sar: (k: string) => {
      const n = Number(get(k));
      if (!Number.isFinite(n) || n < 0) throw new AppError("validation", `${k} must be a valid amount`);
      return Math.round(n * 100);
    },
    bool: (k: string) => form.get(k) === "on" || form.get(k) === "true" || form.get(k) === "1",
    all: (k: string) => form.getAll(k).filter((v): v is string => typeof v === "string" && v !== ""),
    file: (k: string) => {
      const f = form.get(k);
      return f instanceof File && f.size > 0 ? f : null;
    },
  };
}
