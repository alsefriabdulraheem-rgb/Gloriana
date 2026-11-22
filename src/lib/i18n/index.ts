import { cookies } from "next/headers";
import { ar, en, type Dict } from "./dict";

export type Locale = "ar" | "en";
export const LOCALE_COOKIE = "tremly_locale";

export async function getLocale(): Promise<Locale> {
  const c = await cookies();
  return c.get(LOCALE_COOKIE)?.value === "en" ? "en" : "ar";
}

export async function getDict(): Promise<{ t: Dict; locale: Locale; dir: "rtl" | "ltr" }> {
  const locale = await getLocale();
  return { t: locale === "en" ? en : ar, locale, dir: locale === "ar" ? "rtl" : "ltr" };
}

/** Pick the localized field: pick(row, "name") -> row.name_ar / row.name_en with Arabic fallback. */
export function pick<T extends Record<string, unknown>>(row: T, field: string, locale: Locale): string {
  const v = (locale === "en" ? row[`${field}_en`] : row[`${field}_ar`]) as string | null | undefined;
  return (v || (row[`${field}_ar`] as string) || (row[`${field}_en`] as string) || "") as string;
}

export { ar, en };
export type { Dict };
