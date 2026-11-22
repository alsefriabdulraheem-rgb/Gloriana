import postgres from "postgres";
import { migrate } from "../scripts/migrate";
import { sql } from "@/lib/db";
import { addDays, todayLocal, weekdayOf } from "@/lib/time";

export async function resetDb() {
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await admin.unsafe("drop schema public cascade; create schema public;");
  await admin.end();
  await migrate(process.env.DATABASE_URL!, false);
}

let n = 0;
export async function makeUser(role = "customer") {
  n++;
  const [u] = await sql<{ id: string }[]>`insert into users (phone, full_name, role, phone_verified_at) values (${"+9665" + String(10000000 + n + Math.floor(Math.random() * 8e7)).slice(0, 8)}, ${"User " + n}, ${role}, now()) returning id`;
  return u.id;
}

/** Salon with 1 branch open 09:00-21:00 every day, 2 employees working 09:00-17:00 with a 13:00-13:30 break, 2 services. */
export async function makeSalon(opts: Partial<{ buffer: number; interval: number; deposit: number; requiresApproval: boolean; lead: number }> = {}) {
  const owner = await makeUser("salon_owner");
  const slug = "salon-" + Math.random().toString(36).slice(2, 10);
  const [s] = await sql<{ id: string }[]>`insert into salons (slug, name_ar, name_en, audience, status, buffer_min, slot_interval_min, deposit_percent, requires_approval, min_lead_min, created_by)
    values (${slug}, 'صالون', 'Salon', 'women', 'approved', ${opts.buffer ?? 0}, ${opts.interval ?? 15}, ${opts.deposit ?? 0}, ${opts.requiresApproval ?? false}, ${opts.lead ?? 0}, ${owner}) returning id`;
  await sql`insert into salon_members (salon_id, user_id, role) values (${s.id}, ${owner}, 'owner')`;
  const [b] = await sql<{ id: string }[]>`insert into salon_branches (salon_id, name_ar, city) values (${s.id}, 'الفرع', 'Riyadh') returning id`;
  for (let d = 0; d < 7; d++) await sql`insert into branch_hours (branch_id, weekday, open_time, close_time) values (${b.id}, ${d}, '09:00', '21:00')`;
  const [cut] = await sql<{ id: string }[]>`insert into services (salon_id, name_ar, duration_min, price_halalas) values (${s.id}, 'قص', 60, 10000) returning id`;
  const [color] = await sql<{ id: string }[]>`insert into services (salon_id, name_ar, duration_min, price_halalas) values (${s.id}, 'صبغة', 30, 5000) returning id`;
  const emps: string[] = [];
  for (const name of ["Noura", "Sara"]) {
    const [e] = await sql<{ id: string }[]>`insert into employees (salon_id, branch_id, display_name_ar) values (${s.id}, ${b.id}, ${name}) returning id`;
    emps.push(e.id);
    for (let d = 0; d < 7; d++) {
      await sql`insert into employee_schedules (employee_id, weekday, start_time, end_time) values (${e.id}, ${d}, '09:00', '17:00')`;
      await sql`insert into employee_breaks (employee_id, weekday, start_time, end_time) values (${e.id}, ${d}, '13:00', '13:30')`;
    }
    await sql`insert into employee_services (employee_id, service_id) values (${e.id}, ${cut.id}), (${e.id}, ${color.id})`;
  }
  return { salonId: s.id, branchId: b.id, owner, services: { cut: cut.id, color: color.id }, employees: emps };
}

export const tomorrow = () => addDays(todayLocal(), 1);
export { weekdayOf };
