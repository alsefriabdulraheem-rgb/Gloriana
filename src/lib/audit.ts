import { sql, type Db } from "./db";

export async function audit(
  actorId: string | null | undefined, action: string, entity: string, entityId: string | null,
  data: Record<string, unknown> = {}, db: Db = sql,
) {
  await db`insert into audit_logs (actor_id, action, entity, entity_id, data)
    values (${actorId ?? null}, ${action}, ${entity}, ${entityId}, ${db.json(data as never)})`;
}
