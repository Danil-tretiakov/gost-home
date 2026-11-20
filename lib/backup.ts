/**
 * Full export / additive restore. Order follows foreign keys. Secrets are never exported:
 * integration_connections is exported without token/state columns and is never restored.
 */
export const BACKUP_FORMAT = 'gost-home-backup';
export const BACKUP_TABLES: { name: string; pk: string[]; restore: boolean; omit?: string[]; force?: Row }[] = [
  { name: 'shoots', pk: ['id'], restore: true },
  { name: 'content_items', pk: ['id'], restore: true },
  { name: 'content_participants', pk: ['content_id', 'member'], restore: true },
  { name: 'task_folders', pk: ['id'], restore: true },
  { name: 'tasks', pk: ['id'], restore: true },
  { name: 'edit_versions', pk: ['id'], restore: true },
  { name: 'status_events', pk: ['id'], restore: true },
  { name: 'feedback_comments', pk: ['id'], restore: true },
  { name: 'app_settings', pk: ['key'], restore: true },
  { name: 'rate_rules', pk: ['id'], restore: true },
  { name: 'payable_units', pk: ['id'], restore: true },
  { name: 'payments', pk: ['id'], restore: true },
  { name: 'ai_projects', pk: ['id'], restore: true },
  { name: 'ai_assets', pk: ['id'], restore: true },
  { name: 'ai_generation_jobs', pk: ['id'], restore: true },
  { name: 'instagram_media', pk: ['media_id'], restore: true },
  // Access entries come back prepared but switched off: a restore never grants access by itself.
  { name: 'team_members', pk: ['id'], restore: true, force: { status: 'invited', first_seen_at: null, last_seen_at: null } },
  { name: 'notification_reads', pk: ['user_email', 'key'], restore: true },
  { name: 'audit_events', pk: ['id'], restore: true },
  { name: 'integration_connections', pk: ['provider'], restore: false, omit: ['token_cipher', 'oauth_state'] },
];
export type Row = Record<string, unknown>;
export type Backup = { format: string; version: 1; exportedAt: string; tables: Record<string, Row[]> };

const SHOOT_ID = /^[0-9a-f-]{36}$/i;
/** Accepts a full backup, or the old shoots export (array, or {shoots: [...]}) in the API's camelCase shape. */
export function normalizeBackup(input: unknown): { tables: Record<string, Row[]> } | { error: string } {
  if (input && typeof input === 'object' && !Array.isArray(input) && (input as Row).format === BACKUP_FORMAT) {
    const t = (input as Backup).tables;
    if (!t || typeof t !== 'object') return { error: 'В файле нет таблиц' };
    const tables: Record<string, Row[]> = {};
    for (const def of BACKUP_TABLES) {
      const rows = (t as Record<string, unknown>)[def.name];
      if (rows === undefined) continue;
      if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return { error: `Таблица ${def.name} повреждена` };
      if (def.restore) tables[def.name] = rows as Row[];
    }
    return { tables };
  }
  const legacy = Array.isArray(input) ? input : (input as { shoots?: unknown } | null)?.shoots;
  if (Array.isArray(legacy)) {
    const shoots: Row[] = [];
    for (const r of legacy as Row[]) {
      if (typeof r?.id !== 'string' || !SHOOT_ID.test(r.id) || !r.title || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) || !/^\d{2}:\d{2}$/.test(String(r.time)) || !Number.isInteger(r.duration) || !Array.isArray(r.participants)) {
        return { error: `Съёмка ${String(r?.title ?? r?.id ?? '?')} не прошла проверку` };
      }
      shoots.push({ id: r.id, title: r.title, date: r.date, time: r.time, duration: r.duration, format: r.format ?? 'Reels', status: r.status ?? 'Запланировано',
        project: r.project ?? '', location: r.location ?? '', participants: JSON.stringify(r.participants), notes: r.notes ?? '', preparation: r.preparation ?? '',
        revision: Number.isInteger(r.revision) ? r.revision : 1 });
    }
    return { tables: { shoots } };
  }
  return { error: 'Неизвестный формат файла' };
}

export const keyOf = (pk: string[], r: Row) => JSON.stringify(pk.map(k => r[k] ?? null));
const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Plans an additive restore: only rows whose primary key is absent are inserted; existing rows are never touched. */
export function planRestore(tables: Record<string, Row[]>, columns: Record<string, string[]>, existing: Record<string, Set<string>>) {
  const report: { table: string; inFile: number; existing: number; toInsert: number; invalid: number }[] = [];
  const inserts: { table: string; cols: string[]; values: unknown[] }[] = [];
  for (const def of BACKUP_TABLES) {
    const rows = tables[def.name];
    if (!rows || !def.restore) continue;
    const cols = columns[def.name] ?? [];
    const seen = new Set(existing[def.name] ?? []);
    let ex = 0, invalid = 0, add = 0;
    for (const r of rows) {
      const use = cols.filter(c => c in r || (def.force && c in def.force));
      if (def.pk.some(k => r[k] === undefined || r[k] === null) || use.some(c => !scalar(r[c]))) { invalid++; continue; }
      const k = keyOf(def.pk, r);
      if (seen.has(k)) { ex++; continue; }
      seen.add(k); add++;
      inserts.push({ table: def.name, cols: use, values: use.map(c => def.force && c in def.force ? def.force[c] : r[c] ?? null) });
    }
    report.push({ table: def.name, inFile: rows.length, existing: ex, toInsert: add, invalid });
  }
  return { report, inserts };
}
