/** Minimal slice of the Cloudflare D1 binding used here (env.DB in production, Miniflare in tests). */
type Stmt = { bind(...values: unknown[]): Stmt };
export type D1 = { prepare(query: string): Stmt; batch(statements: Stmt[]): Promise<unknown[]> };
type Db = D1;
/** Tagged template → prepared statement with positional bindings. */
export const q = (db: D1) => (strings: TemplateStringsArray, ...values: unknown[]) => {
  const parts: string[] = [];
  const binds: unknown[] = [];
  strings.forEach((str, i) => {
    parts.push(str);
    if (i < values.length) {
      const v = values[i];
      if (v instanceof Frag) { parts.push(v.text); binds.push(...v.binds); } else { parts.push('?'); binds.push(v ?? null); }
    }
  });
  return db.prepare(parts.join('')).bind(...binds);
};
class Frag { constructor(public text: string, public binds: unknown[]) {} }
const guardOn = (auditId: string) => new Frag('EXISTS (SELECT 1 FROM audit_events WHERE id = ?)', [auditId]);

/*
 * Atomic writes. Each function issues ONE D1 batch, which D1 runs as a single transaction:
 * if any statement fails, none of them is applied.
 *
 * The first statement is the revision-guarded change. The audit row is inserted only when that change
 * actually modified a row (`changes() = 1` refers to the immediately preceding statement). Every later
 * statement is conditioned on that audit row existing (its id is a fresh UUID), so a stale revision writes
 * nothing at all: no status, no history, no audit, no participant changes.
 */

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

export type StatusChange = {
  id: string; revision: number; from: string; to: string; publishedAt: string | null; comment: string; actor: string;
  previousPublishedAt: string | null;
  /** Edit version the decision refers to (sent for feedback / approved / returned). */
  versionId?: string | null;
};

/** Returns true when the change was applied, false when the revision was stale. Throws on database errors (nothing applied). */
export async function applyStatusChange(db: Db, c: StatusChange, now = new Date().toISOString()): Promise<boolean> {
  const sql = q(db);
  const auditId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const results = await db.batch([
    sql`UPDATE content_items SET production_status = ${c.to}, published_at = ${c.publishedAt}, updated_at = ${now}, updated_by = ${c.actor}, revision = revision + 1
      WHERE id = ${c.id} AND revision = ${c.revision} AND production_status = ${c.from}`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${auditId}, 'content', ${c.id}, 'status', ${c.actor}, ${now},
        ${json({ productionStatus: c.from, publishedAt: c.previousPublishedAt, revision: c.revision })},
        ${json({ productionStatus: c.to, publishedAt: c.publishedAt, comment: c.comment, revision: c.revision + 1 })}
      WHERE changes() = 1`,
    sql`INSERT INTO status_events (id, content_id, from_status, to_status, version_id, comment, actor, at)
      SELECT ${eventId}, ${c.id}, ${c.from}, ${c.to}, ${c.versionId ?? null}, ${c.comment}, ${c.actor}, ${now}
      WHERE EXISTS (SELECT 1 FROM audit_events WHERE id = ${auditId})`,
    // Decisions also land in the feedback thread of the version, so the history of comments stays in one place.
    ...((c.to === 'approved' || c.to === 'changes_requested') && c.from === 'awaiting_feedback' ? [
      sql`INSERT INTO feedback_comments (id, content_id, version_id, kind, body, actor, at)
        SELECT ${crypto.randomUUID()}, ${c.id}, ${c.versionId ?? null}, ${c.to}, ${c.comment}, ${c.actor}, ${now}
        WHERE ${guardOn(auditId)}`,
    ] : []),
  ]);
  return changed(results[0]);
}

export type ContentFields = {
  type: string; title: string; description: string; primaryMember: string; shootId: string | null; places: string;
  plannedPublishDate: string | null; driveUrl: string; responsible?: string | null;
};

/** Edits fields and replaces participants atomically. Returns false on a stale revision (nothing written). */
export async function applyContentUpdate(db: Db, args: {
  id: string; revision: number; fields: ContentFields; participants: string[]; actor: string; before: unknown;
}, now = new Date().toISOString()): Promise<boolean> {
  const sql = q(db);
  const { id, revision, fields: f, participants, actor } = args;
  const auditId = crypto.randomUUID();
  const guard = guardOn(auditId);
  const results = await db.batch([
    sql`UPDATE content_items SET type = ${f.type}, title = ${f.title}, description = ${f.description}, primary_member = ${f.primaryMember},
      shoot_id = ${f.shootId}, places = ${f.places}, planned_publish_date = ${f.plannedPublishDate}, drive_url = ${f.driveUrl},
      responsible = ${f.responsible ?? null}, updated_at = ${now}, updated_by = ${actor}, revision = revision + 1
      WHERE id = ${id} AND revision = ${revision}`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${auditId}, 'content', ${id}, 'update', ${actor}, ${now}, ${json(args.before)}, ${json({ ...f, participants, revision: revision + 1 })}
      WHERE changes() = 1`,
    sql`DELETE FROM content_participants WHERE content_id = ${id} AND ${guard}`,
    ...participants.map(member => sql`INSERT INTO content_participants (content_id, member) SELECT ${id}, ${member} WHERE ${guard}`),
  ]);
  return changed(results[0]);
}

