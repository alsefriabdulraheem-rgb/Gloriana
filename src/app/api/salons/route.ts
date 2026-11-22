import { api } from "@/lib/api";
import { searchSalons } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** Public search API (used by mobile apps). */
export const GET = api(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const n = (k: string) => (p.get(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
  const aud = p.get("audience");
  return searchSalons({
    q: p.get("q") ?? undefined, city: p.get("city") ?? undefined, neighborhood: p.get("neighborhood") ?? undefined,
    audience: aud === "women" || aud === "men" ? aud : undefined, category: p.get("category") ?? undefined, serviceCategory: p.get("type") ?? undefined,
    priceMin: n("min") != null ? n("min")! * 100 : undefined, priceMax: n("max") != null ? n("max")! * 100 : undefined, ratingMin: n("rating"),
    date: p.get("date") ?? undefined, sort: (p.get("sort") as "rating") ?? undefined, limit: n("limit"), offset: n("offset"),
  });
});
