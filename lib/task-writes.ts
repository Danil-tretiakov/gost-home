import { q, type D1 } from './content-writes';
import type { TaskFields } from './tasks';

/*
 * Task writes. Each is ONE D1 batch (one transaction): the change and its audit row land together.
 * Create is idempotent by the client-generated id; edits, archive and restore are guarded by revision.
 */
const json = (v: unknown) => JSON.stringify(v);
const completedAt = (status: string, now: string) => (status === 'done' ? now : null);

/** Returns 'created' or 'exists' (same id already stored: a retried request). */
export async function applyTaskCreate(db: D1, t: TaskFields & { id: string; actor: string }, now = new Date().toISOString()): Promise<'created' | 'exists'> {
  const sql = q(db);
  const r = await db.batch([
    sql`INSERT INTO tasks (id, title, notes, assignee, due_date, due_time, priority, status, shoot_id, content_id, folder_id, completed_at, archived_at, archived_by, created_at, created_by, updated_at, updated_by, revision)
      VALUES (${t.id}, ${t.title}, ${t.notes}, ${t.assignee}, ${t.dueDate}, ${t.dueTime}, ${t.priority}, ${t.status}, ${t.shootId}, ${t.contentId}, ${t.folderId}, ${completedAt(t.status, now)}, NULL, NULL, ${now}, ${t.actor}, ${now}, ${t.actor}, 1)
      ON CONFLICT(id) DO NOTHING`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${crypto.randomUUID()}, 'task', ${t.id}, 'create', ${t.actor}, ${now}, NULL, ${json({ ...t, actor: undefined })} WHERE changes() = 1`,
  ]);
  return changed(r[0]) ? 'created' : 'exists';
}

/** Full edit including status. completed_at is set when the task becomes done and cleared when it leaves done. */
export async function applyTaskUpdate(db: D1, a: { id: string; revision: number; fields: TaskFields; actor: string; before: unknown }, now = new Date().toISOString()): Promise<boolean> {
  const sql = q(db);
  const f = a.fields;
  const r = await db.batch([
    sql`UPDATE tasks SET title = ${f.title}, notes = ${f.notes}, assignee = ${f.assignee}, due_date = ${f.dueDate}, due_time = ${f.dueTime}, priority = ${f.priority},
      completed_at = CASE WHEN ${f.status} = 'done' THEN COALESCE(CASE WHEN status = 'done' THEN completed_at END, ${now}) ELSE NULL END,
      status = ${f.status}, shoot_id = ${f.shootId}, content_id = ${f.contentId}, folder_id = ${f.folderId}, updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1
      WHERE id = ${a.id} AND revision = ${a.revision} AND archived_at IS NULL`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${crypto.randomUUID()}, 'task', ${a.id}, 'update', ${a.actor}, ${now}, ${json(a.before)}, ${json({ ...f, revision: a.revision + 1 })} WHERE changes() = 1`,
  ]);
  return changed(r[0]);
}

/** Archive hides a task from the board; restore brings it back unchanged. Nothing is deleted. */
export async function applyTaskArchive(db: D1, a: { id: string; revision: number; archive: boolean; actor: string }, now = new Date().toISOString()): Promise<boolean> {
  const sql = q(db);
  const r = await db.batch([
    a.archive
      ? sql`UPDATE tasks SET archived_at = ${now}, archived_by = ${a.actor}, updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1 WHERE id = ${a.id} AND revision = ${a.revision} AND archived_at IS NULL`
      : sql`UPDATE tasks SET archived_at = NULL, archived_by = NULL, updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1 WHERE id = ${a.id} AND revision = ${a.revision} AND archived_at IS NOT NULL`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${crypto.randomUUID()}, 'task', ${a.id}, ${a.archive ? 'archive' : 'restore'}, ${a.actor}, ${now}, NULL, ${json({ revision: a.revision + 1 })} WHERE changes() = 1`,
  ]);
  return changed(r[0]);
}

function changed(r: unknown) { return ((r as { meta?: { changes?: number } }).meta?.changes ?? 0) === 1; }

/** Folder writes: create, rename, reorder and archive. Each is one batch with its audit row; edits are guarded by revision. */
export async function applyFolderCreate(db: D1, f: { id: string; name: string; actor: string }, now = new Date().toISOString()): Promise<'created' | 'exists'> {
  const sql = q(db);
  const r = await db.batch([
    sql`INSERT INTO task_folders (id, name, sort, archived_at, created_at, created_by, updated_at, updated_by, revision)
      VALUES (${f.id}, ${f.name}, COALESCE((SELECT MAX(sort) + 1 FROM task_folders), 0), NULL, ${now}, ${f.actor}, ${now}, ${f.actor}, 1) ON CONFLICT(id) DO NOTHING`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${crypto.randomUUID()}, 'task_folder', ${f.id}, 'create', ${f.actor}, ${now}, NULL, ${json({ name: f.name })} WHERE changes() = 1`,
  ]);
  return changed(r[0]) ? 'created' : 'exists';
}
export async function applyFolderUpdate(db: D1, a: { id: string; revision: number; name?: string; archive?: boolean; actor: string }, now = new Date().toISOString()): Promise<boolean> {
  const sql = q(db);
  const update = a.name !== undefined
    ? sql`UPDATE task_folders SET name = ${a.name}, updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1 WHERE id = ${a.id} AND revision = ${a.revision}`
    : a.archive
      ? sql`UPDATE task_folders SET archived_at = ${now}, updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1 WHERE id = ${a.id} AND revision = ${a.revision}`
      : sql`UPDATE task_folders SET archived_at = NULL, updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1 WHERE id = ${a.id} AND revision = ${a.revision}`;
  const action = a.name !== undefined ? 'rename' : a.archive ? 'archive' : 'restore';
  const r = await db.batch([
    update,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${crypto.randomUUID()}, 'task_folder', ${a.id}, ${action}, ${a.actor}, ${now}, NULL, ${json({ name: a.name, revision: a.revision + 1 })} WHERE changes() = 1`,
  ]);
  return changed(r[0]);
}
