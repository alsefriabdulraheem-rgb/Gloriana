"use client";

import { useState } from "react";
import type { Dict } from "@/lib/i18n/dict";

export function LoginForm({ t, next }: { t: Dict; next: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<"phone" | "code" | "password">("phone");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const err = (j: { error?: string; message?: string }) => (t.errors as Record<string, string>)[j.error ?? ""] ?? j.message ?? "Error";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function post(url: string, body: object) {
    setBusy(true); setError(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setError(err(j)); return null; }
      return j;
    } catch { setError("Network error"); return null; } finally { setBusy(false); }
  }

  if (stage === "password") return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const j = await post("/api/auth/password", { email, password }); if (j) window.location.href = safeNext === "/" ? (j.user.role === "admin" ? "/admin" : "/dashboard") : safeNext; }}>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div><label className="label" htmlFor="email">{t.auth.email}</label><input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div><label className="label" htmlFor="pw">{t.auth.password}</label><input id="pw" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      <button className="btn-primary w-full" disabled={busy}>{t.nav.login}</button>
      <button type="button" className="btn-ghost w-full" onClick={() => setStage("phone")}>{t.auth.phone}</button>
    </form>
  );

  return stage === "phone" ? (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/auth/otp/request", { phone })) setStage("code"); }}>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div>
        <label className="label" htmlFor="phone">{t.auth.phone}</label>
        <div className="flex gap-2" dir="ltr">
          <span className="input w-20 shrink-0 text-center text-muted">+966</span>
          <input id="phone" inputMode="tel" autoComplete="tel" className="input" placeholder={t.auth.phoneHint} value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
      </div>
      <button className="btn-primary w-full" disabled={busy}>{t.auth.send}</button>
      <p className="text-center text-xs text-muted">{t.auth.terms}</p>
      <button type="button" className="btn-ghost w-full text-xs" onClick={() => setStage("password")}>{t.auth.withPassword}</button>
    </form>
  ) : (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const j = await post("/api/auth/otp/verify", { phone, code, name: name || undefined }); if (j) window.location.href = safeNext; }}>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <p className="text-sm text-muted">{t.auth.sentTo} <span dir="ltr" className="font-medium text-ink">{phone}</span></p>
      <div><label className="label" htmlFor="code">{t.auth.code}</label>
        <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className="input text-center text-2xl tracking-[0.5em]" dir="ltr" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></div>
      <div><label className="label" htmlFor="name">{t.auth.name} <span className="font-normal">({t.common.optional})</span></label><input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{t.auth.verify}</button>
      <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => post("/api/auth/otp/request", { phone })}>{t.auth.resend}</button>
    </form>
  );
}
