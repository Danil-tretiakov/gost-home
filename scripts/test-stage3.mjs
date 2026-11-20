// Stage 3+: autoplan, finance, backup planning, provider adapters (pure), plus atomic writes on a local D1 (Miniflare).
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
const { autoplan } = await load('lib/autoplan.ts');
const { DEFAULT_PLAN } = await load('lib/plan-settings.ts');
const F = await load('lib/finance.ts');
const B = await load('lib/backup.ts');
const H = await load('lib/integrations/higgsfield-core.ts');
const I = await load('lib/integrations/instagram-core.ts');
const W = await load('lib/content-writes.ts');
// The 7-shoot backup lives in the gitignored backups/ folder (or pass SHOOTS_BACKUP=<path>).
const SHOOTS_BACKUP = process.env.SHOOTS_BACKUP ?? 'backups/2026-11-19-pre-platform/live-shoots.json';
const legacyShoots = () => JSON.parse(readFileSync(SHOOTS_BACKUP, 'utf8'));

/* Autoplan */
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const item = o => ({ id: uuid(), revision: 1, type: 'reel', title: 'R' + n, primaryMember: 'Юля', plannedPublishDate: null, publishedAt: null, productionStatus: 'planned', ...o });
{
  const empty = autoplan([], '2026-12', '2026-11-19', DEFAULT_PLAN, { fillEmpty: true });
  const by = m => empty.slots.filter(s => s.member === m);
  assert.equal(empty.slots.length, 30, 'empty December gets 30 Reels');
  for (const [m, t] of Object.entries(DEFAULT_PLAN.members)) assert.equal(by(m).length, t, `${m} gets ${t}`);
  const y = by('Юля').map(s => s.date).sort();
  for (let i = 1; i < y.length; i++) assert.equal((Date.parse(y[i]) - Date.parse(y[i - 1])) / 86400000, 3, 'Юля every 3 days');
  const perDay = new Set(empty.slots.map(s => s.date + s.member));
  assert.equal(perDay.size, empty.slots.length, 'nobody twice on one day');
  assert.ok(empty.slots.every(s => s.kind === 'new'));
  const noFill = autoplan([], '2026-12', '2026-11-19', DEFAULT_PLAN, { fillEmpty: false });
  assert.ok(noFill.slots.every(s => s.kind === 'empty'));
}
{
  const bank = [item({ primaryMember: 'Лиза', productionStatus: 'approved' }), item({ primaryMember: 'Лиза' }), item({ primaryMember: 'Юля', productionStatus: 'editing' })];
  const dated = item({ primaryMember: 'Юля', plannedPublishDate: '2026-12-01' });
  const published = item({ primaryMember: 'Марк', productionStatus: 'published', publishedAt: '2026-12-02', plannedPublishDate: '2026-12-02' });
  const youtube = item({ type: 'youtube', primaryMember: 'Андрей' });
  const r = autoplan([...bank, dated, published, youtube], '2026-12', '2026-11-19', DEFAULT_PLAN, { fillEmpty: true });
  const assigned = r.slots.filter(s => s.kind === 'assign').map(s => s.itemId);
  assert.equal(new Set(assigned).size, assigned.length, 'no item assigned twice');
  assert.deepEqual([...assigned].sort(), bank.map(b => b.id).sort(), 'all undated reels from the bank get a date');
  assert.ok(!assigned.includes(dated.id) && !assigned.includes(published.id) && !assigned.includes(youtube.id), 'dated, published and YouTube items are not touched');
  assert.equal(r.members.find(m => m.member === 'Юля').existing, 1);
  assert.equal(r.slots.filter(s => s.member === 'Юля').length, 9, 'Юля: 10 minus the dated one');
  assert.equal(r.slots.filter(s => s.member === 'Марк').length, 4, 'Марк: 5 minus the published one');
  assert.ok(!r.slots.some(s => s.member === 'Юля' && s.date === '2026-12-01'), 'existing date not reused for Юля');
}
{
  const late = autoplan([], '2026-11', '2026-11-19', DEFAULT_PLAN, { fillEmpty: true });
  assert.ok(late.slots.every(s => s.date >= '2026-11-19' && s.date <= '2026-11-30'), 'only future days of the month');
  assert.ok(late.conflicts.some(c => c.includes('Юля')), 'Юля does not fit every 3 days: conflict reported');
  // Her future dated items take interval positions: the quota is still met, without double days.
  const fut = [item({ plannedPublishDate: '2026-11-21' }), item({ plannedPublishDate: '2026-11-23' })];
  const r2 = autoplan(fut, '2026-11', '2026-11-19', DEFAULT_PLAN, { fillEmpty: true });
  const yd = r2.slots.filter(s => s.member === 'Юля').map(s => s.date);
  assert.equal(yd.length, 8, 'Юля: 10 minus 2 dated');
  assert.ok(!yd.includes('2026-11-21') && !yd.includes('2026-11-23') && new Set(yd).size === yd.length);
  assert.equal(r2.slots.length, 28);
  assert.equal(autoplan([], '2026-10', '2026-11-19', DEFAULT_PLAN, { fillEmpty: true }).slots.length, 0, 'past month: nothing');
}

