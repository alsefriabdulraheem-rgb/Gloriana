"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dict } from "@/lib/i18n/dict";

type Service = { id: string; name: string; description: string; category: string; duration_min: number; price_halalas: number };
type Employee = { id: string; name: string; title: string; photo_url: string | null; branch_id: string; serviceIds: string[] };
type Props = {
  t: Dict; locale: "ar" | "en";
  salon: { id: string; slug: string; name: string; deposit_percent: number; requires_approval: boolean; show_staff_photos: boolean; max_advance_days: number };
  branches: { id: string; name: string }[]; services: Service[]; employees: Employee[];
  methods: ("online" | "deposit" | "cash")[]; loggedIn: boolean; needsName: boolean;
  initial: { services: string[]; employee: string | null; date: string | null; time: string | null };
  today: string;
};

const fmtSar = (h: number, l: "ar" | "en") => {
  const v = h / 100;
  const n = new Intl.NumberFormat(l === "ar" ? "ar-SA-u-nu-latn" : "en-SA", { maximumFractionDigits: 2 }).format(v);
  return l === "ar" ? `${n} ر.س` : `SAR ${n}`;
};
function addDays(d: string, n: number) { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }

export function BookingWizard(p: Props) {
  const { t, locale } = p;
  const [step, setStep] = useState(p.initial.services.length ? (p.initial.date && p.initial.time ? 3 : 2) : 1);
  const [branchId, setBranchId] = useState(p.branches[0]?.id);
  const [selected, setSelected] = useState<string[]>(p.initial.services);
  const [employeeId, setEmployeeId] = useState<string | null>(p.initial.employee);
  const [date, setDate] = useState(p.initial.date ?? p.today);
  const [time, setTime] = useState<string | null>(p.initial.time);
  const [slots, setSlots] = useState<{ time: string; employeeIds: string[] }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState(p.methods[0] ?? null);
  const [promo, setPromo] = useState("");
  const [discount, setDiscount] = useState(0);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const chosen = p.services.filter((s) => selected.includes(s.id));
  const subtotal = chosen.reduce((a, s) => a + s.price_halalas, 0);
  const duration = chosen.reduce((a, s) => a + s.duration_min, 0);
  const total = Math.max(0, subtotal - discount);
  const dueNow = method === "online" ? total : method === "deposit" ? Math.min(total, Math.max(100, Math.round((total * p.salon.deposit_percent) / 100))) : 0;
  const eligible = useMemo(() => p.employees.filter((e) => e.branch_id === branchId && selected.every((s) => e.serviceIds.includes(s))), [p.employees, branchId, selected]);
  const days = useMemo(() => Array.from({ length: Math.min(30, p.salon.max_advance_days + 1) }, (_, i) => addDays(p.today, i)), [p.today, p.salon.max_advance_days]);
  const errText = (code: string, msg?: string) => (t.errors as Record<string, string>)[code] ?? msg ?? code;

  useEffect(() => { if (employeeId && !eligible.some((e) => e.id === employeeId)) setEmployeeId(null); }, [eligible, employeeId]);
  useEffect(() => { setDiscount(0); setPromoMsg(null); }, [selected]);

  useEffect(() => {
    if (step !== 3 || !selected.length || !branchId) return;
    let cancelled = false;
    setLoading(true); setSlots(null);
    const qs = new URLSearchParams({ salonId: p.salon.id, branchId, serviceIds: selected.join(","), date, ...(employeeId ? { employeeId } : {}) });
    fetch(`/api/availability?${qs}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (cancelled) return;
      setSlots(j.slots ?? []);
      if (time && !(j.slots ?? []).some((s: { time: string }) => s.time === time)) setTime(null);
    }).catch(() => !cancelled && setSlots([])).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [step, date, employeeId, selected, branchId, p.salon.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function applyPromo() {
    setPromoMsg(null);
    const r = await fetch("/api/promo/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: promo, salonId: p.salon.id, serviceIds: selected }) });
    const j = await r.json();
    if (!r.ok) { setDiscount(0); setPromoMsg(errText(j.error, j.message)); return; }
    setDiscount(j.discount); setPromoMsg(`✓ -${fmtSar(j.discount, locale)}`);
  }

  async function submit() {
    if (!time || !method) return;
    setSubmitting(true); setError(null);
    try {
      const r = await fetch("/api/bookings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ salonId: p.salon.id, branchId, serviceIds: selected, employeeId, date, time, paymentMethod: method, promoCode: discount ? promo : null, note: note || null, customerName: name || undefined }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(errText(j.error, j.message));
        if (j.error === "slot_taken" || j.error === "slot_unavailable") { setTime(null); setStep(3); }
        return;
      }
      if (typeof window !== "undefined" && (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag)
        (window as unknown as { gtag: (...a: unknown[]) => void }).gtag("event", "begin_checkout", { value: total / 100, currency: "SAR" });
      window.location.href = j.checkoutUrl ?? `/bookings/${j.reference}?new=1`;
    } catch { setError("Network error"); } finally { setSubmitting(false); }
  }

  const steps = [t.book.step1, t.book.step2, t.book.step3, t.book.step4];
  const canNext = step === 1 ? selected.length > 0 : step === 2 ? true : step === 3 ? !!time : false;
  const empName = (id: string | null) => (id ? p.employees.find((e) => e.id === id)?.name : t.book.any);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="card p-5 sm:p-6">
        <ol className="mb-6 flex items-center gap-2 text-xs sm:text-sm">
          {steps.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <button type="button" disabled={i + 1 > step} onClick={() => setStep(i + 1)} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-semibold ${i + 1 <= step ? "bg-plum-700 text-white" : "bg-plum-50 text-muted"}`}>{i + 1}</button>
              <span className={`hidden sm:inline ${i + 1 === step ? "font-semibold" : "text-muted"}`}>{s}</span>
              {i < 3 && <span className="h-px flex-1 bg-line" />}
            </li>
          ))}
        </ol>

        {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        {step === 1 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">{t.book.selectServices}</h2>
            {p.branches.length > 1 && (
              <div className="mb-4 mt-3"><label className="label">{t.book.branch}</label>
                <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>{p.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            )}
            <div className="mt-3 divide-y divide-line rounded-xl border border-line">
              {p.services.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <label key={s.id} className={`flex cursor-pointer items-center gap-3 p-4 ${on ? "bg-plum-50" : "hover:bg-paper"}`}>
                    <input type="checkbox" className="h-5 w-5 accent-plum-700" checked={on} onChange={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])} />
                    <div className="flex-1"><div className="font-medium">{s.name}</div><div className="text-xs text-muted">{s.duration_min} {t.salon.min}{s.description ? ` · ${s.description}` : ""}</div></div>
                    <div className="font-semibold">{fmtSar(s.price_halalas, locale)}</div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="mb-3 text-lg font-semibold">{t.book.selectStaff}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setEmployeeId(null)} className={`rounded-xl border p-4 text-start ${employeeId === null ? "border-plum-700 bg-plum-50" : "border-line hover:border-plum-200"}`}>
                <div className="font-semibold">✦ {t.book.any}</div><div className="text-xs text-muted">{t.book.anyDesc}</div>
              </button>
              {eligible.map((e) => (
                <button type="button" key={e.id} onClick={() => setEmployeeId(e.id)} className={`flex items-center gap-3 rounded-xl border p-4 text-start ${employeeId === e.id ? "border-plum-700 bg-plum-50" : "border-line hover:border-plum-200"}`}>
                  {e.photo_url && p.salon.show_staff_photos
                    ? <img src={e.photo_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                    : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-plum-100 font-semibold text-plum-700">{e.name.slice(0, 1)}</span>}
                  <div><div className="font-semibold">{e.name}</div><div className="text-xs text-muted">{e.title}</div></div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="mb-3 text-lg font-semibold">{t.book.selectDate}</h2>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 scrollbar-none">
              {days.map((d) => {
                const dt = new Date(d + "T12:00:00Z");
                return (
                  <button type="button" key={d} onClick={() => { setDate(d); setTime(null); }} className={`flex w-16 shrink-0 flex-col items-center rounded-xl border py-2 ${d === date ? "border-plum-700 bg-plum-700 text-white" : "border-line bg-white hover:border-plum-200"}`}>
                    <span className="text-[11px] opacity-80">{new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(dt)}</span>
                    <span className="text-lg font-semibold tabular-nums">{dt.getUTCDate()}</span>
                    <span className="text-[10px] opacity-70">{new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB", { month: "short", timeZone: "UTC" }).format(dt)}</span>
                  </button>
                );
              })}
            </div>
            <h3 className="mb-2 mt-5 font-semibold">{t.book.selectTime}</h3>
            {loading || !slots ? <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-plum-50" />)}</div>
              : slots.length === 0 ? <p className="rounded-xl bg-paper p-4 text-sm text-muted">{t.book.noSlots}</p>
              : <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {slots.map((s) => <button type="button" key={s.time} onClick={() => setTime(s.time)} className={`rounded-lg border py-2 text-sm font-medium tabular-nums ${time === s.time ? "border-plum-700 bg-plum-700 text-white" : "border-line hover:border-plum-500"}`}>{s.time}</button>)}
                </div>}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="mb-3 text-lg font-semibold">{t.book.payment}</h2>
              {p.methods.length === 0 && <p className="text-sm text-red-700">{t.book.onlineUnavailable}</p>}
              <div className="space-y-2">
                {p.methods.map((m) => (
                  <label key={m} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${method === m ? "border-plum-700 bg-plum-50" : "border-line"}`}>
                    <input type="radio" name="method" className="accent-plum-700" checked={method === m} onChange={() => setMethod(m)} />
                    <div className="flex-1">
                      <div className="font-semibold">{m === "online" ? t.book.payOnline : m === "deposit" ? t.book.payDeposit : t.book.payCash}</div>
                      <div className="text-xs text-muted">{m === "online" ? t.book.payOnlineDesc : m === "deposit" ? t.book.payDepositDesc.replace("{p}", String(p.salon.deposit_percent)) : t.book.payCashDesc}</div>
                    </div>
                    {m !== "cash" && <span className="text-[10px] font-bold text-muted">mada · VISA · MC · Pay</span>}
                  </label>
                ))}
              </div>
              {!p.methods.includes("online") && p.methods.length > 0 && <p className="mt-2 text-xs text-muted">{t.book.onlineUnavailable}</p>}
            </div>
            <div>
              <label className="label">{t.book.promo}</label>
              <div className="flex gap-2">
                <input className="input" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
                <button type="button" className="btn-outline" disabled={!promo || !p.loggedIn} onClick={applyPromo}>{t.book.apply}</button>
              </div>
              {promoMsg && <p className="mt-1 text-xs">{promoMsg}</p>}
            </div>
            {p.needsName && <div><label className="label">{t.auth.name}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>}
            <div><label className="label">{t.book.note}</label><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            {(method === "online" || method === "deposit") && <p className="text-xs text-muted">⏱ {t.book.holdNotice}</p>}
          </div>
        )}

        <div className="mt-6 flex justify-between gap-3">
          <button type="button" className="btn-outline" disabled={step === 1} onClick={() => setStep(step - 1)}>{t.book.back}</button>
          {step < 4 ? (
            <button type="button" className="btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>{t.book.next}</button>
          ) : !p.loggedIn ? (
            <a className="btn-primary" href={`/login?next=${encodeURIComponent(`/salons/${p.salon.slug}/book?services=${selected.join(",")}&date=${date}&time=${time ?? ""}${employeeId ? `&employee=${employeeId}` : ""}`)}`}>{t.book.loginRequired}</a>
          ) : (
            <button type="button" className="btn-primary" disabled={submitting || !method || !time || (p.needsName && name.trim().length < 2)} onClick={submit}>
              {submitting ? "…" : method === "cash" ? t.book.confirm : t.book.confirmPay}
            </button>
          )}
        </div>
      </div>

      <aside className="card h-fit p-5 lg:sticky lg:top-20">
        <h2 className="mb-3 font-semibold">{t.book.summary}</h2>
        <p className="mb-3 text-sm font-medium">{p.salon.name}</p>
        <ul className="space-y-2 text-sm">
          {chosen.map((s) => <li key={s.id} className="flex justify-between gap-2"><span>{s.name}</span><span className="tabular-nums">{fmtSar(s.price_halalas, locale)}</span></li>)}
        </ul>
        <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted">{t.book.duration}</dt><dd>{duration} {t.salon.min}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t.book.employee}</dt><dd>{empName(employeeId)}</dd></div>
          {time && <div className="flex justify-between"><dt className="text-muted">{t.book.date}</dt><dd className="tabular-nums">{date} · {time}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted">{t.book.subtotal}</dt><dd className="tabular-nums">{fmtSar(subtotal, locale)}</dd></div>
          {discount > 0 && <div className="flex justify-between text-emerald-700"><dt>{t.book.discount}</dt><dd className="tabular-nums">-{fmtSar(discount, locale)}</dd></div>}
          <div className="flex justify-between text-base font-semibold"><dt>{t.book.total}</dt><dd className="tabular-nums">{fmtSar(total, locale)}</dd></div>
          {step === 4 && method && method !== "cash" && <div className="flex justify-between text-plum-700"><dt>{t.book.payNow}</dt><dd className="tabular-nums">{fmtSar(dueNow, locale)}</dd></div>}
          {step === 4 && method && total - dueNow > 0 && <div className="flex justify-between text-muted"><dt>{t.book.payAtSalon}</dt><dd className="tabular-nums">{fmtSar(total - dueNow, locale)}</dd></div>}
        </dl>
        {p.salon.requires_approval && <p className="mt-3 text-xs text-muted">ⓘ {t.salon.approval}</p>}
      </aside>
    </div>
  );
}
