/** All amounts are integer halalas. 100 halalas = 1 SAR. */
export function sar(halalas: number | bigint, locale: "ar" | "en" = "ar"): string {
  const v = Number(halalas) / 100;
  const n = new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-SA", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
  return locale === "ar" ? `${n} ر.س` : `SAR ${n}`;
}
export function toHalalas(sarAmount: number | string): number {
  const n = typeof sarAmount === "string" ? Number(sarAmount) : sarAmount;
  if (!Number.isFinite(n) || n < 0) throw new Error("Invalid amount");
  return Math.round(n * 100);
}
/** Percentage of an amount, rounded half-up to the nearest halala. */
export function percentOf(halalas: number, percent: number): number {
  return Math.round((halalas * percent) / 100);
}
