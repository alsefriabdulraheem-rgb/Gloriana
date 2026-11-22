export type TemplateName =
  | "otp" | "booking_confirmed" | "booking_pending_approval" | "booking_cancelled" | "booking_rescheduled"
  | "booking_rejected" | "booking_reminder" | "payment_received" | "refund_processed" | "salon_new_booking"
  | "salon_booking_cancelled" | "salon_status_changed";

export type TemplateData = Record<string, string | number | undefined>;

const T: Record<TemplateName, { ar: string; en: string; subject: { ar: string; en: string } }> = {
  otp: { ar: "رمز التحقق في تريملي: {code}. صالح لمدة 5 دقائق. لا تشاركه مع أحد.", en: "Your TREMLY code is {code}. Valid for 5 minutes. Do not share it.", subject: { ar: "رمز التحقق", en: "Verification code" } },
  booking_confirmed: { ar: "تم تأكيد حجزك {ref} في {salon} يوم {when}. الإجمالي {total}.", en: "Booking {ref} at {salon} on {when} is confirmed. Total {total}.", subject: { ar: "تأكيد الحجز", en: "Booking confirmed" } },
  booking_pending_approval: { ar: "تم استلام طلب حجزك {ref} في {salon} يوم {when} وبانتظار موافقة الصالون.", en: "Your booking request {ref} at {salon} on {when} is awaiting salon approval.", subject: { ar: "طلب حجز", en: "Booking request received" } },
  booking_cancelled: { ar: "تم إلغاء الحجز {ref} في {salon} ({when}).", en: "Booking {ref} at {salon} ({when}) was cancelled.", subject: { ar: "إلغاء الحجز", en: "Booking cancelled" } },
  booking_rescheduled: { ar: "تم تغيير موعد الحجز {ref} في {salon} إلى {when}.", en: "Booking {ref} at {salon} moved to {when}.", subject: { ar: "تغيير الموعد", en: "Booking rescheduled" } },
  booking_rejected: { ar: "نعتذر، لم يتمكن {salon} من قبول الحجز {ref}.", en: "Sorry, {salon} could not accept booking {ref}.", subject: { ar: "تعذر قبول الحجز", en: "Booking not accepted" } },
  booking_reminder: { ar: "تذكير: موعدك في {salon} يوم {when}. المرجع {ref}.", en: "Reminder: your appointment at {salon} is on {when}. Ref {ref}.", subject: { ar: "تذكير بالموعد", en: "Appointment reminder" } },
  payment_received: { ar: "تم استلام دفعتك بمبلغ {amount} للحجز {ref}.", en: "Payment of {amount} received for booking {ref}.", subject: { ar: "تأكيد الدفع", en: "Payment received" } },
  refund_processed: { ar: "تم استرداد {amount} للحجز {ref}. قد يستغرق ظهوره في حسابك عدة أيام.", en: "A refund of {amount} for booking {ref} was processed. It may take several days to appear.", subject: { ar: "استرداد المبلغ", en: "Refund processed" } },
  salon_new_booking: { ar: "حجز جديد {ref}: {services} يوم {when} مع {employee}.", en: "New booking {ref}: {services} on {when} with {employee}.", subject: { ar: "حجز جديد", en: "New booking" } },
  salon_booking_cancelled: { ar: "تم إلغاء الحجز {ref} ({when}).", en: "Booking {ref} ({when}) was cancelled.", subject: { ar: "إلغاء حجز", en: "Booking cancelled" } },
  salon_status_changed: { ar: "تم تحديث حالة صالونك {salon} إلى: {status}. {reason}", en: "Your salon {salon} status is now: {status}. {reason}", subject: { ar: "حالة الصالون", en: "Salon status update" } },
};

export function render(name: TemplateName, locale: "ar" | "en", data: TemplateData) {
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ""));
  return { body: fill(T[name][locale]).trim(), subject: `TREMLY — ${T[name].subject[locale]}` };
}

/** Ordered parameters for WhatsApp approved templates. */
export const WHATSAPP_PARAMS: Partial<Record<TemplateName, string[]>> = {
  booking_confirmed: ["ref", "salon", "when", "total"],
  booking_reminder: ["salon", "when", "ref"],
  booking_cancelled: ["ref", "salon", "when"],
  booking_rescheduled: ["ref", "salon", "when"],
};
