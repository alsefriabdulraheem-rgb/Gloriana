/** Normalise Saudi mobile numbers to E.164 (+9665XXXXXXXX). Returns null if invalid. */
export function normalizeSaudiPhone(input: string): string | null {
  let d = input.replace(/[\s\-()]/g, "").replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("966")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (!/^5\d{8}$/.test(d)) return null;
  return "+966" + d;
}
export function maskPhone(p: string | null | undefined): string {
  if (!p) return "";
  return p.slice(0, 6) + "•••" + p.slice(-3);
}
