// v28: roles, team, week view, file storage guards, notifications, autoplan month boundary, restore safety,
// and contract tests of the Higgsfield / Instagram adapters against a mocked fetch (no network, no keys, no paid calls).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const stub = fileURLToPath(new URL('./stubs/cloudflare-workers.mjs', import.meta.url));
const cfAlias = { name: 'cf', setup(b) { b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: stub })); } };
async function load(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', plugins: [cfAlias] });
  const f = new URL(`../node_modules/.cache/v28_${entry.replaceAll('/', '_')}.mjs`, import.meta.url);
  mkdirSync(new URL('.', f), { recursive: true }); writeFileSync(f, out.outputFiles[0].text);
  return import(f.href + '?' + Date.now());
}
const R = await load('lib/rbac.ts');
const T = await load('lib/team.ts');
const Wk = await load('lib/week.ts');
const Fc = await load('lib/files-core.ts');
const Fl = await load('lib/files.ts');
const N = await load('lib/notifications.ts');
const { autoplan } = await load('lib/autoplan.ts');
const { DEFAULT_PLAN } = await load('lib/plan-settings.ts');
const B = await load('lib/backup.ts');
const HF = await load('lib/integrations/higgsfield.ts');
const IG = await load('lib/integrations/instagram.ts');
const CR = await load('lib/integrations/crypto.ts');
let passed = 0; const ok = () => passed++;

