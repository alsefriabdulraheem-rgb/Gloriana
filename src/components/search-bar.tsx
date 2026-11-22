import { CITIES, type Dict } from "@/lib/i18n/dict";
import type { Locale } from "@/lib/i18n";

export function SearchBar({ t, locale, defaults = {} }: { t: Dict; locale: Locale; defaults?: Record<string, string | undefined> }) {
  return (
    <form action="/search" method="get" className="grid gap-2 rounded-2xl bg-white p-2 shadow-xl shadow-plum-900/10 sm:grid-cols-[1.6fr_1fr_1fr_auto]">
      <label className="sr-only" htmlFor="q">{t.search.placeholder}</label>
      <input id="q" name="q" defaultValue={defaults.q} placeholder={t.search.placeholder} className="input border-0 bg-plum-50/60" />
      <select name="city" defaultValue={defaults.city ?? ""} className="input border-0 bg-plum-50/60" aria-label={t.search.city}>
        <option value="">{t.search.anyCity}</option>
        {CITIES.map((c) => <option key={c.id} value={c.id}>{c[locale]}</option>)}
      </select>
      <input name="neighborhood" defaultValue={defaults.neighborhood} placeholder={t.search.neighborhood} className="input border-0 bg-plum-50/60" />
      {defaults.audience && <input type="hidden" name="audience" value={defaults.audience} />}
      <button className="btn-primary px-8">{t.search.button}</button>
    </form>
  );
}