/** Creates an item with participants, its first history entry and audit in one transaction. */
export async function applyContentCreate(db: Db, row: ContentFields & {
  id: string; productionStatus: string; actor: string;
}, participants: string[], now = new Date().toISOString()) {
  const sql = q(db);
  await db.batch([
    sql`INSERT INTO content_items (id, type, title, description, primary_member, shoot_id, places, planned_publish_date, published_at,
      production_status, drive_url, responsible, created_at, created_by, updated_at, updated_by, revision)
      VALUES (${row.id}, ${row.type}, ${row.title}, ${row.description}, ${row.primaryMember}, ${row.shootId}, ${row.places}, ${row.plannedPublishDate}, NULL,
      ${row.productionStatus}, ${row.driveUrl}, ${row.responsible ?? null}, ${now}, ${row.actor}, ${now}, ${row.actor}, 1)`,
    ...participants.map(member => sql`INSERT INTO content_participants (content_id, member) VALUES (${row.id}, ${member})`),
    sql`INSERT INTO status_events (id, content_id, from_status, to_status, comment, actor, at)
      VALUES (${crypto.randomUUID()}, ${row.id}, NULL, ${row.productionStatus}, 'Создан', ${row.actor}, ${now})`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      VALUES (${crypto.randomUUID()}, 'content', ${row.id}, 'create', ${row.actor}, ${now}, NULL, ${json({ ...row, participants })})`,
  ]);
}

/** Saves a settings value with optimistic revision (0 = first save). Returns false when stale. */
export async function applySettingsSave(db: Db, args: { key: string; value: string; revision: number; actor: string; before: string | null }, now = new Date().toISOString()): Promise<boolean> {
  const sql = q(db);
  const auditId = crypto.randomUUID();
  const write = args.revision === 0
    ? sql`INSERT INTO app_settings (key, value, updated_at, updated_by, revision) VALUES (${args.key}, ${args.value}, ${now}, ${args.actor}, 1)
        ON CONFLICT(key) DO NOTHING`
    : sql`UPDATE app_settings SET value = ${args.value}, updated_at = ${now}, updated_by = ${args.actor}, revision = revision + 1
        WHERE key = ${args.key} AND revision = ${args.revision}`;
  const results = await db.batch([
    write,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${auditId}, 'settings', ${args.key}, 'update', ${args.actor}, ${now}, ${args.before}, ${args.value} WHERE changes() = 1`,
  ]);
  return changed(results[0]);
}

function changed(result: unknown): boolean {
  const meta = (result as { meta?: { changes?: number } } | undefined)?.meta;
  return (meta?.changes ?? 0) === 1;
}