/* Finance */
{
  const rules = [
    { id: 'r1', member: 'Юля', model: 'per_reel', amountMinor: 100000, currency: 'THB', validFrom: '2026-11-01', validTo: null, active: 1 },
    { id: 'r2', member: 'Андрей', model: 'per_reel', amountMinor: 50000, currency: 'THB', validFrom: '2026-11-01', validTo: null, active: 1 },
    { id: 'r3', member: 'Юля', model: 'per_shoot_day', amountMinor: 200000, currency: 'THB', validFrom: '2026-11-01', validTo: null, active: 1 },
    { id: 'r4', member: 'Марк', model: 'fixed_monthly', amountMinor: 900000, currency: 'THB', validFrom: '2026-11-01', validTo: null, active: 1 },
    { id: 'old', member: 'Лиза', model: 'per_reel', amountMinor: 1, currency: 'THB', validFrom: '2026-01-01', validTo: '2026-10-31', active: 1 },
  ];
  const items = [
    { id: 'c1', type: 'reel', title: 'Юля+Андрей', primaryMember: 'Юля', productionStatus: 'published', publishedAt: '2026-11-05' },
    { id: 'c2', type: 'reel', title: 'Одобрен', primaryMember: 'Юля', productionStatus: 'approved', publishedAt: null },
    { id: 'c3', type: 'reel', title: 'Лиза', primaryMember: 'Лиза', productionStatus: 'published', publishedAt: '2026-11-07' },
    { id: 'c4', type: 'youtube', title: 'YT', primaryMember: 'Андрей', productionStatus: 'published', publishedAt: '2026-11-08' },
  ];
  const shoots = [
    { date: '2026-11-06', status: 'Снято', participants: ['Юля', 'Андрей'], title: 'A' },
    { date: '2026-11-06', status: 'Снято', participants: ['Юля'], title: 'B' },
    { date: '2026-11-20', status: 'Запланировано', participants: ['Юля'], title: 'C' },
  ];
  const s = F.suggestAccruals('2026-11', rules, items, shoots, []);
  const keys = s.map(u => `${u.member}|${u.basis}|${u.basisKey}`).sort();
  assert.deepEqual(keys, ['Марк|fixed_monthly|2026-11', 'Юля|reel|c1', 'Юля|shoot_day|2026-11-06'].sort(),
    'joint reel only for primary, not approved, no rule → nothing, YouTube not per_reel, two shoots same day = one day, planned shoot nothing');
  assert.equal(F.suggestAccruals('2026-11', rules, items, shoots, s).length, 0, 'already recorded → no duplicates');
  assert.equal(F.suggestAccruals('2026-11', [], items, shoots, []).length, 0, 'no tariffs → no invented amounts');
  const bal = F.balances(s, [{ member: 'Юля', amountMinor: 150000, voidedAt: null }, { member: 'Юля', amountMinor: 999, voidedAt: '2026-11-10' }]);
  const y = bal.find(b => b.member === 'Юля');
  assert.deepEqual([y.accruedMinor, y.paidMinor, y.balanceMinor], [300000, 150000, 150000], 'partial payment, voided ignored');
  assert.equal(F.parseMoney('1 234,50'), 123450); assert.equal(F.parseMoney('0'), null); assert.equal(F.parseMoney('1.234'), null); assert.equal(F.parseMoney('-5'), null);
}

/* Backup planning */
{
  const legacy = legacyShoots();
  const nb = B.normalizeBackup(legacy);
  assert.equal(nb.tables.shoots.length, 7, 'old export of 7 shoots is accepted');
  const cols = { shoots: ['id', 'title', 'date', 'time', 'duration', 'format', 'status', 'project', 'location', 'participants', 'notes', 'preparation', 'revision'] };
  const ids = new Set(nb.tables.shoots.map(r => B.keyOf(['id'], r)));
  const p1 = B.planRestore(nb.tables, cols, { shoots: ids });
  assert.equal(p1.inserts.length, 0, 'existing 7 shoots are never re-inserted or overwritten');
  assert.equal(p1.report[0].existing, 7);
  const p2 = B.planRestore(nb.tables, cols, { shoots: new Set() });
  assert.equal(p2.inserts.length, 7);
  assert.ok('error' in B.normalizeBackup({ foo: 1 }));
  assert.ok('error' in B.normalizeBackup({ format: 'gost-home-backup', version: 1, tables: { shoots: 'x' } }));
  const full = B.normalizeBackup({ format: 'gost-home-backup', version: 1, tables: { integration_connections: [{ provider: 'instagram', token_cipher: 'x' }], shoots: [] } });
  assert.ok(!('integration_connections' in full.tables), 'connections (tokens) are never restored');
}

