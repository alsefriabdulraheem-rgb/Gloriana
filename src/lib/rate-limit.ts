import { sql } from "./db";
import { AppError } from "./errors";

/** Fixed-window rate limiter backed by Postgres so it works across multiple server instances. */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const [row] = await sql<{ count: number }[]>`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
    returning count`;
  if (row.count > limit) throw new AppError("rate_limited", "Too many requests, please try again later", 429);
}
