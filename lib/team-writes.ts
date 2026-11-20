import { q, type D1 } from './content-writes';
import type { TeamFields } from './team';

/*
 * Team access writes: one D1 batch each, change + audit together, guarded by revision.
 * New entries always start as 'invited' (no access). Changing the email drops the "seen" marks and the
 * active status, so access is never carried over to a different address.
 */
const json = (v: unknown) => JSON.stringify(v);
function changed(r: unknown) { return ((r as { meta?: { changes?: number } }).meta?.changes ?? 0) === 1; }

export async function applyMemberCreate(db: D1, m: TeamFields & { id: string; actor: string }, now = new Date().toISOString()): Promise<'created' | 'exists'> {
  const sql = q(db);
  const r = await db.batch([
    sql`INSERT INTO team_members (id, email, display_name, member_name, role, finance, status, note, first_seen_at, last_seen_at, created_at, created_by, updated_at, updated_by, revision)
      VALUES (${m.id}, ${m.email}, ${m.displayName}, ${m.memberName}, ${m.role}, ${m.finance ? 1 : 0}, 'invited', ${m.note}, NULL, NULL, ${now}, ${m.actor}, ${now}, ${m.actor}, 1)
      ON CONFLICT(id) DO NOTHING`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${crypto.randomUUID()}, 'team', ${m.id}, 'create', ${m.actor}, ${now}, NULL, ${json({ ...m, actor: undefined, status: 'invited' })} WHERE changes() = 1`,
  ]);
  return changed(r[0]) ? 'created' : 'exists';
}

export async function applyMemberUpdate(db: D1, a: { id: string; revision: number; fields: TeamFields; actor: string; before: unknown }, now = new Date().toISOString()): Promise<boolean> {
  const sql = q(db);
  const f = a.fields;
  const r = await db.batch([
    sql`UPDATE team_members SET
      status = CASE WHEN email IS ${f.email} THEN status WHEN status = 'active' THEN 'invited' ELSE status END,
      first_seen_at = CASE WHEN email IS ${f.email} THEN first_seen_at ELSE NULL END,
      last_seen_at = CASE WHEN email IS ${f.email} THEN last_seen_at ELSE NULL END,
      email = ${f.email}, display_name = ${f.displayName}, member_name = ${f.memberName}, role = ${f.role}, finance = ${f.finance ? 1 : 0}, note = ${f.note},
      updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1
      WHERE id = ${a.id} AND revision = ${a.revision}`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${crypto.randomUUID()}, 'team', ${a.id}, 'update', ${a.actor}, ${now}, ${json(a.before)}, ${json({ ...f, revision: a.revision + 1 })} WHERE changes() = 1`,
  ]);
  return changed(r[0]);
}

/** Activation needs a stored email: the role then applies only when Sites signs someone in with exactly that address. */
export async function applyMemberStatus(db: D1, a: { id: string; revision: number; status: 'active' | 'disabled'; actor: string }, now = new Date().toISOString()): Promise<boolean> {
  const sql = q(db);
  const r = await db.batch([
    sql`UPDATE team_members SET status = ${a.status}, updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1
      WHERE id = ${a.id} AND revision = ${a.revision} AND (${a.status} = 'disabled' OR email IS NOT NULL)`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${crypto.randomUUID()}, 'team', ${a.id}, ${a.status === 'active' ? 'activate' : 'disable'}, ${a.actor}, ${now}, NULL, ${json({ status: a.status, revision: a.revision + 1 })} WHERE changes() = 1`,
  ]);
  return changed(r[0]);
}
