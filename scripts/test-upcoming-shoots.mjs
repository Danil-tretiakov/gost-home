import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['lib/upcoming-shoots.ts'], bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022' });
const { getUpcomingShoots, upcomingDayLabel } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const shoot = (id, date, time, overrides = {}) => ({ id, date, time, duration: 60, status: 'Запланировано', ...overrides });
const now = new Date('2026-11-03T03:30:00Z'); // 10:30 in Bangkok.
const ongoing = shoot('ongoing', '2026-11-03', '10:00');
const input = [
  shoot('later-month', '2026-12-01', '09:00'),
  shoot('tomorrow', '2026-11-04', '08:00', { status: 'Идея' }),
  shoot('past', '2026-11-03', '09:00'),
  shoot('ends-now', '2026-11-03', '09:30'),
  ongoing,
  shoot('next', '2026-11-03', '11:00'),
  ...['Отменено', 'Снято', 'Монтаж', 'Опубликовано', 'Неизвестно'].map((status, i) => shoot('excluded-' + i, '2026-11-03', '10:31', { status })),
  shoot('bad-date', '2026-02-30', '10:00'),
  shoot('bad-time', '2026-11-03', '25:00'),
  shoot('bad-duration', '2026-11-03', '11:00', { duration: 0 }),
];
const original = structuredClone(input);
input.forEach(Object.freeze);Object.freeze(input);
assert.deepEqual(getUpcomingShoots(input, now).map(item => item.id), ['ongoing', 'next', 'tomorrow']);
assert.deepEqual(input, original);
assert.equal(getUpcomingShoots(input, now)[0], ongoing);
assert.deepEqual(getUpcomingShoots(input, now, 10).map(item => item.id), ['ongoing', 'next', 'tomorrow', 'later-month']);
assert.deepEqual(getUpcomingShoots(input, now, 1).map(item => item.id), ['ongoing']);
assert.deepEqual(getUpcomingShoots(input, now, 0), []);
assert.deepEqual(getUpcomingShoots(input, now, NaN), []);
assert.deepEqual(getUpcomingShoots(input, new Date('invalid')), []);
assert.deepEqual(getUpcomingShoots([], now), []);
const ties = [shoot('b', '2026-11-04', '09:00'), shoot('a', '2026-11-04', '09:00')];
assert.deepEqual(getUpcomingShoots(ties, now).map(item => item.id), ['a', 'b']);

// Bangkok is already in the next day while UTC still reads November 2.
const midnight = new Date('2026-11-02T17:15:00Z');
assert.equal(upcomingDayLabel('2026-11-03', midnight), 'Сегодня');
assert.equal(upcomingDayLabel('2026-11-04', midnight), 'Завтра');
assert.equal(upcomingDayLabel('2026-11-06', midnight), new Intl.DateTimeFormat('ru', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date('2026-11-06T00:00:00+07:00')));
assert.equal(upcomingDayLabel('2027-01-01', new Date('2026-12-31T16:59:00Z')), 'Завтра');
assert.equal(upcomingDayLabel('2027-01-01', new Date('2026-12-31T17:00:00Z')), 'Сегодня');
assert.equal(upcomingDayLabel('2026-02-30', midnight), '');
assert.equal(upcomingDayLabel('2026-11-03', new Date('invalid')), '');
const crossingMidnight = shoot('cross-midnight', '2026-11-02', '23:30', { duration: 90 });
assert.equal(getUpcomingShoots([crossingMidnight], midnight)[0], crossingMidnight);
assert.deepEqual(getUpcomingShoots([crossingMidnight], new Date('2026-11-02T18:00:00Z')), []);
console.log('PASS: nearest ordering/limit, planned statuses, ongoing/finished, Bangkok midnight and year rollover, invalid data, no input mutation');