/* Higgsfield adapter (pure) */
{
  assert.ok(H.validEndpoint('wan/v2.6/image-to-video')); assert.ok(!H.validEndpoint('../x')); assert.ok(!H.validEndpoint('https://evil.com/a'));
  assert.equal(H.buildBody('wan/v2.6/image-to-video', { prompt: 'p' }).ok, false, 'image_url required');
  assert.equal(H.buildBody('wan/v2.6/image-to-video', { prompt: 'p', image_url: 'http://x' }).ok, false, 'https only');
  const ok = H.buildBody('wan/v2.6/image-to-video', { prompt: 'p', image_url: 'https://x/y.png', duration: '10' });
  assert.deepEqual(ok, { ok: true, body: { prompt: 'p', image_url: 'https://x/y.png', duration: 10, resolution: '720p' } });
  assert.equal(H.buildBody('wan/v2.6/image-to-video', { prompt: 'p', image_url: 'https://x/y.png', duration: 7 }).ok, false);
  const done = H.parseResponse({ status: 'completed', request_id: 'r', status_url: 'https://api.higgsfield.ai/requests/r/status', video: { url: 'https://cdn/v.mp4' } });
  assert.deepEqual([done.status, done.resultUrls[0]], ['completed', 'https://cdn/v.mp4']);
  assert.equal(H.parseResponse({}).status, 'error');
  assert.ok(H.safeStatusUrl('https://api.higgsfield.ai/requests/r/status')); assert.ok(!H.safeStatusUrl('https://evil.com/requests/r'));
}

/* Instagram adapter (pure) */
{
  const m = I.mapMedia({ id: '1', timestamp: '2026-11-19T20:30:00+0000', media_type: 'VIDEO', permalink: 'https://instagram.com/reel/x' });
  assert.equal(m.likeCount, null, 'missing metrics stay null, never 0');
  assert.ok(I.isReel(m));
  assert.equal(I.bangkokDay('2026-11-19T20:30:00+0000'), '2026-11-20', 'publication day in Bangkok');
  assert.equal(I.mapMedia({ id: 1 }), null);
  const cands = I.candidates('2026-11-20', [
    { id: 'a', type: 'reel', productionStatus: 'approved', plannedPublishDate: '2026-11-21' },
    { id: 'b', type: 'reel', productionStatus: 'approved', plannedPublishDate: '2026-11-25' },
    { id: 'c', type: 'reel', productionStatus: 'published', plannedPublishDate: '2026-11-20' },
    { id: 'd', type: 'youtube', productionStatus: 'approved', plannedPublishDate: '2026-11-20' },
  ]);
  assert.deepEqual(cands.map(c => c.id), ['a']);
  const url = new URL(I.authorizeUrl('app', 'https://site/cb', 'st'));
  assert.equal(url.searchParams.get('scope'), 'instagram_business_basic'); assert.equal(url.searchParams.get('state'), 'st');
}

