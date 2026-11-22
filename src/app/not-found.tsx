import Link from "next/link";
import { getDict } from "@/lib/i18n";

export default async function NotFound() {
  const { t, locale } = await getDict();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="font-display text-6xl font-semibold text-plum-700">404</div>
      <p className="text-muted">{locale === "ar" ? "الصفحة غير موجودة" : "Page not found"}</p>
      <Link href="/" className="btn-primary">{t.nav.home}</Link>
    </div>
  );
}
