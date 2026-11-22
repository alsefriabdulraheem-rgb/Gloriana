import type { MetadataRoute } from "next";
import { sql } from "@/lib/db";
import { CITIES } from "@/lib/i18n/dict";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const salons = await sql<{ slug: string; updated_at: Date }[]>`select slug, updated_at from salons where status = 'approved'`;
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/search`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/offers`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/for-salons`, changeFrequency: "monthly", priority: 0.5 },
    ...CITIES.flatMap((c) => ["", "?audience=women", "?audience=men"].map((q) => ({ url: `${base}/city/${c.id}${q}`, changeFrequency: "weekly" as const, priority: 0.7 }))),
    ...salons.map((s) => ({ url: `${base}/salons/${s.slug}`, lastModified: s.updated_at, changeFrequency: "weekly" as const, priority: 0.9 })),
  ];
}
