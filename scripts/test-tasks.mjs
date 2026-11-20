// Задачник: validation, filters/overdue in Asia/Bangkok, atomic writes (idempotent create, revision 409, archive/restore), backup.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

async function load(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' });
  const f = new URL(`../node_modules/.cache/${entry.replaceAll('/', '_')}.test.mjs`, import.meta.url);
  mkdirSync(new URL('.', f), { recursive: true }); writeFileSync(f, out.outputFiles[0].text);
  return import(f.href);
}
const T = await load('lib/tasks.ts');
const TW = await load('lib/task-writes.ts');
const B = await load('lib/backup.ts');

/* Validation */
const ok = T.parseTaskInput({ title: '  Купить реквизит ', assignee: 'Данил', dueDate: '2026-11-20', dueTime: '10:30', priority: 'high', status: 'todo' });
assert.equal(ok.ok, true); assert.equal(ok.fields.title, 'Купить реквизит');
assert.equal(T.parseTaskInput({ title: '' }).ok, false);
assert.equal(T.parseTaskInput({ title: 'x', assignee: 'Чужой' }).ok, false, 'only team names or Данил');
assert.equal(T.parseTaskInput({ title: 'x', dueDate: '2026-02-30' }).ok, false, 'invalid date');
assert.equal(T.parseTaskInput({ title: 'x', dueTime: '10:00' }).ok, false, 'time needs a date');
assert.equal(T.parseTaskInput({ title: 'x', status: 'archived' }).ok, false);
assert.equal(T.parseTaskInput({ title: 'x', shootId: 'nope' }).ok, false);
assert.ok(T.TASK_ASSIGNEES.includes('Данил') && T.TASK_ASSIGNEES.includes('Юля'));

/* Overdue and filters (Bangkok = UTC+7). 2026-11-19T17:30Z is 20 Nov 00:30 in Bangkok. */
const base = { notes: '', assignee: null, dueTime: null, priority: 'normal', status: 'todo', shootId: null, contentId: null, completedAt: null, archivedAt: null, archivedBy: null, createdAt: '2026-11-19T00:00:00Z', createdBy: 't', updatedAt: '', updatedBy: '', revision: 1 };
const t = (o) => ({ ...base, id: crypto.randomUUID(), title: 'T', dueDate: null, ...o });
const now = new Date('2026-11-19T17:30:00Z');
assert.equal(T.isOverdue(t({ dueDate: '2026-11-19' }), now), true, 'yesterday in Bangkok is overdue');
assert.equal(T.isOverdue(t({ dueDate: '2026-11-20' }), now), false, 'today without time is not overdue');
assert.equal(T.isOverdue(t({ dueDate: '2026-11-20', dueTime: '00:15' }), now), true, 'today, time passed');
assert.equal(T.isOverdue(t({ dueDate: '2026-11-19', status: 'done' }), now), false, 'done is never overdue');
assert.equal(T.isOverdue(t({ dueDate: '2026-11-19', archivedAt: 'x' }), now), false);
const list = [
  t({ title: 'Свет для съёмки', assignee: 'Марк', dueDate: '2026-11-18', shootId: 's1' }),
  t({ title: 'Монтаж', assignee: 'Данил', dueDate: '2026-11-22', contentId: 'c1', status: 'in_progress' }),
  t({ title: 'Без срока' }),
  t({ title: 'Готово', status: 'done' }),
  t({ title: 'Архивная', archivedAt: '2026-11-19T00:00:00Z' }),
];
const F = { assignee: '', status: '', due: 'all', link: 'all', query: '', archived: false };
assert.equal(T.filterTasks(list, F, now).length, 4, 'archive hidden');
assert.deepEqual(T.filterTasks(list, { ...F, archived: true }, now).map(x => x.title), ['Архивная']);
assert.deepEqual(T.filterTasks(list, { ...F, due: 'overdue' }, now).map(x => x.title), ['Свет для съёмки']);
assert.deepEqual(T.filterTasks(list, { ...F, due: 'week' }, now).map(x => x.title), ['Монтаж']);
assert.deepEqual(T.filterTasks(list, { ...F, due: 'none' }, now).map(x => x.title).sort(), ['Без срока', 'Готово']);
assert.deepEqual(T.filterTasks(list, { ...F, assignee: 'Данил' }, now).map(x => x.title), ['Монтаж']);
assert.equal(T.filterTasks(list, { ...F, assignee: '—' }, now).length, 2);
assert.deepEqual(T.filterTasks(list, { ...F, status: 'open' }, now).map(x => x.title).sort(), ['Без срока', 'Монтаж', 'Свет для съёмки']);
assert.deepEqual(T.filterTasks(list, { ...F, link: 'shoot' }, now).map(x => x.title), ['Свет для съёмки']);
assert.deepEqual(T.filterTasks(list, { ...F, link: 'none' }, now).map(x => x.title).sort(), ['Без срока', 'Готово']);
assert.deepEqual(T.filterTasks(list, { ...F, query: 'свет' }, now).map(x => x.title), ['Свет для съёмки']);
assert.deepEqual(T.filterTasks(list, { ...F, query: 'вилла' }, now, x => x.shootId === 's1' ? 'Вилла Банг Тао' : '').map(x => x.title), ['Свет для съёмки'], 'search by linked title');
assert.equal(T.sortTasks(list, now)[0].title, 'Свет для съёмки', 'overdue first');
assert.deepEqual(T.urgentTasks(list, now).map(x => x.title), ['Свет для съёмки', 'Монтаж'], 'urgent: overdue first, then due within 2 days; no-date normal tasks excluded');

