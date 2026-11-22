import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { AppError } from "./errors";
import { randomToken } from "./crypto";

const TYPES: Record<string, { ext: string; max: number; magic: (b: Buffer) => boolean }> = {
  "image/jpeg": { ext: "jpg", max: 5 << 20, magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  "image/png": { ext: "png", max: 5 << 20, magic: (b) => b.subarray(0, 4).toString("hex") === "89504e47" },
  "image/webp": { ext: "webp", max: 5 << 20, magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  "video/mp4": { ext: "mp4", max: 50 << 20, magic: (b) => b.subarray(4, 8).toString() === "ftyp" },
};

/** Validates (type, size, magic bytes) and stores a file. Returns its public URL. */
export async function storeUpload(file: File, prefix: string): Promise<{ url: string; kind: "image" | "video" }> {
  const spec = TYPES[file.type];
  if (!spec) throw new AppError("invalid_file", "Allowed formats: JPG, PNG, WEBP, MP4");
  if (file.size > spec.max) throw new AppError("file_too_large", `Maximum size is ${spec.max >> 20} MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  if (!spec.magic(buf)) throw new AppError("invalid_file", "File content does not match its type");
  const key = `${prefix.replace(/[^a-z0-9/-]/gi, "")}/${Date.now()}-${randomToken(6)}.${spec.ext}`;
  const e = env();
  const kind = file.type.startsWith("video") ? "video" : "image";
  if (e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY) {
    const r = await fetch(`${e.SUPABASE_URL}/storage/v1/object/${e.SUPABASE_STORAGE_BUCKET}/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": file.type, "x-upsert": "false", "cache-control": "31536000" },
      body: buf,
    });
    if (!r.ok) throw new AppError("upload_failed", `Storage error ${r.status}`, 502);
    return { url: `${e.SUPABASE_URL}/storage/v1/object/public/${e.SUPABASE_STORAGE_BUCKET}/${key}`, kind };
  }
  if (e.NODE_ENV === "production") throw new AppError("storage_not_configured", "Cloud storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)", 503);
  const dest = path.join(process.cwd(), "public", "uploads", key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return { url: `/uploads/${key}`, kind };
}