/* Atomic writes on local D1: versions, comments, autoplan, finance-style guarded batches, restore */
{
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("") } }', d1Databases: ['DB'] });
  const d1 = await mf.getD1Database('DB');
  for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync('drizzle/' + f, 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) await d1.prepare(stmt).run();
  }
  const count = async (q, ...b) => (await d1.prepare(q).bind(...b).first()).n;
  const fields = { type: 'reel', title: 'A', description: '', primaryMember: 'Юля', shootId: null, places: '', plannedPublishDate: null, driveUrl: '' };
  const a = uuid(), b = uuid();
  await W.applyContentCreate(d1, { id: a, ...fields, productionStatus: 'editing', actor: 'T' }, []);
  await W.applyContentCreate(d1, { id: b, ...fields, title: 'B', productionStatus: 'planned', actor: 'T' }, []);

  const v1 = await W.applyAddVersion(d1, { contentId: a, revision: 1, driveUrl: 'https://drive.google.com/1', note: '', actor: 'T' });
  assert.ok(v1);
  assert.equal(await W.applyAddVersion(d1, { contentId: a, revision: 1, driveUrl: 'https://drive.google.com/x', note: '', actor: 'T' }), null, 'stale revision');
  assert.equal(await count('SELECT count(*) n FROM edit_versions'), 1, 'stale version wrote nothing');
  assert.equal(await count("SELECT count(*) n FROM audit_events WHERE action='version'"), 1);
  await W.applyStatusChange(d1, { id: a, revision: 2, from: 'editing', to: 'awaiting_feedback', publishedAt: null, comment: '', actor: 'T', previousPublishedAt: null, versionId: v1 });
  await W.applyStatusChange(d1, { id: a, revision: 3, from: 'awaiting_feedback', to: 'changes_requested', publishedAt: null, comment: 'короче', actor: 'A', previousPublishedAt: null, versionId: v1 });
  assert.equal(await count("SELECT count(*) n FROM feedback_comments WHERE kind='changes_requested' AND version_id=?", v1), 1, 'decision recorded on the version');
  await W.applyStatusChange(d1, { id: a, revision: 4, from: 'changes_requested', to: 'editing', publishedAt: null, comment: '', actor: 'T', previousPublishedAt: null });
  const v2 = await W.applyAddVersion(d1, { contentId: a, revision: 5, driveUrl: 'https://drive.google.com/2', note: 'короче', actor: 'T' });
  assert.equal((await d1.prepare('SELECT number FROM edit_versions WHERE id=?').bind(v2).first()).number, 2, 'second round = v2');
  await W.applyComment(d1, { contentId: a, versionId: v2, body: 'ок', actor: 'T' });
  assert.equal(await count("SELECT count(*) n FROM feedback_comments WHERE content_id=?", a), 2);

  // Autoplan: one stale assignment rolls back everything, including new slots.
  const before = await count('SELECT count(*) n FROM content_items');
  await assert.rejects(W.applyAutoplan(d1, { month: '2026-12', actor: 'T', assignments: [{ id: b, revision: 99, date: '2026-12-03' }], newSlots: [{ id: uuid(), member: 'Лиза', date: '2026-12-04', title: 'Reels: Лиза' }] }));
  assert.equal(await count('SELECT count(*) n FROM content_items'), before, 'no new slot after failed autoplan');
  assert.equal((await d1.prepare('SELECT planned_publish_date d FROM content_items WHERE id=?').bind(b).first()).d, null);
  await W.applyAutoplan(d1, { month: '2026-12', actor: 'T', assignments: [{ id: b, revision: 1, date: '2026-12-03' }], newSlots: [{ id: uuid(), member: 'Лиза', date: '2026-12-04', title: 'Reels: Лиза' }] });
  assert.equal(await count('SELECT count(*) n FROM content_items'), before + 1);
  assert.equal((await d1.prepare('SELECT planned_publish_date d FROM content_items WHERE id=?').bind(b).first()).d, '2026-12-03');
  await assert.rejects(W.applyAutoplan(d1, { month: '2026-12', actor: 'T', assignments: [{ id: b, revision: 2, date: '2026-12-05' }], newSlots: [] }), 'already dated item is not reassigned');

  // Payable units: unique basis key prevents double accrual.
  const ins = (id) => d1.prepare(`INSERT INTO payable_units (id, member, basis, basis_key, content_id, shoot_date, period, rate_rule_id, amount_minor, currency, description, created_at, created_by)
    VALUES (?, 'Юля', 'shoot_day', '2026-11-06', NULL, '2026-11-06', '2026-11', NULL, 100, 'THB', '', 'x', 'T') ON CONFLICT(member, basis, basis_key) DO NOTHING`).bind(id);
  await d1.batch([ins(uuid()), ins(uuid())]);
  assert.equal(await count('SELECT count(*) n FROM payable_units'), 1, 'shoot day accrued once');

  // Restore: additive only, shoots untouched.
  const legacy = legacyShoots();
  const nb = B.normalizeBackup(legacy);
  const cols = { shoots: (await d1.prepare('PRAGMA table_info(shoots)').all()).results.map(c => c.name) };
  const restore = async () => {
    const existing = { shoots: new Set((await d1.prepare('SELECT id FROM shoots').all()).results.map(r => B.keyOf(['id'], r))) };
    const { inserts } = B.planRestore(nb.tables, cols, existing);
    if (inserts.length) await d1.batch(inserts.map(i => d1.prepare(`INSERT OR IGNORE INTO ${i.table} (${i.cols.join(', ')}) VALUES (${i.cols.map(() => '?').join(', ')})`).bind(...i.values)));
    return inserts.length;
  };
  assert.equal(await restore(), 7);
  const snap = JSON.stringify((await d1.prepare('SELECT * FROM shoots ORDER BY id').all()).results);
  assert.equal(await restore(), 0, 'second restore inserts nothing');
  assert.equal(JSON.stringify((await d1.prepare('SELECT * FROM shoots ORDER BY id').all()).results), snap, '7 shoots unchanged byte for byte');
  assert.equal(await count('SELECT count(*) n FROM shoots'), 7);
  await mf.dispose();
}
console.log('stage 3 tests passed');
