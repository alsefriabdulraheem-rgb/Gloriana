"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-fetches server data on an interval so dashboards show bookings in near real time. */
export function LiveRefresh({ seconds = 15, label = "Live" }: { seconds?: number; label?: string }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(id);
  }, [on, seconds, router]);
  return (
    <button type="button" onClick={() => setOn(!on)} className="chip">
      <span className={`h-2 w-2 rounded-full ${on ? "animate-pulse bg-emerald-500" : "bg-zinc-400"}`} />{label}
    </button>
  );
}
