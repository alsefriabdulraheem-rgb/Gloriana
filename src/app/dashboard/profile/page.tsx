import { dashPage } from "@/lib/dashboard";
import { getDict } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { Cover, Flash, PageTitle } from "@/components/ui";
import { deleteMedia, saveProfile, uploadMedia } from "../actions";

export default async function Profile({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await dashPage("/dashboard/profile", "profile.manage");
  const { t, locale } = await getDict();
  const ar = locale === "ar";
  const [s] = await sql<{ name_ar: string; name_en: string | null; description_ar: string | null; description_en: string | null; phone: string | null; email: string | null; category: string; commercial_registration: string | null; vat_number: string | null; logo_url: string | null; cover_url: string | null }[]>`
    select name_ar, name_en, description_ar, description_en, phone, email::text, category, commercial_registration, vat_number, logo_url, cover_url from salons where id = ${ctx.salonId}`;
  const media = await sql<{ id: string; kind: string; url: string }[]>`select id, kind, url from salon_media where salon_id = ${ctx.salonId} order by sort, created_at`;
  return (
    <div className="space-y-6">
      <PageTitle title={ar ? "ملف الصالون" : "Salon profile"} />
      <Flash sp={sp} t={t} />
      <form action={saveProfile} className="card grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-[120px_1fr]">
          <div><div className="mb-1 h-28 w-28 overflow-hidden rounded-2xl border border-line"><Cover url={s.logo_url} alt="logo" /></div><input type="file" name="logo" accept="image/jpeg,image/png,image/webp" className="text-xs" /></div>
          <div><div className="mb-1 h-28 overflow-hidden rounded-2xl border border-line"><Cover url={s.cover_url} alt="cover" /></div><input type="file" name="cover" accept="image/jpeg,image/png,image/webp" className="text-xs" /></div>
        </div>
        <div><label className="label">{ar ? "الاسم (عربي)" : "Name (Arabic)"}</label><input name="name_ar" defaultValue={s.name_ar} className="input" required /></div>
        <div><label className="label">Name (EN)</label><input name="name_en" defaultValue={s.name_en ?? ""} className="input" dir="ltr" /></div>
        <div><label className="label">{ar ? "النوع" : "Type"}</label><select name="category" defaultValue={s.category} className="input">{Object.entries(t.category).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">{t.common.phone}</label><input name="phone" defaultValue={s.phone ?? ""} className="input" dir="ltr" /></div>
        <div><label className="label">{t.common.email}</label><input name="email" defaultValue={s.email ?? ""} className="input" dir="ltr" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">{ar ? "السجل التجاري" : "CR number"}</label><input name="cr" defaultValue={s.commercial_registration ?? ""} className="input" dir="ltr" /></div>
          <div><label className="label">{ar ? "الرقم الضريبي" : "VAT number"}</label><input name="vat" defaultValue={s.vat_number ?? ""} className="input" dir="ltr" /></div>
        </div>
        <div className="sm:col-span-2"><label className="label">{ar ? "الوصف (عربي)" : "Description (Arabic)"}</label><textarea name="description_ar" defaultValue={s.description_ar ?? ""} rows={4} className="input" /></div>
        <div className="sm:col-span-2"><label className="label">Description (EN)</label><textarea name="description_en" defaultValue={s.description_en ?? ""} rows={4} className="input" dir="ltr" /></div>
        <div><button className="btn-primary">{t.common.save}</button></div>
      </form>
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">{t.salon.gallery} ({media.length}/40)</h2>
        <form action={uploadMedia} className="mb-4 flex flex-wrap items-center gap-2">
          <input type="file" name="files" multiple accept="image/jpeg,image/png,image/webp,video/mp4" className="input max-w-sm" required />
          <button className="btn-primary btn-sm">{ar ? "رفع" : "Upload"}</button>
          <span className="text-xs text-muted">JPG/PNG/WEBP ≤ 5MB · MP4 ≤ 50MB</span>
        </form>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {media.map((m) => (
            <div key={m.id} className="relative aspect-square overflow-hidden rounded-xl">
              {m.kind === "video" ? <video src={m.url} className="h-full w-full object-cover" /> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
              <form action={deleteMedia} className="absolute end-1 top-1"><input type="hidden" name="id" value={m.id} /><button className="rounded-full bg-white/90 px-2 text-red-700">✕</button></form>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