/* Atomic writes on local D1 */
const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("") } }', d1Databases: ['DB'] });
const d1 = await mf.getD1Database('DB');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
  for (const stmt of readFileSync('drizzle/' + f, 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) await d1.prepare(stmt).run();
}
const count = async (q, ...b) => (await d1.prepare(q).bind(...b).first()).n;
const row = async id => d1.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first();
const shootId = '11111111-1111-4111-8111-111111111111';
await d1.prepare(`INSERT INTO shoots (id,title,date,time,duration,format,status,project,location,participants,notes,preparation,revision) VALUES (?,'s','2026-11-20','11:00',60,'Reels','Запланировано','','','["Юля"]','','',1)`).bind(shootId).run();
const id = crypto.randomUUID();
const fields = { ...ok.fields, shootId };
assert.equal(await TW.applyTaskCreate(d1, { id, ...fields, actor: 'Д' }), 'created');
assert.equal(await TW.applyTaskCreate(d1, { id, ...fields, title: 'дубль', actor: 'Д' }), 'exists', 'retry is idempotent');
assert.equal(await count('SELECT count(*) n FROM tasks'), 1);
assert.equal((await row(id)).title, 'Купить реквизит', 'retry did not overwrite');
assert.equal(await count("SELECT count(*) n FROM audit_events WHERE entity='task'"), 1, 'one audit for one create');
assert.equal(await TW.applyTaskUpdate(d1, { id, revision: 1, fields: { ...fields, status: 'done' }, actor: 'Д', before: null }), true);
let r = await row(id); assert.equal(r.status, 'done'); assert.ok(r.completed_at); assert.equal(r.revision, 2);
assert.equal(await TW.applyTaskUpdate(d1, { id, revision: 1, fields: { ...fields, title: 'чужая правка' }, actor: 'Ю', before: null }), false, 'stale revision → 409');
assert.equal((await row(id)).title, 'Купить реквизит'); assert.equal(await count("SELECT count(*) n FROM audit_events WHERE entity='task'"), 2, 'stale edit wrote no audit');
await TW.applyTaskUpdate(d1, { id, revision: 2, fields: { ...fields, status: 'in_progress' }, actor: 'Д', before: null });
assert.equal((await row(id)).completed_at, null, 'leaving done clears completion');
assert.equal(await TW.applyTaskArchive(d1, { id, revision: 3, archive: true, actor: 'Д' }), true);
assert.ok((await row(id)).archived_at);
assert.equal(await TW.applyTaskUpdate(d1, { id, revision: 4, fields, actor: 'Д', before: null }), false, 'archived task is read-only');
assert.equal(await TW.applyTaskArchive(d1, { id, revision: 4, archive: true, actor: 'Д' }), false, 'double archive refused');
assert.equal(await TW.applyTaskArchive(d1, { id, revision: 4, archive: false, actor: 'Д' }), true);
r = await row(id); assert.equal(r.archived_at, null); assert.equal(r.title, 'Купить реквизит'); assert.equal(r.revision, 5);
await assert.rejects(TW.applyTaskCreate(d1, { id: crypto.randomUUID(), ...fields, shootId: '22222222-2222-4222-8222-222222222222', actor: 'Д' }), 'FK: unknown shoot fails');
assert.equal(await count("SELECT count(*) n FROM audit_events WHERE entity='task'"), 5, 'create, 2 edits, archive, restore; the failed create left no audit');

/* Backup: tasks included, restore additive and never overwrites */
assert.ok(B.BACKUP_TABLES.findIndex(t => t.name === 'tasks') > B.BACKUP_TABLES.findIndex(t => t.name === 'content_items'));
const exportRows = (await d1.prepare('SELECT * FROM tasks').all()).results;
const changedCopy = exportRows.map(x => ({ ...x, title: 'ИЗМЕНЕНО В ФАЙЛЕ' }));
const extra = { ...exportRows[0], id: crypto.randomUUID(), title: 'Новая из копии' };
const nb = B.normalizeBackup({ format: 'gost-home-backup', version: 1, tables: { tasks: [...changedCopy, extra] } });
const cols = { tasks: (await d1.prepare('PRAGMA table_info(tasks)').all()).results.map(c => c.name) };
const existing = { tasks: new Set(exportRows.map(x => B.keyOf(['id'], x))) };
const { inserts, report } = B.planRestore(nb.tables, cols, existing);
assert.deepEqual([report[0].existing, report[0].toInsert], [1, 1]);
await d1.batch(inserts.map(i => d1.prepare(`INSERT OR IGNORE INTO ${i.table} (${i.cols.join(', ')}) VALUES (${i.cols.map(() => '?').join(', ')})`).bind(...i.values)));
assert.equal((await row(id)).title, 'Купить реквизит', 'restore never overwrites an existing task');
assert.equal(await count('SELECT count(*) n FROM tasks'), 2);
// Deleting a shoot keeps the task (link is cleared, nothing lost).
await d1.prepare('PRAGMA foreign_keys = ON').run();
await d1.prepare('DELETE FROM shoots WHERE id=?').bind(shootId).run();
assert.equal(await count('SELECT count(*) n FROM tasks'), 2); assert.equal((await row(id)).shoot_id, null);
await mf.dispose();
console.log('PASS: task validation, Bangkok overdue/filters/search/sort/urgent, idempotent create, revision 409, archive/restore, FK, backup additive');
