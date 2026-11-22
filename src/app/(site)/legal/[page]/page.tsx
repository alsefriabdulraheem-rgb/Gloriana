import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDict } from "@/lib/i18n";

const CONTENT = {
  privacy: {
    ar: { title: "سياسة الخصوصية", body: [
      "تلتزم تريملي بنظام حماية البيانات الشخصية في المملكة العربية السعودية (PDPL) ولوائحه التنفيذية.",
      "البيانات التي نجمعها: رقم الجوال، الاسم، البريد الإلكتروني (اختياري)، سجل الحجوزات، والتقييمات. لا نخزن بيانات البطاقات إطلاقاً؛ تتم معالجة المدفوعات عبر بوابة دفع مرخصة من البنك المركزي السعودي.",
      "الغرض: تنفيذ الحجوزات، إرسال التأكيدات والتذكيرات، منع الاحتيال، والوفاء بالالتزامات النظامية والمحاسبية.",
      "المشاركة: نشارك مع الصالون الذي تحجز لديه فقط ما يلزم لتقديم الخدمة (الاسم ورقم الجوال للحجوزات المؤكدة).",
      "الخصوصية في الصالونات النسائية: صور الموظفات مخفية افتراضياً، ولا يُعرض للعامة إلا الاسم الأول للمقيِّمات.",
      "حقوقك: الوصول إلى بياناتك وتصحيحها وطلب حذفها من صفحة «حسابي». نحتفظ بالسجلات المالية مجهولة الهوية للمدة التي يتطلبها النظام.",
    ] },
    en: { title: "Privacy policy", body: [
      "TREMLY complies with the Saudi Personal Data Protection Law (PDPL) and its implementing regulations.",
      "Data we collect: mobile number, name, optional email, booking history and reviews. We never store card data; payments are processed by a SAMA-licensed payment gateway.",
      "Purpose: fulfilling bookings, sending confirmations and reminders, fraud prevention and legal/accounting obligations.",
      "Sharing: the salon you book with receives only what is required to deliver the service (name and mobile for confirmed bookings).",
      "Women's salon privacy: staff photos are hidden by default and reviewers are shown by first name only.",
      "Your rights: access, correct and request deletion of your data from “My account”. Financial records are retained in anonymised form for the legally required period.",
    ] },
  },
  terms: {
    ar: { title: "الشروط والأحكام", body: [
      "تريملي منصة وسيطة تربط العملاء بالصالونات المستقلة؛ يتحمل الصالون مسؤولية تقديم الخدمة.",
      "الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة حيثما ينطبق.",
      "الإلغاء والاسترداد يخضعان لسياسة كل صالون المعروضة قبل الحجز. تُعاد المبالغ المستردة إلى وسيلة الدفع الأصلية.",
      "يتم حجز الموعد مؤقتاً لمدة 15 دقيقة عند اختيار الدفع الإلكتروني، ويُلغى تلقائياً إن لم يكتمل الدفع.",
      "يحق لتريملي تعليق الحسابات المخالفة أو التقييمات المسيئة.",
    ] },
    en: { title: "Terms & conditions", body: [
      "TREMLY is a marketplace connecting customers with independent salons; the salon is responsible for delivering the service.",
      "Prices are in Saudi Riyal and include VAT where applicable.",
      "Cancellations and refunds follow each salon's policy shown before booking. Refunds go back to the original payment method.",
      "When paying online your slot is held for 15 minutes and released automatically if payment is not completed.",
      "TREMLY may suspend accounts or remove reviews that violate these terms.",
    ] },
  },
} as const;

type P = { params: Promise<{ page: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { page } = await params;
  const { locale } = await getDict();
  const c = CONTENT[page as keyof typeof CONTENT];
  return c ? { title: c[locale].title } : {};
}

export default async function Legal({ params }: P) {
  const { page } = await params;
  const { locale } = await getDict();
  const c = CONTENT[page as keyof typeof CONTENT];
  if (!c) notFound();
  return (
    <article className="container-x max-w-3xl py-12">
      <h1 className="mb-6 font-display text-3xl font-semibold">{c[locale].title}</h1>
      <div className="space-y-4 leading-7 text-ink/85">{c[locale].body.map((p, i) => <p key={i}>{p}</p>)}</div>
    </article>
  );
}
