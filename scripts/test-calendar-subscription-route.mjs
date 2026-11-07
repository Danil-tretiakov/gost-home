import assert from 'node:assert/strict';
import { build } from 'esbuild';

const ids = Array.from({ length: 6 }, (_, index) => `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`);
const base = {
  title: 'Проверка подписки', date: '2099-11-10', time: '10:00', duration: 60,
  format: 'Reels', status: 'Запланировано', project: '', location: '', participants: ['Лада'],
  notes: 'Сценарий', preparation: 'Взять одежду', revision: 2,
};
const fixtures = Object.fromEntries([
  [ids[0], { ...base, id: ids[0] }],
  [ids[1], { ...base, id: ids[1], date: '2000-01-01' }],
  [ids[2], { ...base, id: ids[2], status: 'Отменено' }],
  [ids[3], { ...base, id: ids[3], status: 'Снято' }],
  [ids[4], null],
]);
const compiled = await build({
  entryPoints: ['app/events/[id]/subscription.ics/route.ts'], bundle: true, write: false,
  platform: 'neutral', format: 'esm', target: 'es2022',
  plugins: [{
    name: 'subscription-database-fixture',
    setup(bundle) {
      bundle.onLoad({ filter: /[/\\]lib[/\\]get-shoot\.ts$/ }, () => ({
        contents: `const fixtures = ${JSON.stringify(fixtures)};
          export async function getShootById(id) {
            if (id === ${JSON.stringify(ids[5])}) throw new Error('database unavailable');
            if (!(id in fixtures)) throw new Error('unexpected database query');
            return fixtures[id];
          }`,
        loader: 'js',
      }));
    },
  }],
});
const { GET } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const request = id => GET(new Request(`https://gost-home.example/events/${id}/subscription.ics`), { params: Promise.resolve({ id }) });
for (const [index, id] of ids.slice(0, 5).entries()) {
  const response = await request(id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-disposition'), null);
  const content = (await response.text()).replace(/\r\n[ \t]/g, '');
  assert(content.endsWith('END:VCALENDAR\r\n'));
  if (index === 4) {
    assert(!content.includes('BEGIN:VEVENT'));
  } else {
    assert(content.includes(`UID:${id}@gost-home-calendar`));
    assert.equal(content.includes('BEGIN:VALARM'), index === 0);
  }
  if (index === 2) assert(content.includes('STATUS:CANCELLED'));
}
assert.equal((await request('not-a-uuid')).status, 404);
const unavailable = await request(ids[5]);
assert.equal(unavailable.status, 503);
assert(!unavailable.headers.get('content-type')?.startsWith('text/calendar'));
console.log('PASS: subscription HTTP contract for future/past/cancelled/completed/deleted events, invalid IDs, database failure, calendar content type and no download disposition');
