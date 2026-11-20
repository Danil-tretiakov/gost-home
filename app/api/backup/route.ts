import { getD1 } from '../../../db';
import { forbidden, sameOrigin } from '../../../lib/actor';
import { getAccess } from '../../permissions';

/** Full export contains finance: admin + finance permission (the owner) only. */
async function backupActor() { const a = await getAccess(); return a.caps.admin && a.caps.finance ? a.name ?? a.email : null; }
import { BACKUP_FORMAT, BACKUP_TABLES, keyOf, normalizeBackup, planRestore, type Row } from '../../../lib/backup';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
type Db = { prepare(q: string): { bind(...v: unknown[]): unknown; all<T = Row>(): Promise<{ results: T[] }> }; batch(s: unknown[]): Promise<unknown[]> };

async function columns(db: Db, table: string) {
  const r = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return r.results.map(c => c.name);
}

/** Full export for the owner (includes finance). Tokens and OAuth state are never included. */
export async function GET() {
  if (!(await backupActor())) return forbidden();
  try {
    const db = getD1() as unknown as Db;
    const tables: Record<string, Row[]> = {};
    for (const def of BACKUP_TABLES) {
      const rows = (await db.prepare(`SELECT * FROM ${def.name}`).all()).results;
      tables[def.name] = def.omit ? rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !def.omit!.includes(k)))) : rows;
    }
    const exportedAt = new Date().toISOString();
    return new Response(JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt, tables }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="gost-home-backup-${exportedAt.slice(0, 10)}.json"` },
    });
  } catch { return bad('Не удалось сделать экспорт', 503); }
}

/** Additive restore: {dryRun, data}. Inserts only missing rows in one transaction; never updates or deletes anything. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await backupActor();
  if (!actor) return forbidden(req);
  let x: { dryRun?: unknown; data?: unknown };
  try { x = await req.json(); } catch { return bad('Файл не похож на JSON'); }
  const n = normalizeBackup(x.data);
  if ('error' in n) return bad(n.error);
  try {
    const db = getD1() as unknown as Db;
    const cols: Record<string, string[]> = {}; const existing: Record<string, Set<string>> = {};
    for (const def of BACKUP_TABLES) {
      if (!n.tables[def.name]) continue;
      cols[def.name] = await columns(db, def.name);
      const rows = (await db.prepare(`SELECT ${def.pk.join(', ')} FROM ${def.name}`).all()).results;
      existing[def.name] = new Set(rows.map(r => keyOf(def.pk, r)));
    }
    const { report, inserts } = planRestore(n.tables, cols, existing);
    const shootsBefore = existing.shoots?.size ?? Number(((await db.prepare('SELECT COUNT(*) AS c FROM shoots').all<{ c: number }>()).results[0]?.c) ?? 0);
    if (x.dryRun !== false || !inserts.length) return Response.json({ dryRun: true, report, shootsBefore, toInsert: inserts.length });
    const now = new Date().toISOString();
    await db.batch([
      ...inserts.map(i => db.prepare(`INSERT OR IGNORE INTO ${i.table} (${i.cols.join(', ')}) VALUES (${i.cols.map(() => '?').join(', ')})`).bind(...i.values)),
      db.prepare('INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)')
        .bind(crypto.randomUUID(), 'backup', 'restore', 'restore', actor, now, JSON.stringify(report)),
    ]);
    const shootsAfter = Number((await db.prepare('SELECT COUNT(*) AS c FROM shoots').all<{ c: number }>()).results[0]?.c ?? 0);
    return Response.json({ dryRun: false, report, shootsBefore, shootsAfter, inserted: inserts.length });
  } catch (e) { return bad(`Восстановление не выполнено, ничего не изменено: ${String((e as Error).message).slice(0, 200)}`, 503); }
}