/** Adds edit version N+1 and mirrors its link into the item, guarded by the item revision. */
export async function applyAddVersion(db: Db, v: { contentId: string; revision: number; driveUrl: string; note: string; actor: string }, now = new Date().toISOString()): Promise<string | null> {
  const sql = q(db);
  const auditId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const results = await db.batch([
    sql`UPDATE content_items SET drive_url = ${v.driveUrl}, updated_at = ${now}, updated_by = ${v.actor}, revision = revision + 1
      WHERE id = ${v.contentId} AND revision = ${v.revision}`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      SELECT ${auditId}, 'content', ${v.contentId}, 'version', ${v.actor}, ${now}, NULL, ${json({ versionId, driveUrl: v.driveUrl, note: v.note })} WHERE changes() = 1`,
    sql`INSERT INTO edit_versions (id, content_id, number, drive_url, note, created_at, created_by)
      SELECT ${versionId}, ${v.contentId}, (SELECT COALESCE(MAX(number), 0) + 1 FROM edit_versions WHERE content_id = ${v.contentId}), ${v.driveUrl}, ${v.note}, ${now}, ${v.actor}
      WHERE ${guardOn(auditId)}`,
  ]);
  return changed(results[0]) ? versionId : null;
}

/** A comment on an item (optionally on a version). kind='changes_requested' flips review-turn to the author without moving productionStatus (see lib/review-turn.ts). */
export async function applyComment(db: Db, c: { contentId: string; versionId: string | null; body: string; actor: string; kind?: 'comment' | 'changes_requested' }, now = new Date().toISOString()) {
  const sql = q(db);
  const id = crypto.randomUUID();
  const kind = c.kind ?? 'comment';
  await db.batch([
    sql`INSERT INTO feedback_comments (id, content_id, version_id, kind, body, actor, at) VALUES (${id}, ${c.contentId}, ${c.versionId}, ${kind}, ${c.body}, ${c.actor}, ${now})`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) VALUES (${crypto.randomUUID()}, 'content', ${c.contentId}, 'comment', ${c.actor}, ${now}, NULL, ${json({ commentId: id, versionId: c.versionId, kind })})`,
  ]);
  return id;
}

/**
 * Applies an autoplan in one transaction: dates for bank items (revision-guarded, must still be undated) and new
 * planned slots. If ANY assignment is stale the final audit insert gets a NULL id, which violates NOT NULL and
 * rolls the whole batch back.
 */
export async function applyAutoplan(db: Db, a: {
  month: string; actor: string;
  assignments: { id: string; revision: number; date: string }[];
  newSlots: { id: string; member: string; date: string; title: string }[];
}, now = new Date().toISOString()) {
  const sql = q(db);
  const ids = a.assignments.map(x => x.id);
  const inList = ids.length ? new Frag(ids.map(() => '?').join(','), ids) : new Frag("''", []);
  await db.batch([
    ...a.assignments.map(x => sql`UPDATE content_items SET planned_publish_date = ${x.date}, updated_at = ${now}, updated_by = ${a.actor}, revision = revision + 1
      WHERE id = ${x.id} AND revision = ${x.revision} AND planned_publish_date IS NULL AND type = 'reel'`),
    ...a.newSlots.flatMap(s => [
      sql`INSERT INTO content_items (id, type, title, description, primary_member, shoot_id, places, planned_publish_date, published_at, production_status, drive_url, created_at, created_by, updated_at, updated_by, revision)
        VALUES (${s.id}, 'reel', ${s.title}, 'Слот из автоплана: тема ещё не выбрана.', ${s.member}, NULL, '', ${s.date}, NULL, 'planned', '', ${now}, ${a.actor}, ${now}, ${a.actor}, 1)`,
      sql`INSERT INTO status_events (id, content_id, from_status, to_status, version_id, comment, actor, at) VALUES (${crypto.randomUUID()}, ${s.id}, NULL, 'planned', NULL, 'Слот из автоплана', ${a.actor}, ${now})`,
    ]),
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
      VALUES ((SELECT CASE WHEN (SELECT COUNT(*) FROM content_items WHERE id IN (${inList}) AND updated_at = ${now} AND updated_by = ${a.actor}) = ${ids.length}
        THEN ${crypto.randomUUID()} ELSE NULL END), 'autoplan', ${a.month}, 'apply', ${a.actor}, ${now}, NULL, ${json({ assignments: a.assignments, newSlots: a.newSlots })})`,
  ]);
}
