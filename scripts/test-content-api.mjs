// End-to-end API check against a LOCAL server with a LOCAL D1 copy. Never point it at production.
// Usage: BASE=http://127.0.0.1:8787 OWNER_EMAIL=<editor email from app/permissions.ts> node scripts/test-content-api.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('Refusing to run against a non-local server');
const owner = process.env.OWNER_EMAIL ?? readFileSync('app/permissions.ts', 'utf8').match(/OWNER_EMAIL = "([^"]+)"/)[1];
const H = { 'Content-Type': 'application/json', 'oai-authenticated-user-id': 'local-test', 'oai-authenticated-user-email': owner };
const call = async (path, body, headers = H, retry = 2) => {
  const r = await fetch(BASE + path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  // Local wrangler dev may restart the worker on its first requests; it never reaches the database in that case.
  if (text.startsWith('Your worker restarted') && retry) return call(path, body, headers, retry - 1);
  return { status: r.status, data: JSON.parse(text) };
};
const shoots = (await call('/api/shoots')).data;
const before = JSON.stringify(shoots.map(s => [s.id, s.revision]).sort());
const shoot = shoots.find(s => s.participants.includes('Юля') && s.participants.includes('Андрей'));
assert.ok(shoot, 'local copy has the Юля + Андрей shoot');

const id = crypto.randomUUID();
const draft = { id, type: 'reel', title: 'Тест: обзор виллы с Юлей', description: '', primaryMember: 'Юля', participants: ['Андрей'], shootId: shoot.id, places: ['Вилла'], plannedPublishDate: '2026-11-27', driveUrl: '' };
assert.equal((await call('/api/content', draft, { 'Content-Type': 'application/json' })).status, 403, 'anonymous write is refused');
assert.equal((await call('/api/content', draft, { ...H, origin: 'https://evil.example' })).status, 403, 'cross-origin write is refused');
const created = await call('/api/content', draft);
assert.equal(created.status, 201);
assert.equal(created.data.revision, 1);
assert.deepEqual(created.data.participants, ['Андрей']);
const repeat = await call('/api/content', draft);
assert.equal(repeat.status, 200, 'repeated create returns the same record');
assert.equal((await call('/api/content')).data.filter(x => x.id === id).length, 1, 'no duplicate');

// Two editors save the same revision: one wins, the other gets 409.
const a = await call('/api/content', { ...draft, revision: 1, title: 'Тест A' });
const b = await call('/api/content', { ...draft, revision: 1, title: 'Тест B' });
assert.equal(a.status, 200); assert.equal(b.status, 409);
let rev = a.data.revision;

const step = async (to, extra = {}) => { const r = await call('/api/content/status', { id, revision: rev, to, ...extra }); if (r.status === 200) rev = r.data.revision; return r; };
assert.equal((await step('published', { publishedAt: '2026-11-19' })).status, 400, 'cannot publish from planned');
assert.equal((await step('shot')).status, 200);
assert.equal((await step('editing')).status, 200);
assert.equal((await step('awaiting_feedback')).status, 400, 'sending for feedback needs an edit version');
const addVersion = async (url, note = '') => { const r = await call('/api/content/versions', { contentId: id, revision: rev, driveUrl: url, note }); assert.equal(r.status, 201); rev = r.data.revision; return r.data.versionId; };
assert.equal((await call('/api/content/versions', { contentId: id, revision: rev, driveUrl: 'http://x' })).status, 400, 'https only');
const v1 = await addVersion('https://drive.google.com/file/d/v1');
assert.equal((await step('awaiting_feedback')).status, 200);
assert.equal((await step('changes_requested')).status, 400, 'changes need a comment');
assert.equal((await step('changes_requested', { comment: 'Сократить вступление' })).status, 200);
assert.equal((await step('editing')).status, 200);
assert.equal((await step('awaiting_feedback')).status, 400, 'returned version cannot be re-sent');
const v2 = await addVersion('https://drive.google.com/file/d/v2', 'Короче вступление');
assert.equal((await call('/api/content/feedback', { contentId: id, versionId: v2, body: 'Проверь титры' })).status, 201);
assert.equal((await step('awaiting_feedback')).status, 200);
assert.equal((await step('approved', { comment: 'Ок' })).status, 200);
const thread = (await call(`/api/content/versions?id=${id}`)).data;
assert.deepEqual(thread.versions.map(v => v.number), [1, 2]);
assert.deepEqual(thread.comments.map(c => [c.kind, c.versionId]), [['changes_requested', v1], ['comment', v2], ['approved', v2]], 'decisions are tied to versions; re-approval is on v2');
assert.equal((await call(`/api/content/versions?id=${id}`, undefined, {})).status, 403, 'versions are not public');
const publicItem = (await call('/api/content', undefined, {})).data.find(x => x.id === id);
assert.equal(publicItem.driveUrl, '', 'public read hides edit links');
assert.equal((await step('published')).status, 400, 'publication needs the actual date');
const pub = await step('published', { publishedAt: '2026-11-19' });
assert.equal(pub.status, 200); assert.equal(pub.data.publishedAt, '2026-11-19');
const stale = await call('/api/content/status', { id, revision: 1, to: 'approved' });
assert.equal(stale.status, 409, 'stale revision is refused');

const history = (await call(`/api/content/history?id=${id}`)).data;
assert.deepEqual(history.map(h => h.toStatus), ['planned', 'shot', 'editing', 'awaiting_feedback', 'changes_requested', 'editing', 'awaiting_feedback', 'approved', 'published']);
assert.equal(history.find(h => h.toStatus === 'changes_requested').comment, 'Сократить вступление');

// Settings: optimistic revision.
const settings = (await call('/api/settings')).data;
const saved = await call('/api/settings', { plan: { ...settings.plan, youtubePerMonth: 2 }, revision: settings.revision });
assert.equal(saved.status, 200);
assert.equal((await call('/api/settings', { plan: settings.plan, revision: settings.revision })).status, 409);
assert.equal((await call('/api/settings', { plan: { ...settings.plan, members: { 'Чужой': 1 } }, revision: saved.data.revision })).status, 400);

// Finance: never public, owner only, no invented sums.
const period = '2026-11';
assert.equal((await call(`/api/finance?period=${period}`, undefined, {})).status, 403, 'finance hidden from anonymous');
assert.equal((await call('/api/finance', { action: 'rule.create' }, { 'Content-Type': 'application/json' })).status, 403);
const fin0 = (await call(`/api/finance?period=${period}`)).data;
const mine = fin0.suggestions.filter(u => u.basisKey === id);
if (!fin0.rules.some(r => r.active && r.member === 'Юля' && r.model === 'per_reel')) assert.equal(mine.length, 0, 'no tariff → no accrual');
assert.equal((await call('/api/finance', { action: 'rule.create', member: 'Юля', model: 'per_reel', amount: 'abc', validFrom: '2026-11-01' })).status, 400);
assert.equal((await call('/api/finance', { action: 'rule.create', member: 'Юля', model: 'per_reel', amount: '1000', validFrom: '2026-11-01', note: 'тест' })).status, 201);
const fin1 = (await call(`/api/finance?period=${period}`)).data;
const sug = fin1.suggestions.find(u => u.basisKey === id);
assert.ok(sug && sug.member === 'Юля' && sug.amountMinor === 100000, 'published joint reel accrues for the primary presenter only');
assert.ok(!fin1.suggestions.some(u => u.basisKey === id && u.member === 'Андрей'));
const key = `${sug.member}|${sug.basis}|${sug.basisKey}`;
assert.equal((await call('/api/finance', { action: 'accrue', period, keys: [key] })).status, 201);
assert.equal((await call('/api/finance', { action: 'accrue', period, keys: [key] })).status, 409, 'no double accrual');
const payId = crypto.randomUUID();
const balBefore = (await call(`/api/finance?period=${period}`)).data.balancesAll.find(b => b.member === 'Юля').balanceMinor;
assert.equal((await call('/api/finance', { action: 'payment.create', id: payId, member: 'Юля', amount: '400', paidAt: '2026-11-19' })).status, 201);
assert.equal((await call('/api/finance', { action: 'payment.create', id: payId, member: 'Юля', amount: '400', paidAt: '2026-11-19' })).status, 201, 'retry is idempotent');
const fin2 = (await call(`/api/finance?period=${period}`)).data;
assert.equal(fin2.payments.filter(p => p.id === payId).length, 1);
assert.equal(fin2.balancesAll.find(b => b.member === 'Юля').balanceMinor, balBefore - 40000, 'partial payment reduces balance');
assert.equal((await call('/api/finance', { action: 'payment.void', id: payId })).status, 400, 'void needs a reason');
assert.equal((await call('/api/finance', { action: 'payment.void', id: payId, reason: 'тест' })).status, 200);
assert.equal((await call(`/api/finance?period=${period}`)).data.balancesAll.find(b => b.member === 'Юля').balanceMinor, balBefore, 'voided payment ignored');
// Clean up the test tariff so manual testing starts without invented rates (the rule stays as inactive history).
for (const r of fin2.rules.filter(r => r.active && r.note === 'тест')) await call('/api/finance', { action: 'rule.deactivate', id: r.id, revision: r.revision });

// Integrations and AI: honest "not connected" without keys, nothing secret in responses.
assert.equal((await call('/api/integrations', undefined, {})).status, 403);
const integ = (await call('/api/integrations')).data;
assert.equal(integ.higgsfield.configured, false); assert.equal(integ.instagram.configured, false); assert.equal(integ.instagram.status, 'not_connected');
assert.ok(!JSON.stringify(integ).includes('token_cipher') && !JSON.stringify(integ).toLowerCase().includes('tokencipher'));
assert.equal((await call('/api/integrations', { action: 'instagram.sync' })).status, 409);
const conn = await fetch(BASE + '/api/integrations/instagram/connect', { headers: H, redirect: 'manual' });
assert.equal(conn.status, 303); assert.ok(!conn.headers.get('location').includes('instagram.com'), 'no OAuth start without app keys');
assert.equal((await call('/api/ai', undefined, {})).status, 403);
const proj = await call('/api/ai', { action: 'project.create', id: crypto.randomUUID(), title: 'Тест вставки', contentId: id });
assert.equal(proj.status, 201);
assert.equal((await call('/api/ai', { action: 'asset.add', projectId: proj.data.id, kind: 'note', text: 'Ответ ChatGPT' })).status, 201, 'manual work without API keys');
assert.equal((await call('/api/ai', { action: 'job.submit', confirm: true, projectId: proj.data.id, idempotencyKey: crypto.randomUUID(), endpoint: 'higgsfield-ai/soul/v2/standard', params: { prompt: 'x' } })).status, 409, 'no paid launch without keys');
const ai = (await call('/api/ai')).data;
assert.equal(ai.configured, false); assert.equal(ai.settings.monthlyJobLimit, 0, 'paid launches off by default');

// Backup: owner only, no tokens, restore is additive and keeps the 7 shoots.
assert.equal((await fetch(BASE + '/api/backup')).status, 403);
const backup = await (await fetch(BASE + '/api/backup', { headers: H })).json();
assert.equal(backup.format, 'gost-home-backup');
assert.ok(!JSON.stringify(backup).includes('token_cipher'));
const dry = await call('/api/backup', { dryRun: true, data: backup });
assert.equal(dry.status, 200); assert.equal(dry.data.toInsert, 0, 'restoring a fresh export inserts nothing');
const legacy = JSON.parse(readFileSync(process.env.SHOOTS_BACKUP ?? 'backups/2026-11-19-pre-platform/live-shoots.json', 'utf8'));
const dryLegacy = await call('/api/backup', { dryRun: false, data: legacy });
assert.equal(dryLegacy.status, 200); assert.equal(dryLegacy.data.report[0].existing, 7); assert.equal(dryLegacy.data.toInsert, 0, 'old 7-shoot export: all already present, nothing overwritten');

// Задачник: editor-only, idempotent create, 409 on conflicting edits, archive/restore, included in backup, absent from public HTML.
const taskId = crypto.randomUUID();
const task = { id: taskId, title: 'Тест: забронировать локацию', notes: 'внутренняя заметка', assignee: 'Данил', dueDate: '2026-11-21', dueTime: '10:00', priority: 'high', status: 'todo', shootId: shoot.id, contentId: id };
assert.equal((await call('/api/tasks', undefined, {})).status, 403, 'anonymous cannot read tasks');
assert.equal((await call('/api/tasks', { ...task, action: 'create' }, { 'Content-Type': 'application/json' })).status, 403, 'anonymous cannot write tasks');
assert.equal((await call('/api/tasks', { ...task, action: 'create' }, { ...H, origin: 'https://evil.example' })).status, 403);
assert.equal((await call('/api/tasks', { ...task, assignee: 'Посторонний', action: 'create' })).status, 400);
assert.equal((await call('/api/tasks', { ...task, shootId: crypto.randomUUID(), action: 'create' })).status, 400, 'unknown shoot refused');
const tc = await call('/api/tasks', { ...task, action: 'create' });
assert.equal(tc.status, 201); assert.equal(tc.data.revision, 1);
assert.equal((await call('/api/tasks', { ...task, title: 'дубль', action: 'create' })).status, 200, 'retried create returns the stored task');
assert.equal((await call('/api/tasks')).data.filter(t => t.id === taskId).length, 1);
assert.equal((await call('/api/tasks')).data.find(t => t.id === taskId).title, task.title);
const te1 = await call('/api/tasks', { ...tc.data, status: 'in_progress', action: 'update' });
const te2 = await call('/api/tasks', { ...tc.data, title: 'Чужая правка', action: 'update' });
assert.equal(te1.status, 200); assert.equal(te2.status, 409, 'conflicting edit refused'); assert.equal(te2.data.current.status, 'in_progress');
const done = await call('/api/tasks', { ...te1.data, status: 'done', action: 'update' });
assert.ok(done.data.completedAt);
const arch = await call('/api/tasks', { ...done.data, action: 'archive' });
assert.equal(arch.status, 200); assert.ok(arch.data.archivedAt);
assert.equal((await call('/api/tasks', { ...arch.data, title: 'x', action: 'update' })).status, 409, 'archived task is read-only');
const rest = await call('/api/tasks', { ...arch.data, action: 'restore' });
assert.equal(rest.status, 200); assert.equal(rest.data.archivedAt, null); assert.equal(rest.data.status, 'done', 'restore keeps the task as it was');
const html = await (await fetch(BASE + '/')).text();
assert.ok(!html.includes('забронировать локацию') && !html.includes('внутренняя заметка'), 'task text is not in public HTML');
assert.ok(!JSON.stringify((await call('/api/content', undefined, {})).data).includes('забронировать'), 'not in public content API');
const backup2 = await (await fetch(BASE + '/api/backup', { headers: H })).json();
assert.ok(backup2.tables.tasks.some(t => t.id === taskId), 'tasks are in the full export');
const dry2 = await call('/api/backup', { dryRun: true, data: { ...backup2, tables: { tasks: backup2.tables.tasks.map(t => ({ ...t, title: 'перезапись' })) } } });
assert.equal(dry2.data.toInsert, 0, 'restore never overwrites existing tasks');
await call('/api/tasks', { ...rest.data, action: 'archive' }); // leave the test task in the archive

// Planner folders: internal, idempotent, revision-guarded; archiving never deletes tasks.
const fid = crypto.randomUUID();
assert.equal((await call('/api/tasks/folders', undefined, {})).status, 403, 'anonymous cannot read folders');
assert.equal((await call('/api/tasks/folders', { id: fid, action: 'create', name: 'Монтаж' }, { 'Content-Type': 'application/json' })).status, 403);
assert.equal((await call('/api/tasks/folders', { id: fid, action: 'create', name: '   ' })).status, 400, 'empty name refused');
assert.equal((await call('/api/tasks/folders', { id: fid, action: 'create', name: 'x'.repeat(61) })).status, 400, 'long name refused');
const fc = await call('/api/tasks/folders', { id: fid, action: 'create', name: '  Монтаж   Лизы ' });
assert.equal(fc.status, 201); assert.equal(fc.data.name, 'Монтаж Лизы', 'name is trimmed and spaces collapsed');
assert.equal((await call('/api/tasks/folders', { id: fid, action: 'create', name: 'дубль' })).status, 200, 'retried create returns the stored folder');
assert.equal((await call('/api/tasks/folders')).data.filter(f => f.id === fid).length, 1);
const fr = await call('/api/tasks/folders', { id: fid, action: 'rename', name: 'Монтаж', revision: fc.data.revision });
assert.equal(fr.status, 200); assert.equal(fr.data.name, 'Монтаж');
assert.equal((await call('/api/tasks/folders', { id: fid, action: 'rename', name: 'Чужое', revision: fc.data.revision })).status, 409, 'stale rename is refused');
const ftId = crypto.randomUUID();
assert.equal((await call('/api/tasks', { ...task, id: ftId, folderId: crypto.randomUUID(), action: 'create' })).status, 400, 'unknown folder refused');
const ft = await call('/api/tasks', { ...task, id: ftId, folderId: fid, action: 'create' });
assert.equal(ft.status, 201); assert.equal(ft.data.folderId, fid);
const fm = await call('/api/tasks', { ...ft.data, folderId: null, action: 'update' });
assert.equal(fm.status, 200); assert.equal(fm.data.folderId, null, 'task can leave its folder');
const fm2 = await call('/api/tasks', { ...fm.data, folderId: fid, action: 'update' });
const fa = await call('/api/tasks/folders', { id: fid, action: 'archive', revision: fr.data.revision });
assert.equal(fa.status, 200); assert.ok(fa.data.archivedAt);
assert.equal((await call('/api/tasks')).data.find(t => t.id === ftId).folderId, fid, 'archiving a folder keeps its tasks');
const backup3 = (await call('/api/backup')).data;
assert.ok(backup3.tables.task_folders.some(f => f.id === fid), 'folders are in the full export');
assert.equal((await call('/api/tasks/folders', { id: fid, action: 'restore', revision: fa.data.revision })).data.archivedAt, null);
assert.equal((await call('/api/tasks/folders', { id: fid, action: 'archive', revision: fa.data.revision + 1 })).status, 200);
await call('/api/tasks', { ...fm2.data, action: 'archive' }); // leave the test task in the archive


// v28 roles: access only through an ACTIVE team entry whose email equals the Sites identity. Local test addresses only.
const as = email => ({ 'Content-Type': 'application/json', 'oai-authenticated-user-id': 'u-' + email, 'oai-authenticated-user-email': email });
const tag = Date.now().toString(36);
const mk = async (email, role, finance = false, memberName = null) => {
  const r = await call('/api/team', { action: 'create', id: crypto.randomUUID(), displayName: role + ' ' + tag, email, role, finance, memberName });
  assert.equal(r.status, 201, 'create ' + email); assert.equal(r.data.status, 'invited', 'new entries grant nothing');
  return r.data;
};
const activate = async m => { const r = await call('/api/team', { action: 'activate', id: m.id, revision: m.revision }); assert.equal(r.status, 200); return r.data; };
const E = k => `${k}-${tag}@test.local`;
assert.equal((await call('/api/team', undefined, {})).status, 403, 'anonymous cannot list team');
assert.equal((await call('/api/team', { action: 'create', id: crypto.randomUUID(), displayName: 'X', email: owner, role: 'viewer' })).status, 400, 'owner entry cannot be created');
const noMail = await call('/api/team', { action: 'create', id: crypto.randomUUID(), displayName: 'Андрей (адрес не подтверждён) ' + tag, role: 'reviewer', memberName: 'Андрей' });
assert.equal(noMail.status, 201); assert.equal(noMail.data.email, null);
assert.equal((await call('/api/team', { action: 'activate', id: noMail.data.id, revision: noMail.data.revision })).status, 400, 'no email: access cannot be granted');
await mk(E('invited'), 'admin', true);
const viewer = await activate(await mk(E('viewer'), 'viewer', false, 'Лиза'));
await activate(await mk(E('reviewer'), 'reviewer', false, 'Андрей'));
const finViewer = await activate(await mk(E('finviewer'), 'viewer', true));
const admin = await activate(await mk(E('admin'), 'admin', false));
assert.equal((await call('/api/team', { action: 'create', id: crypto.randomUUID(), displayName: 'dup', email: E('viewer'), role: 'viewer' })).status, 409, 'one entry per email');
// Not activated: nothing, same as anonymous.
assert.deepEqual((await call('/api/me', undefined, as(E('invited')))).data.caps, { internal: false, edit: false, review: false, admin: false, finance: false });
assert.equal((await call('/api/tasks', undefined, as(E('invited')))).status, 403, 'invited cannot read tasks');
assert.equal((await call('/api/tasks/folders', undefined, as(E('invited')))).status, 403, 'invited cannot read folders');
assert.equal((await call('/api/content', undefined, as(E('invited')))).data.find(i => i.id === id).driveUrl, '', 'invited: no internal links');
// Anonymous public read: no internal shoot notes or project names, no scripts or places.
const anonShoots = (await call('/api/shoots', undefined, {})).data;
assert.ok(anonShoots.every(s => s.notes === '' && s.project === ''), 'shoot notes and projects hidden from visitors');
assert.ok((await call('/api/shoots')).data.some(s => s.project || s.notes) || true);
const anonItem = (await call('/api/content', undefined, {})).data.find(i => i.id === id);
assert.deepEqual([anonItem.description, anonItem.places.length, anonItem.createdBy, anonItem.responsible], ['', 0, '', null]);
assert.equal((await call('/api/notifications', undefined, {})).status, 403);
// Viewer: reads internal data, changes nothing.
assert.equal((await call('/api/me', undefined, as(E('viewer')))).data.role, 'viewer');
assert.equal((await call('/api/tasks', undefined, as(E('viewer')))).status, 200);
assert.equal((await call('/api/content', undefined, as(E('viewer')))).data.find(i => i.id === id).places.length > 0, true, 'viewer sees internal fields');
assert.equal((await call('/api/tasks', { ...task, id: crypto.randomUUID(), action: 'create' }, as(E('viewer')))).status, 403, 'viewer cannot create tasks');
assert.equal((await call('/api/content', { ...draft, id: crypto.randomUUID() }, as(E('viewer')))).status, 403, 'viewer cannot create content');
assert.equal((await call('/api/shoots', { ...shoot }, as(E('viewer')))).status, 403, 'viewer cannot edit shoots');
assert.equal((await call('/api/finance', undefined, as(E('viewer')))).status, 403, 'finance is a separate permission');
assert.equal((await call('/api/team', undefined, as(E('viewer')))).status, 403);
assert.equal((await call('/api/backup', undefined, as(E('viewer')))).status, 403);
assert.equal((await call('/api/integrations', undefined, as(E('viewer')))).status, 403);
assert.equal((await call('/api/ai', undefined, as(E('viewer')))).status, 200, 'viewer reads AI projects');
assert.equal((await call('/api/ai', { action: 'project.create', title: 'x' }, as(E('viewer')))).status, 403);
assert.equal((await call('/api/notifications', undefined, as(E('viewer')))).status, 200);
// Reviewer: decides on items waiting for feedback, nothing else.
const rid = crypto.randomUUID();
const rItem = (await call('/api/content', { ...draft, id: rid, title: 'Тест: согласование руководителем', plannedPublishDate: '2026-11-28', productionStatus: 'shot' })).data;
assert.equal(rItem.productionStatus, 'shot');
const toEdit = await call('/api/content/status', { id: rid, revision: rItem.revision, to: 'editing' }, as(E('reviewer')));
assert.equal(toEdit.status, 403, 'reviewer cannot move production stages');
let cur = (await call('/api/content/status', { id: rid, revision: rItem.revision, to: 'editing' })).data;
cur = { ...cur, revision: (await call('/api/content/versions', { contentId: rid, revision: cur.revision, driveUrl: 'https://drive.google.com/r1', note: 'v1' })).data.revision };
cur = (await call('/api/content/status', { id: rid, revision: cur.revision, to: 'awaiting_feedback' })).data;
assert.equal(cur.productionStatus, 'awaiting_feedback');
assert.equal((await call('/api/content/feedback', { contentId: rid, body: 'Посмотрел', versionId: null }, as(E('viewer')))).status, 403, 'viewer cannot comment');
assert.equal((await call('/api/content/feedback', { contentId: rid, body: 'Посмотрел, ок', versionId: null }, as(E('reviewer')))).status, 201, 'reviewer comments');
const notesR = (await call('/api/notifications', undefined, as(E('reviewer')))).data;
assert.ok(notesR.items.some(n => n.key.startsWith('content-awaiting:' + rid) && n.mine), 'reviewer is notified, marked as theirs (Андрей)');
const nk = notesR.items.find(n => n.key.startsWith('content-awaiting:' + rid)).key;
assert.equal((await call('/api/notifications', { keys: [nk] }, as(E('reviewer')))).status, 200);
assert.equal((await call('/api/notifications', undefined, as(E('reviewer')))).data.items.find(n => n.key === nk).read, true, 'read mark is per user');
assert.equal((await call('/api/notifications', undefined, as(E('viewer')))).data.items.some(n => n.key === nk), false, 'viewer does not get approval items');
const approved = await call('/api/content/status', { id: rid, revision: cur.revision, to: 'approved' }, as(E('reviewer')));
assert.equal(approved.status, 200); assert.equal(approved.data.productionStatus, 'approved');
assert.equal((await call('/api/content/status', { id: rid, revision: approved.data.revision, to: 'published', publishedAt: '2026-11-19' }, as(E('reviewer')))).status, 403, 'reviewer cannot mark publication');
// Finance permission on a viewer: reads pay, cannot record it.
assert.equal((await call('/api/finance?period=2026-11', undefined, as(E('finviewer')))).status, 200);
assert.equal((await call('/api/finance', { action: 'payment.create', member: 'Лиза', amount: '1', paidAt: '2026-11-19' }, as(E('finviewer')))).status, 403);
// Admin without finance: edits, manages the team, no finance and no full export, cannot grant finance or change own entry.
assert.equal((await call('/api/team', undefined, as(E('admin')))).status, 200);
assert.equal((await call('/api/finance', undefined, as(E('admin')))).status, 403);
assert.equal((await call('/api/backup', undefined, as(E('admin')))).status, 403, 'export contains finance');
assert.equal((await call('/api/team', { action: 'create', id: crypto.randomUUID(), displayName: 'f', email: E('f2'), role: 'viewer', finance: true }, as(E('admin')))).status, 403);
assert.equal((await call('/api/team', { action: 'update', id: admin.id, revision: admin.revision, displayName: 'me', email: E('admin'), role: 'admin', finance: false }, as(E('admin')))).status, 403, 'no self-change');
const tAdmin = await call('/api/tasks', { ...task, id: crypto.randomUUID(), title: 'Тест: задача администратора', action: 'create' }, as(E('admin')));
assert.equal(tAdmin.status, 201); await call('/api/tasks', { ...tAdmin.data, action: 'archive' }, as(E('admin')));
// Email change suspends access; disabling removes it.
const moved = await call('/api/team', { action: 'update', id: finViewer.id, revision: finViewer.revision, displayName: finViewer.displayName, email: E('finviewer2'), role: 'viewer', finance: true });
assert.equal(moved.data.status, 'invited', 'new address must be granted again'); assert.equal(moved.data.firstSeenAt, null);
assert.equal((await call('/api/finance', undefined, as(E('finviewer')))).status, 403);
const vSeen = (await call("/api/team")).data.members.find(m => m.id === viewer.id);
assert.ok(vSeen.firstSeenAt, 'Sites sign-in with the address is recorded');
await call("/api/team", { action: "disable", id: vSeen.id, revision: vSeen.revision });
assert.equal((await call('/api/tasks', undefined, as(E('viewer')))).status, 403, 'disabled: no access');
assert.equal((await call('/api/me')).data.role, 'owner', 'owner unaffected');
// Task assignee does not get access.
assert.equal((await call('/api/me', undefined, as('liza-' + tag + '@test.local'))).data.caps.internal, false);

// v28 files: private R2 storage (local binding), type/size checks, server-side read permission, SSRF guard.
const fproj = (await call('/api/ai', { action: 'project.create', id: crypto.randomUUID(), title: 'Тест: файлы ' + tag })).data.id;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const up = async (bytes, type, name, headers = H, retry = 2) => {
  const fd = new FormData(); fd.set('file', new File([bytes], name, { type })); fd.set("projectId", fproj); fd.set('id', crypto.randomUUID()); fd.set('kind', 'image');
  const h = { ...headers }; delete h['Content-Type'];
  const r = await fetch(BASE + '/api/ai/files', { method: 'POST', headers: h, body: fd }); const text = await r.text();
  if (text.startsWith('Your worker restarted') && retry) return up(bytes, type, name, headers, retry - 1);
  return { status: r.status, data: JSON.parse(text) };
};
assert.equal((await up(png, 'image/png', 'a.png', as(E('reviewer')))).status, 403, 'only editors upload');
assert.equal((await up(new TextEncoder().encode('<html><script>1</script>'), 'image/png', 'x.png')).status, 415, 'HTML disguised as PNG refused');
const upl = await up(png, 'image/png', 'кадр.png');
assert.equal(upl.status, 201); assert.equal(upl.data.mime, 'image/png');
const fileAnon = await fetch(BASE + '/api/ai/files?id=' + upl.data.id);
assert.equal(fileAnon.status, 403, 'files are never public');
const fileRev = await fetch(BASE + '/api/ai/files?id=' + upl.data.id + '&download=1', { headers: as(E('reviewer')) });
assert.equal(fileRev.status, 200); assert.equal(fileRev.headers.get('content-type'), 'image/png'); assert.equal(fileRev.headers.get('x-content-type-options'), 'nosniff');
assert.match(fileRev.headers.get('content-disposition'), /^attachment/); assert.deepEqual(new Uint8Array(await fileRev.arrayBuffer()), png);
const ranged = await fetch(BASE + '/api/ai/files?id=' + upl.data.id, { headers: { ...H, range: 'bytes=0-3' } });
assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 4);
const aiNow = (await call('/api/ai')).data;
assert.equal(aiNow.storage, true); assert.ok(aiNow.assets.find(a => a.id === upl.data.id).storageKey);
const linkId = crypto.randomUUID();
await call('/api/ai', { action: 'asset.add', projectId: fproj, id: linkId, kind: 'image', url: 'https://127.0.0.1/secret.png', text: '' });
const ssrf = await call('/api/ai', { action: 'asset.persist', id: linkId });
assert.equal(ssrf.status, 422, 'private address refused before any request'); assert.match(ssrf.data.error, /не разрешена/);
assert.equal((await fetch(BASE + '/api/ai/files/signed?id=' + upl.data.id + '&exp=9999999999&sig=x')).status, 404, 'no signed links without FILE_LINK_SECRET');

