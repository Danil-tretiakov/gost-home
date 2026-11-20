// Turns a shoots backup (GET /api/shoots array, or the calendar's {version,shoots} export) into SQL for a LOCAL D1 restore.
// Usage: node scripts/legacy-shoots-to-sql.mjs <backup.json> <out.sql>
// Rows keep their original id and revision; INSERT OR IGNORE never overwrites an existing row. Prints a migration report.
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('Usage: node scripts/legacy-shoots-to-sql.mjs <backup.json> <out.sql>'); process.exit(2); }
const raw = JSON.parse(readFileSync(input, 'utf8'));
const rows = Array.isArray(raw) ? raw : raw?.shoots;
if (!Array.isArray(rows)) throw new Error('Backup must be an array of shoots or {shoots: [...]}');
const q = v => `'${String(v).replaceAll("'", "''")}'`;
const report = { total: rows.length, imported: 0, skipped: [], review: [] };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const sql = [];
for (const r of rows) {
  const problems = [];
  if (typeof r.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(r.id)) problems.push('id');
  if (!r.title || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !/^\d{2}:\d{2}$/.test(r.time) || !Number.isInteger(r.duration)) problems.push('обязательные поля');
  if (!Array.isArray(r.participants)) problems.push('participants');
  if (problems.length) { report.skipped.push({ id: r.id, title: r.title, problems }); continue; }
  sql.push(`INSERT OR IGNORE INTO shoots (id,title,date,time,duration,format,status,project,location,participants,notes,preparation,revision) VALUES (${[
    q(r.id), q(r.title), q(r.date), q(r.time), r.duration, q(r.format ?? 'Reels'), q(r.status ?? 'Запланировано'), q(r.project ?? ''), q(r.location ?? ''),
    q(JSON.stringify(r.participants)), q(r.notes ?? ''), q(r.preparation ?? ''), Number.isInteger(r.revision) ? r.revision : 1].join(',')});`);
  report.imported++;
  if (r.status === 'Запланировано' && r.date < today) report.review.push(`${r.date} «${r.title}»: дата прошла, статус всё ещё «Запланировано»`);
}
writeFileSync(output, sql.join('\n') + '\n');
console.log(JSON.stringify(report, null, 2));