/* ── Roles ── */
{
  const OWNER = 'Owner@Example.com';
  const user = (email) => ({ email, displayName: 'X' });
  const member = (o) => ({ email: 'a@b.co', displayName: 'A', memberName: 'Юля', role: 'reviewer', finance: 0, status: 'active', ...o });
  const own = R.resolveAccess(user('owner@example.com'), OWNER, null);
  assert.equal(own.role, 'owner'); assert.deepEqual(own.caps, { internal: true, edit: true, review: true, admin: true, finance: true });
  // The owner keeps full access even if a stray row with the owner's email existed.
  assert.equal(R.resolveAccess(user('owner@example.com'), OWNER, member({ email: 'owner@example.com', role: 'viewer', status: 'disabled' })).caps.admin, true);
  assert.deepEqual(R.resolveAccess(null, OWNER, null).caps, R.NO_CAPS, 'anonymous: nothing');
  assert.deepEqual(R.resolveAccess(user('a@b.co'), OWNER, null).caps, R.NO_CAPS, 'signed in, no row: nothing');
  assert.deepEqual(R.resolveAccess(user('a@b.co'), OWNER, member({ status: 'invited' })).caps, R.NO_CAPS, 'prepared invitation grants nothing');
  assert.deepEqual(R.resolveAccess(user('a@b.co'), OWNER, member({ status: 'disabled' })).caps, R.NO_CAPS, 'disabled grants nothing');
  assert.deepEqual(R.resolveAccess(user('other@b.co'), OWNER, member()).caps, R.NO_CAPS, 'email must match exactly');
  assert.deepEqual(R.resolveAccess(user('a@b.co'), OWNER, member({ email: null })).caps, R.NO_CAPS, 'row without email grants nothing');
  const rev = R.resolveAccess(user('A@B.co'), OWNER, member());
  assert.deepEqual(rev.caps, { internal: true, edit: false, review: true, admin: false, finance: false }, 'reviewer, case-insensitive email');
  assert.equal(R.resolveAccess(user('a@b.co'), OWNER, member({ role: 'viewer', finance: 1 })).caps.finance, true, 'finance is a separate flag');
  assert.equal(R.resolveAccess(user('a@b.co'), OWNER, member({ role: 'viewer' })).caps.edit, false);
  assert.equal(R.resolveAccess(user('a@b.co'), OWNER, member({ role: 'admin' })).caps.finance, false, 'admin without finance flag has no finance');
  assert.equal(R.resolveAccess(user('a@b.co'), OWNER, member({ role: 'superuser' })).caps.internal, false, 'unknown role: nothing');
  assert.ok(R.canReviewTransition('awaiting_feedback', 'approved') && R.canReviewTransition('awaiting_feedback', 'changes_requested'));
  assert.ok(!R.canReviewTransition('editing', 'awaiting_feedback') && !R.canReviewTransition('approved', 'published'));
  ok();
}
/* ── Team input ── */
{
  const OWNER = 'owner@example.com';
  assert.equal(T.parseTeamInput({ displayName: 'Андрей', role: 'reviewer' }, OWNER).ok, true, 'no email: allowed as a prepared entry');
  assert.equal(T.parseTeamInput({ displayName: 'Андрей', role: 'reviewer' }, OWNER).fields.email, null);
  assert.equal(T.parseTeamInput({ displayName: 'X', email: 'Owner@Example.com', role: 'admin' }, OWNER).ok, false, 'owner cannot be configured');
  assert.equal(T.parseTeamInput({ displayName: 'X', email: 'not-an-email', role: 'admin' }, OWNER).ok, false);
  assert.equal(T.parseTeamInput({ displayName: 'X', email: ' A@B.CO ', role: 'viewer' }, OWNER).fields.email, 'a@b.co');
  assert.equal(T.parseTeamInput({ displayName: 'X', role: 'owner' }, OWNER).ok, false, 'owner role cannot be assigned');
  assert.equal(T.parseTeamInput({ displayName: '', role: 'viewer' }, OWNER).ok, false);
  assert.equal(T.parseTeamInput({ displayName: 'X', role: 'viewer', memberName: 'Незнакомец' }, OWNER).ok, false);
  ok();
}
/* ── Week view dates ── */
{
  assert.equal(Wk.weekStart('2026-11-22'), '2026-11-16', 'Sunday belongs to the week starting Monday');
  assert.equal(Wk.weekStart('2026-11-16'), '2026-11-16');
  assert.equal(Wk.weekStart('2027-01-01'), '2026-12-28');
  assert.deepEqual(Wk.weekDays('2026-11-30'), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
  assert.equal(Wk.weekLabel('2026-11-16'), '16–22 ноября 2026');
  assert.equal(Wk.weekLabel('2026-11-30'), '30 ноября – 6 декабря 2026');
  assert.equal(Wk.weekLabel('2026-12-28'), '28 декабря 2026 – 3 января 2027');
  assert.equal(Wk.shiftWeek('2026-12-28', 1), '2027-01-04');
  assert.equal(Wk.shiftWeek('2026-03-02', -1), '2026-02-23');
  assert.deepEqual(Wk.endTime('10:00', 90), { time: '11:30', nextDay: false });
  assert.deepEqual(Wk.endTime('23:30', 60), { time: '00:30', nextDay: true });
  assert.equal(Wk.monthOfWeek('2026-11-30'), '2026-12', 'week of 30 Nov counts to December (Thursday rule)');
  // Independent of the machine time zone: the helpers only use UTC arithmetic on date strings.
  const tz = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  assert.equal(Wk.weekStart('2026-11-22'), '2026-11-16'); process.env.TZ = tz;
  ok();
}
/* ── File checks ── */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const ascii = s => [...s].map(c => c.charCodeAt(0));
const MP4 = Uint8Array.from([0, 0, 0, 24, ...ascii('ftypisom'), 0, 0, 0, 0]);
const MOV = Uint8Array.from([0, 0, 0, 20, ...ascii('ftypqt  '), 0, 0, 0, 0]);
const HEIC = Uint8Array.from([0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0]);
const WEBP = Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]);
const HTML = Uint8Array.from(ascii('<html><script>alert(1)</script>'));
{
  assert.equal(Fc.sniff(PNG), 'image/png'); assert.equal(Fc.sniff(JPG), 'image/jpeg'); assert.equal(Fc.sniff(WEBP), 'image/webp');
  assert.equal(Fc.sniff(MP4), 'video/mp4'); assert.equal(Fc.sniff(MOV), 'video/quicktime'); assert.equal(Fc.sniff(HEIC), null, 'HEIC is not video');
  assert.equal(Fc.sniff(HTML), null);
  assert.equal(Fc.checkFile(HTML, 100, 'image/png').ok, false, 'HTML disguised as PNG refused');
  assert.equal(Fc.checkFile(PNG, 100, 'video/mp4').ok, false, 'declared kind must match bytes');
  assert.equal(Fc.checkFile(PNG, 100, 'image/jpeg').mime, 'image/png', 'sniffed type wins within the same kind');
  assert.equal(Fc.checkFile(PNG, 21 * 1024 * 1024, 'image/png').ok, false, 'image size cap');
  assert.equal(Fc.checkFile(MP4, 90 * 1024 * 1024, 'video/mp4').ok, true);
  assert.equal(Fc.checkFile(MP4, 96 * 1024 * 1024, 'video/mp4').ok, false, 'video size cap');
  assert.equal(Fc.checkFile(PNG, 0, 'image/png').ok, false);
  assert.equal(Fc.safeFileName('../../etc/passwd', 'image/png'), '_.._etc_passwd.png');
  assert.equal(Fc.safeFileName('evil.html', 'image/png'), 'evil.png');
  assert.equal(Fc.safeFileName('кадр.JPG', 'image/jpeg'), 'кадр.jpg');
  assert.match(Fc.contentDisposition('attachment', 'кадр "1".png'), /^attachment; filename="[^"]*"; filename\*=UTF-8''/);
  const bad = ['http://example.com/a.png', 'https://127.0.0.1/a', 'https://10.0.0.5/a', 'https://169.254.169.254/latest', 'https://[::1]/a', 'https://localhost/a',
    'https://foo.localhost/a', 'https://printer.local/a', 'https://db.internal/a', 'https://metadata.google.internal/a', 'https://example.com:8443/a',
    'https://user:pw@example.com/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://intranet/a', 'ftp://example.com/a', 'javascript:alert(1)'];
  for (const u of bad) assert.equal(Fc.safeFetchUrl(u), null, 'refused: ' + u);
  assert.ok(Fc.safeFetchUrl('https://cdn.higgsfield.ai/r/abc.png')); assert.ok(Fc.safeFetchUrl('https://example.com:443/a.png'));
  assert.deepEqual(Fc.parseRange('bytes=0-99', 1000), { offset: 0, length: 100 });
  assert.deepEqual(Fc.parseRange('bytes=900-', 1000), { offset: 900, length: 100 });
  assert.deepEqual(Fc.parseRange('bytes=-100', 1000), { offset: 900, length: 100 });
  assert.equal(Fc.parseRange('bytes=1000-', 1000), 'invalid'); assert.equal(Fc.parseRange(null, 10), null);
  const now = 1_800_000_000;
  const sig = await Fc.signLink('s3cret', 'asset-1', now + 600);
  assert.equal(await Fc.verifyLink('s3cret', 'asset-1', now + 600, sig, now), true);
  assert.equal(await Fc.verifyLink('s3cret', 'asset-2', now + 600, sig, now), false, 'link bound to one asset');
  assert.equal(await Fc.verifyLink('other', 'asset-1', now + 600, sig, now), false, 'wrong secret');
  assert.equal(await Fc.verifyLink('s3cret', 'asset-1', now + 600, sig, now + 601), false, 'expired');
  assert.equal(await Fc.verifyLink('s3cret', 'asset-1', now + 7200, await Fc.signLink('s3cret', 'asset-1', now + 7200), now), false, 'more than 1 hour refused');
  ok();
}
/* ── Fetch into storage (mock fetch, mock bucket) ── */
{
  const store = new Map();
  const bucket = { put: async (k, v, o) => { store.set(k, { v, o }); }, get: async () => null, head: async () => null, delete: async k => { store.delete(k); } };
  const resp = (status, body, headers = {}) => new Response(body, { status, headers });
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, init?.redirect]);
    const u = new URL(url);
    if (u.pathname === '/redirect-private') return resp(302, null, { location: 'https://169.254.169.254/latest/meta-data' });
    if (u.pathname === '/redirect-ok') return resp(301, null, { location: '/img.png' });
    if (u.pathname === '/loop') return resp(302, null, { location: '/loop' });
    if (u.pathname === '/img.png') return resp(200, PNG, { 'content-type': 'image/png' });
    if (u.pathname === '/html') return resp(200, HTML, { 'content-type': 'image/png' });
    if (u.pathname === '/big') return resp(200, new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); } }), { 'content-type': 'video/mp4' });
    if (u.pathname === '/biglen') return resp(200, PNG, { 'content-type': 'image/png', 'content-length': String(500 * 1024 * 1024) });
    return resp(404, 'no');
  };
  assert.match((await Fl.fetchToBucket(bucket, 'a1', 'https://evil.example.com/redirect-private', fetcher)).error, /запрещённый/);
  assert.equal(calls.every(c => c[1] === 'manual'), true, 'redirects are never followed automatically');
  assert.equal(calls.some(c => c[0].includes('169.254')), false, 'private target never requested');
  const okRes = await Fl.fetchToBucket(bucket, 'a2', 'https://cdn.example.com/redirect-ok', fetcher);
  assert.equal(okRes.mime, 'image/png'); assert.equal(okRes.storageKey, 'ai/a2'); assert.ok(store.has('ai/a2'));
  assert.match((await Fl.fetchToBucket(bucket, 'a3', 'https://cdn.example.com/loop', fetcher)).error, /перенаправлений/);
  assert.match((await Fl.fetchToBucket(bucket, 'a4', 'https://cdn.example.com/html', fetcher)).error, /Тип не поддерживается/);
  assert.match((await Fl.fetchToBucket(bucket, 'a5', 'https://cdn.example.com/big', fetcher)).error, /слишком большой/, 'streamed size cap');
  assert.match((await Fl.fetchToBucket(bucket, 'a6', 'https://cdn.example.com/biglen', fetcher)).error, /слишком большой/, 'declared size cap');
  assert.match((await Fl.fetchToBucket(bucket, 'a7', 'http://cdn.example.com/img.png', fetcher)).error, /только https/);
  assert.deepEqual([...store.keys()], ['ai/a2'], 'nothing stored for refused files');
  globalThis.__TEST_ENV__ = {}; assert.equal(Fl.bucket(), null, 'no binding: storage not connected');
  globalThis.__TEST_ENV__ = { BUCKET: bucket }; assert.ok(Fl.bucket());
  ok();
}
/* ── Notifications ── */
{
  const caps = R.capsFor('owner', true);
  const now = new Date('2026-11-19T05:00:00Z'); // 12:00 in Bangkok
  const task = o => ({ id: 't' + Math.random(), title: 'T', notes: '', assignee: 'Юля', dueDate: '2026-11-18', dueTime: null, priority: 'normal', status: 'todo', shootId: null, contentId: null, completedAt: null, archivedAt: null, archivedBy: null, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', revision: 1, ...o });
  const content = o => ({ id: 'c' + Math.random(), title: 'C', productionStatus: 'planned', plannedPublishDate: null, responsible: null, primaryMember: 'Юля', updatedAt: '2026-11-18T00:00:00Z', ...o });
  const input = {
    memberName: 'Юля', now, jobs: [], assets: [], shoots: [], instagram: { status: 'connected', tokenExpiresAt: '2026-11-25T00:00:00Z', lastError: null },
    tasks: [task({ id: 'over' }), task({ id: 'today', dueDate: '2026-11-19', assignee: 'Марк' }), task({ id: 'done', status: 'done' }), task({ id: 'arch', archivedAt: 'x' }), task({ id: 'later', dueDate: '2026-11-30' })],
    content: [content({ id: 'await', productionStatus: 'awaiting_feedback' }), content({ id: 'late', plannedPublishDate: '2026-11-17', productionStatus: 'approved' }), content({ id: 'pub', plannedPublishDate: '2026-11-17', productionStatus: 'published' })],
  };
  const all = N.buildNotifications({ ...input, caps });
  const keys = all.map(n => n.key.split(':').slice(0, 2).join(':'));
  for (const k of ['task-overdue:over', 'task-due:today', 'content-awaiting:await', 'content-late:late']) assert.ok(keys.includes(k), 'has ' + k);
  for (const k of ['task-overdue:done', 'task-overdue:arch', 'task-due:later', 'content-late:pub']) assert.ok(!keys.some(x => x.startsWith(k)), 'no ' + k);
  assert.ok(all.some(n => n.key.startsWith('ig-token:')), 'token expiry warning for admin');
  assert.equal(all[0].mine, true, 'own items first');
  const viewer = N.buildNotifications({ ...input, caps: R.capsFor('viewer', false) });
  assert.ok(!viewer.some(n => n.key.startsWith('content-awaiting') || n.key.startsWith('content-late') || n.key.startsWith('ig-')), 'viewer: no review/edit/admin items');
  const reviewer = N.buildNotifications({ ...input, caps: R.capsFor('reviewer', false) });
  assert.ok(reviewer.some(n => n.key.startsWith('content-awaiting')), 'reviewer sees approvals');
  assert.deepEqual(N.buildNotifications({ ...input, caps: R.NO_CAPS }), [], 'no role: nothing');
  ok();
}
/* ── Autoplan across the month boundary ── */
{
  const plan = { ...DEFAULT_PLAN, members: { ...DEFAULT_PLAN.members } };
  const prev = { id: 'p', revision: 1, type: 'reel', title: 'Oct', primaryMember: 'Юля', plannedPublishDate: '2026-11-30', publishedAt: null, productionStatus: 'approved' };
  const r = autoplan([prev], '2026-12', '2026-11-19', plan, { fillEmpty: true });
  const firstYulia = r.slots.filter(s => s.member === 'Юля').map(s => s.date).sort()[0];
  assert.ok(firstYulia >= '2026-12-03', `Юля continues the rhythm from 30 Nov: first December date ${firstYulia}`);
  const pub = { ...prev, plannedPublishDate: null, publishedAt: '2026-11-29', productionStatus: 'published' };
  const r2 = autoplan([pub], '2026-12', '2026-11-19', plan, { fillEmpty: true });
  assert.ok(r2.slots.filter(s => s.member === 'Юля').map(s => s.date).sort()[0] >= '2026-12-02', 'published date in the previous month also counts');
  assert.equal(r.members.find(m => m.member === 'Юля').existing, 0, 'previous month item does not count toward December quota');
  ok();
}
/* ── Restore never grants access ── */
{
  const cols = { team_members: ['id', 'email', 'display_name', 'member_name', 'role', 'finance', 'status', 'note', 'first_seen_at', 'last_seen_at', 'created_at', 'created_by', 'updated_at', 'updated_by', 'revision'] };
  const row = { id: 'm1', email: 'a@b.co', display_name: 'A', member_name: null, role: 'admin', finance: 1, status: 'active', note: '', first_seen_at: 'x', last_seen_at: 'y', created_at: 'c', created_by: 'o', updated_at: 'u', updated_by: 'o', revision: 3 };
  const { inserts } = B.planRestore({ team_members: [row] }, cols, { team_members: new Set() });
  const v = Object.fromEntries(inserts[0].cols.map((c, i) => [c, inserts[0].values[i]]));
  assert.equal(v.status, 'invited'); assert.equal(v.first_seen_at, null); assert.equal(v.role, 'admin');
  const n = B.normalizeBackup({ format: 'gost-home-backup', version: 1, tables: { integration_connections: [{ provider: 'instagram', token_cipher: 'x' }] } });
  assert.equal(n.tables.integration_connections, undefined, 'connections (tokens) are never restored');
  ok();
}
/* ── Higgsfield adapter contract (mocked fetch) ── */
{
  globalThis.__TEST_ENV__ = {};
  assert.equal(HF.higgsfieldConfigured(), false, 'no keys: not configured');
  await assert.rejects(HF.submit('higgsfield-ai/soul/v2/standard', { prompt: 'x' }, 'k'), /not_configured/, 'no request without keys');
  globalThis.__TEST_ENV__ = { HF_API_KEY_ID: 'kid', HF_API_KEY_SECRET: 'ksec' };
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    if (String(url).endsWith('/requests/r1/status')) return new Response(JSON.stringify({ status: 'completed', request_id: 'r1', images: [{ url: 'https://cdn.higgsfield.ai/r1.png' }], expires_at: 1800000000 }), { status: 200 });
    if (String(url).includes('bad-endpoint')) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify({ status: 'queued', request_id: 'r1', status_url: 'https://api.higgsfield.ai/requests/r1/status' }), { status: 200 });
  };
  try {
    const s = await HF.submit('higgsfield-ai/soul/v2/standard', { prompt: 'вилла' }, 'idem-1');
    assert.equal(seen[0].url, 'https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard'); assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].headers.Authorization, 'Key kid:ksec'); assert.equal(seen[0].headers['Idempotency-Key'], 'idem-1');
    assert.deepEqual(JSON.parse(seen[0].body), { prompt: 'вилла' });
    assert.equal(s.status, 'queued'); assert.equal(s.statusUrl, 'https://api.higgsfield.ai/requests/r1/status');
    const p = await HF.poll(s.statusUrl);
    assert.equal(p.status, 'completed'); assert.deepEqual(p.resultUrls, ['https://cdn.higgsfield.ai/r1.png']); assert.equal(p.expiresAt, new Date(1800000000 * 1000).toISOString());
    const before = seen.length;
    assert.equal((await HF.poll('https://evil.example.com/requests/r1/status')).status, 'error'); assert.equal(seen.length, before, 'foreign status URL never fetched');
    const e = await HF.submit('bad-endpoint/x', {}, 'idem-2'); assert.equal(e.status, 'error'); assert.match(e.error, /HTTP 404/);
  } finally { globalThis.fetch = realFetch; }
  ok();
}
/* ── Instagram adapter contract (mocked fetch) ── */
{
  const key = Buffer.alloc(32, 7).toString('base64');
  globalThis.__TEST_ENV__ = { IG_APP_ID: '123', IG_APP_SECRET: 'appsecret', TOKEN_ENCRYPTION_KEY: key };
  assert.equal(IG.instagramConfigured(), true);
  const seen = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); seen.push({ u, method: init.method ?? 'GET', body: init.body });
    if (u.searchParams.get('access_token') === 'BAD') return Response.json({ error: { message: 'Invalid OAuth access token' } }, { status: 400 });
    if (u.href === 'https://api.instagram.com/oauth/access_token') return Response.json({ data: [{ access_token: 'SHORT', user_id: 42, permissions: 'instagram_business_basic' }] });
    if (u.pathname === '/access_token') return Response.json({ access_token: 'LONG', token_type: 'bearer', expires_in: 5_184_000 });
    if (u.pathname === '/refresh_access_token') return Response.json({ access_token: 'LONG2', token_type: 'bearer', expires_in: 5_184_000 });
    if (u.pathname.endsWith('/me')) return Response.json({ user_id: '1784', username: 'gosthome' });
    if (u.pathname.endsWith('/me/media') && !u.searchParams.get('after')) return Response.json({ data: [{ id: '1', timestamp: '2026-11-19T15:30:00+0000', media_type: 'VIDEO', media_product_type: 'REELS', like_count: 5 }, { id: 'broken' }], paging: { next: 'https://graph.instagram.com/v25.0/me/media?after=X&access_token=LONG' } });
    if (u.pathname.endsWith('/me/media')) return Response.json({ data: [{ id: '2', timestamp: '2026-11-18T10:00:00+0000', media_type: 'IMAGE' }], paging: { next: 'https://evil.example.com/steal' } });
    return Response.json({ error: { message: 'Invalid OAuth access token' } }, { status: 400 });
  };
  try {
    const r = await IG.exchangeCode('CODE', 'https://site.example');
    const form = new URLSearchParams(seen[0].body);
    assert.equal(seen[0].method, 'POST'); assert.equal(form.get('client_id'), '123'); assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('redirect_uri'), 'https://site.example/api/integrations/instagram/callback'); assert.equal(form.get('code'), 'CODE');
    assert.equal(seen[1].u.searchParams.get('grant_type'), 'ig_exchange_token'); assert.equal(seen[1].u.searchParams.get('access_token'), 'SHORT');
    assert.equal(r.accountName, 'gosthome'); assert.ok(!r.cipher.includes('LONG'), 'token stored encrypted only');
    assert.equal(await CR.decryptToken(r.cipher, key), 'LONG');
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const u1 = await IG.usableToken(r.cipher, soon); assert.equal(u1.token, 'LONG2', 'refreshed when < 7 days remain'); assert.ok(u1.refreshed);
    const u2 = await IG.usableToken(r.cipher, new Date(Date.now() + 30 * 86_400_000).toISOString()); assert.equal(u2.refreshed, null);
    await assert.rejects(IG.usableToken(r.cipher, new Date(Date.now() - 1000).toISOString()), /истёк/);
    const n0 = seen.length;
    const media = await IG.fetchMedia('LONG');
    assert.deepEqual(media.map(m => m.mediaId), ['1', '2'], 'broken items skipped, next page followed');
    assert.equal(media[1].likeCount, null, 'missing metric stays null, not zero');
    assert.equal(seen.slice(n0).some(s => s.u.hostname === 'evil.example.com'), false, 'foreign paging link never followed');
    await assert.rejects(IG.fetchMedia('BAD', 1), /Instagram 400: Invalid OAuth access token/, 'API errors surface with the provider message');
  } finally { globalThis.fetch = realFetch; }
  globalThis.__TEST_ENV__ = { IG_APP_ID: '123' };
  assert.equal(IG.instagramConfigured(), false, 'partial secrets: not configured');
  await assert.rejects(IG.exchangeCode('CODE', 'https://x.example'), /not_configured/);
  ok();
}
console.log(`test-v28: ${passed} groups passed`);
