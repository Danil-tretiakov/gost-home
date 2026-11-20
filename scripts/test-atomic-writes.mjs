// Atomicity of content/status/settings writes on a real local D1 (Miniflare, same SQLite engine as production D1).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const out = await build({ entryPoints: ['lib/content-writes.ts'], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' });
const tmp = new URL('../node_modules/.cache/content-writes.test.mjs', import.meta.url);
(await import('node:fs')).mkdirSync(new URL('.', tmp), { recursive: true });
(await import('node:fs')).writeFileSync(tmp, out.outputFiles[0].text);
const W = await import(tmp.href);

const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("") } }', d1Databases: ['DB'] });
const d1 = await mf.getD1Database('DB');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
  for (const stmt of readFileSync('drizzle/' + f, 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) await d1.prepare(stmt).run();
}
const db = d1;
const one = async (q, ...b) => (await d1.prepare(q).bind(...b).first());
const count = async (q, ...b) => (await one(q, ...b)).n;

await d1.prepare(`INSERT INTO shoots (id,title,date,time,duration,format,status,project,location,participants,notes,preparation,revision)
  VALUES ('11111111-1111-4111-8111-111111111111','s','2026-11-06','11:00',60,'Reels','Снято','','','["Юля","Андрей"]','','',1)`).run();
const id = '22222222-2222-4222-8222-222222222222';
const fields = { type: 'reel', title: 'Обзор', description: '', primaryMember: 'Юля', shootId: '11111111-1111-4111-8111-111111111111', places: '', plannedPublishDate: '2026-11-27', driveUrl: '' };

// Create: everything or nothing.
await W.applyContentCreate(db, { id, ...fields, productionStatus: 'planned', actor: 'T' }, ['Андрей']);
assert.equal(await count('SELECT count(*) n FROM content_items'), 1);
assert.equal(await count('SELECT count(*) n FROM content_participants'), 1);
assert.equal(await count('SELECT count(*) n FROM status_events'), 1);
assert.equal(await count("SELECT count(*) n FROM audit_events WHERE action='create'"), 1);
await assert.rejects(W.applyContentCreate(db, { id, ...fields, productionStatus: 'planned', actor: 'T' }, ['Андрей']), 'duplicate id fails');
assert.equal(await count('SELECT count(*) n FROM status_events'), 1, 'failed duplicate create left no history');
assert.equal(await count('SELECT count(*) n FROM audit_events'), 1, 'failed duplicate create left no audit');

// Status: applied together.
assert.equal(await W.applyStatusChange(db, { id, revision: 1, from: 'planned', to: 'shot', publishedAt: null, comment: '', actor: 'T', previousPublishedAt: null }), true);
let row = await one('SELECT production_status s, revision r FROM content_items WHERE id=?', id);
assert.deepEqual([row.s, row.r], ['shot', 2]);
assert.equal(await count('SELECT count(*) n FROM status_events'), 2);
assert.equal(await count("SELECT count(*) n FROM audit_events WHERE action='status'"), 1);

// Stale revision and wrong source status: nothing written anywhere.
assert.equal(await W.applyStatusChange(db, { id, revision: 1, from: 'shot', to: 'editing', publishedAt: null, comment: '', actor: 'T', previousPublishedAt: null }), false);
assert.equal(await W.applyStatusChange(db, { id, revision: 2, from: 'planned', to: 'shot', publishedAt: null, comment: '', actor: 'T', previousPublishedAt: null }), false);
assert.equal(await count('SELECT count(*) n FROM status_events'), 2);
assert.equal(await count('SELECT count(*) n FROM audit_events'), 2);

// Failure of the history insert rolls back the status change and the audit row.
await d1.prepare('ALTER TABLE status_events RENAME TO status_events_off').run();
await assert.rejects(W.applyStatusChange(db, { id, revision: 2, from: 'shot', to: 'editing', publishedAt: null, comment: '', actor: 'T', previousPublishedAt: null }));
row = await one('SELECT production_status s, revision r FROM content_items WHERE id=?', id);
assert.deepEqual([row.s, row.r], ['shot', 2], 'status unchanged after failed batch');
assert.equal(await count('SELECT count(*) n FROM audit_events'), 2, 'no orphan audit row');
await d1.prepare('ALTER TABLE status_events_off RENAME TO status_events').run();

// Update: fields, participants and audit together; stale revision changes nothing.
assert.equal(await W.applyContentUpdate(db, { id, revision: 2, fields: { ...fields, title: 'Обзор 2' }, participants: ['Андрей', 'Лиза'], actor: 'T', before: {} }), true);
assert.equal((await one('SELECT title t FROM content_items WHERE id=?', id)).t, 'Обзор 2');
assert.equal(await count('SELECT count(*) n FROM content_participants WHERE content_id=?', id), 2);
assert.equal(await W.applyContentUpdate(db, { id, revision: 2, fields: { ...fields, title: 'Устарело' }, participants: [], actor: 'T', before: {} }), false);
assert.equal((await one('SELECT title t FROM content_items WHERE id=?', id)).t, 'Обзор 2');
assert.equal(await count('SELECT count(*) n FROM content_participants WHERE content_id=?', id), 2, 'stale update did not clear participants');
// A failing participant insert (unknown table) rolls back the field edit too.
await d1.prepare('ALTER TABLE content_participants RENAME TO cp_off').run();
await assert.rejects(W.applyContentUpdate(db, { id, revision: 3, fields: { ...fields, title: 'Не должно сохраниться' }, participants: ['Лиза'], actor: 'T', before: {} }));
assert.equal((await one('SELECT title t, revision r FROM content_items WHERE id=?', id)).t, 'Обзор 2');
await d1.prepare('ALTER TABLE cp_off RENAME TO content_participants').run();
assert.equal(await count("SELECT count(*) n FROM audit_events WHERE action='update'"), 1);

// Settings: first save, concurrent first save, guarded update.
assert.equal(await W.applySettingsSave(db, { key: 'plan', value: '{"a":1}', revision: 0, actor: 'T', before: null }), true);
assert.equal(await W.applySettingsSave(db, { key: 'plan', value: '{"a":2}', revision: 0, actor: 'T', before: null }), false);
assert.equal(await W.applySettingsSave(db, { key: 'plan', value: '{"a":3}', revision: 1, actor: 'T', before: '{"a":1}' }), true);
assert.equal(await W.applySettingsSave(db, { key: 'plan', value: '{"a":4}', revision: 1, actor: 'T', before: '{"a":1}' }), false);
assert.equal((await one("SELECT value v, revision r FROM app_settings WHERE key='plan'")).v, '{"a":3}');
assert.equal(await count("SELECT count(*) n FROM audit_events WHERE entity='settings'"), 2, 'audit only for applied saves');

await mf.dispose();
console.log('PASS: create/update/status/settings are single D1 transactions; stale revision writes nothing; a failing history/participant insert rolls back the main change and audit');
