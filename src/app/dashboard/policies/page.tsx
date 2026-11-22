import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { Flash, PageTitle } from "@/components/ui";
import { savePolicies } from "../actions";
import { paymentProvider } from "@/lib/payments";

export default async function Policies({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/policies", "policies.manage");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const [s] = await sql<Record<string, number | boolean | string | null>[]>`select slot_interval_min, buffer_min, min_lead_min, max_advance_days, requires_approval, accepts_cash, accepts_online, deposit_percent,
    free_cancel_hours, late_cancel_fee_percent, max_reschedules, cancellation_policy_ar, cancellation_policy_en, show_staff_photos, audience from salons where id = ${ctx.salonId}`;
  const num = (name: string, label: string, help?: string, extra: Record<string, number> = {}) => (
    <div><label className="label">{label}</label><input type="number" name={name} defaultValue={Number(s[name])} className="input" {...extra} />{help && <p className="mt-1 text-[11px] text-muted">{help}</p>}</div>
  );
  const chk = (name: string, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={!!s[name]} className="h-5 w-5 accent-plum-700" />{label}</label>;
  return (
    <div>
      <PageTitle title={ar ? "سياسات الحجز والدفع" : "Booking & payment policies"} />
      <Flash sp={sp} t={t} />
      {!paymentProvider().isConfigured() && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{ar ? "الدفع الإلكتروني غير مفعّل على مستوى المنصة بعد — سيتمكن العملاء من الدفع في الصالون فقط." : "Online payments are not yet enabled platform-wide — customers can only pay at the salon."}</p>}
      <form action={savePolicies} className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div><label className="label">{ar ? "فاصل المواعيد (دقيقة)" : "Slot interval (min)"}</label>
          <select name="slot_interval_min" defaultValue={String(s.slot_interval_min)} className="input">{[5, 10, 15, 20, 30, 45, 60].map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
        {num("buffer_min", ar ? "وقت تجهيز بين المواعيد (دقيقة)" : "Buffer between bookings (min)", undefined, { min: 0, max: 120 })}
        {num("min_lead_min", ar ? "أقل مدة قبل الحجز (دقيقة)" : "Minimum notice (min)", undefined, { min: 0, max: 10080 })}
        {num("max_advance_days", ar ? "أقصى حجز مسبق (يوم)" : "Max advance booking (days)", undefined, { min: 1, max: 365 })}
        {num("deposit_percent", ar ? "نسبة العربون %" : "Deposit %", ar ? "0 = بدون عربون. أكثر من 0 يلزم الدفع الإلكتروني." : "0 = none. Above 0 requires online payment.", { min: 0, max: 100 })}
        {num("free_cancel_hours", ar ? "الإلغاء المجاني قبل (ساعة)" : "Free cancellation until (hours before)", undefined, { min: 0, max: 720 })}
        {num("late_cancel_fee_percent", ar ? "رسوم الإلغاء المتأخر %" : "Late cancellation fee %", undefined, { min: 0, max: 100 })}
        {num("max_reschedules", ar ? "أقصى عدد لتغيير الموعد" : "Max reschedules", undefined, { min: 0, max: 10 })}
        <div className="space-y-2 sm:col-span-2">
          {chk("requires_approval", ar ? "الحجوزات تتطلب موافقة يدوية" : "Bookings require manual approval")}
          {chk("accepts_cash", ar ? "قبول الدفع في الصالون" : "Accept payment at salon")}
          {chk("accepts_online", ar ? "قبول الدفع الإلكتروني" : "Accept online payment")}
          {chk("show_staff_photos", ar ? "إظهار صور الموظفين للعامة" : "Show staff photos publicly")}
          {s.audience === "women" && <p className="text-[11px] text-muted">{ar ? "للصالونات النسائية: ننصح بإخفاء صور الموظفات حفاظاً على الخصوصية." : "Women's salons: we recommend hiding staff photos for privacy."}</p>}
        </div>
        <div className="sm:col-span-2 lg:col-span-4"><label className="label">{ar ? "نص سياسة الإلغاء (عربي)" : "Cancellation policy (Arabic)"}</label><textarea name="cancellation_policy_ar" defaultValue={String(s.cancellation_policy_ar ?? "")} rows={3} className="input" /></div>
        <div className="sm:col-span-2 lg:col-span-4"><label className="label">Cancellation policy (EN)</label><textarea name="cancellation_policy_en" defaultValue={String(s.cancellation_policy_en ?? "")} rows={3} className="input" dir="ltr" /></div>
        <div><button className="btn-primary">{t.common.save}</button></div>
      </form>
    </div>
  );
}
