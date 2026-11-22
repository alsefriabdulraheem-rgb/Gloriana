import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser, destroySession } from "@/lib/auth/session";
import { salonMemberships } from "@/lib/auth/rbac";
import { getDict, LOCALE_COOKIE } from "@/lib/i18n";
import { sql } from "@/lib/db";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="TREMLY">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" className={light ? "fill-white/15" : "fill-plum-700"} />
        <path d="M9 10h14M16 10v13" stroke="#E6CF9E" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="22.5" cy="21.5" r="2" fill="#E6CF9E" />
      </svg>
      <span className={`font-display text-xl font-semibold tracking-[0.14em] ${light ? "text-white" : "text-ink"}`}>TREMLY</span>
    </Link>
  );
}

async function switchLocale(formData: FormData) {
  "use server";
  const l = formData.get("locale") === "en" ? "en" : "ar";
  (await cookies()).set(LOCALE_COOKIE, l, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  const u = await currentUser();
  if (u) await sql`update users set locale = ${l} where id = ${u.id}`;
  const back = String(formData.get("back") || "/");
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/");
}

async function logout() {
  "use server";
  await destroySession();
  redirect("/");
}

export async function Header() {
  const { t, locale } = await getDict();
  const user = await currentUser();
  const memberships = user ? await salonMemberships(user.id) : [];
  const unread = user ? (await sql<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${user.id} and channel = 'in_app' and read_at is null`)[0].n : 0;
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/90 backdrop-blur no-print">
      <div className="container-x flex h-16 items-center gap-4">
        <Logo />
        <nav className="ms-6 hidden items-center gap-1 text-sm md:flex">
          <Link className="btn-ghost btn-sm" href="/search?audience=women">{t.audience.womenShort}</Link>
          <Link className="btn-ghost btn-sm" href="/search?audience=men">{t.audience.menShort}</Link>
          <Link className="btn-ghost btn-sm" href="/offers">{t.nav.offers}</Link>
          <Link className="btn-ghost btn-sm" href="/for-salons">{t.nav.forSalons}</Link>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <form action={switchLocale}>
            <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
            <button className="btn-outline btn-sm" aria-label="Switch language">{locale === "ar" ? "EN" : "عربي"}</button>
          </form>
          {user ? (
            <details className="relative">
              <summary className="btn-outline btn-sm cursor-pointer list-none">
                {user.full_name?.split(" ")[0] || t.nav.account}
                {unread > 0 && <span className="badge bg-plum-700 text-white">{unread}</span>}
              </summary>
              <div className="absolute end-0 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-white py-1 text-sm shadow-lg">
                <Link className="block px-4 py-2 hover:bg-plum-50" href="/account">{t.nav.bookings}</Link>
                {memberships.length > 0 && <Link className="block px-4 py-2 hover:bg-plum-50" href="/dashboard">{t.nav.dashboard}</Link>}
                {user.role === "admin" && <Link className="block px-4 py-2 hover:bg-plum-50" href="/admin">{t.nav.admin}</Link>}
                <form action={logout}><button className="block w-full px-4 py-2 text-start text-red-700 hover:bg-red-50">{t.nav.logout}</button></form>
              </div>
            </details>
          ) : (
            <Link href="/login" className="btn-primary btn-sm">{t.nav.login}</Link>
          )}
        </div>
      </div>
    </header>
  );
}

export async function Footer() {
  const { t } = await getDict();
  return (
    <footer className="mt-20 bg-plum-900 text-white/80 no-print">
      <div className="container-x grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3"><Logo light /><p className="text-sm leading-6">{t.footer.about}</p></div>
        <div className="space-y-2 text-sm">
          <Link className="block hover:text-white" href="/search?audience=women">{t.audience.women}</Link>
          <Link className="block hover:text-white" href="/search?audience=men">{t.audience.men}</Link>
          <Link className="block hover:text-white" href="/offers">{t.nav.offers}</Link>
        </div>
        <div className="space-y-2 text-sm">
          <Link className="block hover:text-white" href="/for-salons">{t.nav.forSalons}</Link>
          <Link className="block hover:text-white" href="/legal/privacy">{t.footer.privacy}</Link>
          <Link className="block hover:text-white" href="/legal/terms">{t.footer.terms}</Link>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2 text-xs">
            {["mada", "VISA", "Mastercard", "Apple Pay"].map((m) => <span key={m} className="rounded-md bg-white/10 px-2 py-1">{m}</span>)}
          </div>
          <p className="text-xs text-white/60">{t.footer.vat}</p>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/50">© {new Date().getFullYear()} TREMLY — {t.footer.rights}</div>
    </footer>
  );
}
