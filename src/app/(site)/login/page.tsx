import type { Metadata } from "next";
import { getDict } from "@/lib/i18n";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { t } = await getDict();
  const { next } = await searchParams;
  return (
    <div className="container-x flex min-h-[70vh] items-center justify-center py-12">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <h1 className="mb-6 text-center font-display text-2xl font-semibold">{t.auth.title}</h1>
        <LoginForm t={t} next={next ?? "/"} />
      </div>
    </div>
  );
}
