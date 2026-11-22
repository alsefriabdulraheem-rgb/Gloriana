import Link from "next/link";
import type { ReactNode } from "react";
import type { Dict } from "@/lib/i18n";

export function Stars({ value, count, size = "sm" }: { value: number; count?: number; size?: "sm" | "lg" }) {
  const v = Number(value) || 0;
  return (
    <span className={`inline-flex items-center gap-1 ${size === "lg" ? "text-base" : "text-xs"}`} aria-label={`${v.toFixed(1)} / 5`}>
      <span className="text-gold-500">★</span>
      <span className="font-semibold">{v ? v.toFixed(1) : "—"}</span>
      {count !== undefined && <span className="text-muted">({count})</span>}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700", completed: "bg-sky-50 text-sky-700", pending_payment: "bg-amber-50 text-amber-700",
  pending_approval: "bg-amber-50 text-amber-700", cancelled: "bg-zinc-100 text-zinc-600", rejected: "bg-red-50 text-red-700",
  no_show: "bg-red-50 text-red-700", expired: "bg-zinc-100 text-zinc-500", paid: "bg-emerald-50 text-emerald-700",
  partially_paid: "bg-sky-50 text-sky-700", cash_pending: "bg-violet-50 text-violet-700", refunded: "bg-zinc-100 text-zinc-700",
  partially_refunded: "bg-zinc-100 text-zinc-700", pending: "bg-amber-50 text-amber-700", unpaid: "bg-zinc-100 text-zinc-600",
  approved: "bg-emerald-50 text-emerald-700", pending_review: "bg-amber-50 text-amber-700", draft: "bg-zinc-100 text-zinc-600",
  suspended: "bg-red-50 text-red-700", deactivated: "bg-zinc-200 text-zinc-700", open: "bg-amber-50 text-amber-700",
  in_progress: "bg-sky-50 text-sky-700", resolved: "bg-emerald-50 text-emerald-700", issued: "bg-sky-50 text-sky-700",
  initiated: "bg-amber-50 text-amber-700", failed: "bg-red-50 text-red-700", succeeded: "bg-emerald-50 text-emerald-700",
  published: "bg-emerald-50 text-emerald-700", hidden: "bg-zinc-100 text-zinc-600", reported: "bg-red-50 text-red-700",
  sent: "bg-emerald-50 text-emerald-700", queued: "bg-amber-50 text-amber-700", skipped: "bg-zinc-100 text-zinc-600",
};

export function Badge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${STATUS_COLORS[status] ?? "bg-zinc-100 text-zinc-700"}`}>{label ?? status}</span>;
}

export function Flash({ sp, t }: { sp: Record<string, string | string[] | undefined>; t: Dict }) {
  const error = typeof sp.error === "string" ? sp.error : null;
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const msg = typeof sp.msg === "string" ? sp.msg : null;
  if (error) {
    const known = (t.errors as Record<string, string>)[error];
    return <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{known ?? msg ?? error}{known && msg && error === "validation" ? ` (${msg})` : ""}</div>;
  }
  if (ok) return <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{ok === "saved" ? t.common.saved : ok}</div>;
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Avatar({ name, url, size = 48, hidden }: { name: string; url?: string | null; size?: number; hidden?: boolean }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  if (url && !hidden) return <img src={url} alt={name} width={size} height={size} loading="lazy" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-plum-100 font-semibold text-plum-700" style={{ width: size, height: size, fontSize: size / 2.8 }}>{initials}</span>;
}

export function Cover({ url, alt, className = "" }: { url?: string | null; alt: string; className?: string }) {
  if (url) return <img src={url} alt={alt} loading="lazy" className={`h-full w-full object-cover ${className}`} />;
  return <div aria-label={alt} className={`h-full w-full bg-gradient-to-br from-plum-200 via-plum-100 to-gold-300 ${className}`} />;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line scrollbar-none">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${i.key === active ? "border-plum-700 text-plum-700" : "border-transparent text-muted hover:text-ink"}`}>{i.label}</Link>
      ))}
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
