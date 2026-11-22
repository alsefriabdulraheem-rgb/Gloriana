"use client";

import { useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n/dict";

export function RescheduleForm({ t, bookingId, salonId, branchId, serviceIds, employeeId, today }: {
  t: Dict; bookingId: string; salonId: string; branchId: string; serviceIds: string[]; employeeId: string; today: string;
}) {
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSlots(null); setTime(null);
    const qs = new URLSearchParams({ salonId, branchId, serviceIds: serviceIds.join(","), employeeId, date });
    fetch(`/api/availability?${qs}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setSlots((j.slots ?? []).map((s: { time: string }) => s.time))).catch(() => setSlots([]));
  }, [date, salonId, branchId, serviceIds, employeeId]);

  async function submit() {
    if (!time) return;
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/bookings/${bookingId}/reschedule`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, time }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg((t.errors as Record<string, string>)[j.error] ?? j.message); return; }
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      {msg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>}
      <input type="date" className="input" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
      {slots === null ? <p className="text-sm text-muted">…</p> : slots.length === 0 ? <p className="text-sm text-muted">{t.book.noSlots}</p> : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {slots.map((s) => <button key={s} type="button" onClick={() => setTime(s)} className={`rounded-lg border py-1.5 text-sm tabular-nums ${time === s ? "border-plum-700 bg-plum-700 text-white" : "border-line"}`}>{s}</button>)}
        </div>
      )}
      <button type="button" className="btn-primary" disabled={!time || busy} onClick={submit}>{t.booking.reschedule}</button>
    </div>
  );
}