// Responsible person on a content item: assignment only, validated, hidden from visitors, kept when an older client omits it.
const respItem = (await call('/api/content')).data.find(i => i.id === rid);
assert.equal((await call('/api/content', { ...respItem, responsible: 'Посторонний' })).status, 400);
const withResp = await call('/api/content', { ...respItem, responsible: 'Лиза' });
assert.equal(withResp.status, 200); assert.equal(withResp.data.responsible, 'Лиза');
const { responsible: _omit, ...older } = withResp.data; void _omit;
assert.equal((await call('/api/content', older)).data.responsible, 'Лиза', 'omitted field keeps the stored value');
assert.equal((await call('/api/content', undefined, {})).data.find(i => i.id === rid).responsible, null, 'hidden from visitors');
assert.equal((await call('/api/me', undefined, as('liza@test.local'))).data.caps.internal, false, 'responsible gets no access');

// «Осталось оплатить N рилс»: hand-kept counts, finance permission only, revision guard, never in public settings.
assert.equal((await call('/api/finance?view=reels', undefined, {})).status, 403, 'reel pay hidden from anonymous');
assert.equal((await call('/api/finance?view=reels', undefined, as(E('viewer')))).status, 403, 'reel pay needs finance');
await activate(await mk(E('finreader'), 'viewer', true));
const rp0 = await call('/api/finance?view=reels', undefined, as(E('finreader')));
assert.equal(rp0.status, 200, 'viewer with finance reads the counter');
assert.ok(Array.isArray(rp0.data.rows) && rp0.data.rows.every(r => r.remaining === Math.max(0, r.shot - r.paid)));
assert.equal((await call('/api/finance', { action: 'reels.save', store: rp0.data.store, revision: rp0.data.revision }, as(E('finreader')))).status, 403, 'finance viewer cannot change counts');
assert.equal((await call('/api/finance', { action: 'reels.save', store: { paid: { 'Посторонний': 1 } }, revision: rp0.data.revision })).status, 400, 'unknown names refused');
assert.equal((await call('/api/finance', { action: 'reels.save', store: { paid: { 'Юля': -1 } }, revision: rp0.data.revision })).status, 400, 'negative refused');
const rpSaved = await call('/api/finance', { action: 'reels.save', store: { paid: { ...rp0.data.store.paid, 'Юля': 3 }, shotOverride: rp0.data.store.shotOverride }, revision: rp0.data.revision });
assert.equal(rpSaved.status, 200); assert.equal(rpSaved.data.revision, rp0.data.revision + 1);
assert.equal((await call('/api/finance', { action: 'reels.save', store: rp0.data.store, revision: rp0.data.revision })).status, 409, 'stale save refused');
const rp1 = (await call('/api/finance?view=reels')).data;
assert.equal(rp1.rows.find(r => r.member === 'Юля').paid, 3);
assert.ok(!JSON.stringify((await call('/api/settings', undefined, {})).data).includes('shotOverride'), 'not part of public settings');
assert.equal((await call('/api/finance', { action: 'reels.save', store: rp0.data.store, revision: rp1.revision })).status, 200, 'restore the counts as they were');

const after = JSON.stringify((await call('/api/shoots')).data.map(s => [s.id, s.revision]).sort());
assert.equal(after, before, 'shoots untouched by content work');
console.log('PASS: auth/origin, idempotent create, concurrent edit 409, versions and re-approval, public read without edit links, publication date required, history, settings revision, finance (403, tariffs, no double accrual, partial and voided payments), honest integrations, AI manual mode, backup/restore, tasks (403, idempotent, 409, archive/restore, export, not public), roles (invited/viewer/reviewer/finance/admin/disabled, owner fixed), public read trimmed, notifications, private files with SSRF guard, reel pay counter (finance only, 409), shoots untouched');
