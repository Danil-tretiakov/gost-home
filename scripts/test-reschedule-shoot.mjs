import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['lib/reschedule-shoot.ts'], bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022' });
const { suggestRescheduleDates, conflictingShoots, validateRescheduleDate } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const shoot = (id, date, time = '10:00', changes = {}) => ({ id, date, time, duration: 60, status: 'Запланировано', participants: ['Марк'], ...changes });
const now = new Date('2026-11-03T02:00:00Z'); // 09:00 Bangkok.
const original = shoot('own', '2026-11-06');
assert.deepEqual(suggestRescheduleDates(original, [], now), ['2026-11-07', '2026-11-08', '2026-11-09']);
const candidate = { ...original, date: '2026-11-07' };
const conflicts = [
  shoot('same-start', '2026-11-07'),
  shoot('overlap', '2026-11-07', '09:30'),
  shoot('idea', '2026-11-07', '10:00', { status: 'Идея' }),
];
const free = [
  original,
  shoot('own', '2026-11-07'),
  shoot('adjacent-before', '2026-11-07', '09:00'),
  shoot('adjacent-after', '2026-11-07', '11:00'),
  shoot('other-person', '2026-11-07', '10:00', { participants: ['Юля'] }),
  ...['Отменено', 'Снято', 'Монтаж', 'Опубликовано'].map((status, i) => shoot(`finished-${i}`, '2026-11-07', '10:00', { status })),
  shoot('invalid-date', '2026-02-30'),
  shoot('invalid-time', '2026-11-07', '27:00'),
  shoot('invalid-duration', '2026-11-07', '10:00', { duration: 0 }),
];
const rows = [...conflicts, ...free];
const snapshot = structuredClone(rows);
rows.forEach(Object.freeze);Object.freeze(rows);Object.freeze(original);
assert.deepEqual(conflictingShoots(candidate, rows).map(row => row.id), ['same-start', 'overlap', 'idea']);
assert.equal(conflictingShoots(candidate, rows)[0], rows[0]);
assert.deepEqual(conflictingShoots({ ...candidate, participants: [] }, rows), []);
assert.deepEqual(suggestRescheduleDates(original, rows, now), ['2026-11-08', '2026-11-09', '2026-11-10']);
assert.deepEqual(rows, snapshot);
assert.deepEqual(conflictingShoots(shoot(undefined, '2026-11-07'), [shoot(undefined, '2026-11-07')]).length, 1);

// Shared participants are detected even when neither event begins on the other's date.
const overnight = shoot('night', '2026-11-07', '23:30', { duration: 90 });
assert.deepEqual(conflictingShoots(overnight, [shoot('next-day', '2026-11-08', '00:30')]).map(row => row.id), ['next-day']);
assert.deepEqual(conflictingShoots(shoot('early', '2026-11-08', '00:30'), [overnight]).map(row => row.id), ['night']);
assert.deepEqual(conflictingShoots(overnight, [shoot('boundary', '2026-11-08', '01:00')]), []);
assert.deepEqual(conflictingShoots({ ...overnight, date: 'invalid' }, rows), []);
assert.deepEqual(conflictingShoots({ ...candidate, participants: ['Лиза', 'Юля'] }, [shoot('one-common', '2026-11-07', '10:00', { participants: ['Юля', 'Андрей'] })]).length, 1);

const past = shoot('past', '2026-10-01');
assert.deepEqual(suggestRescheduleDates(past, [], now), ['2026-11-03', '2026-11-04', '2026-11-05']);
assert.deepEqual(suggestRescheduleDates(past, [], new Date('2026-11-03T03:00:00Z')), ['2026-11-04', '2026-11-05', '2026-11-06']);
const midnight = new Date('2026-11-02T17:15:00Z');
assert.deepEqual(suggestRescheduleDates(past, [], midnight, 1), ['2026-11-03']);
assert.deepEqual(suggestRescheduleDates(shoot('year', '2026-12-31'), [], now, 2), ['2027-01-01', '2027-01-02']);
assert.equal(validateRescheduleDate('2026-11-07', original, now), null);
assert(validateRescheduleDate(original.date, original, now));
assert(validateRescheduleDate('2026-11-02', original, now));
assert(validateRescheduleDate('2026-02-30', original, now));
assert(validateRescheduleDate('2026-11-07', { ...original, time: 'bad' }, now));
assert(validateRescheduleDate('2026-11-07', original, new Date('invalid')));
assert.deepEqual(suggestRescheduleDates({ ...original, date: '2026-02-30' }, [], now), []);
assert.deepEqual(suggestRescheduleDates(original, [], new Date('invalid')), []);
assert.deepEqual(suggestRescheduleDates(original, [], now, 0), []);
assert.deepEqual(suggestRescheduleDates(original, [], now, NaN), []);
const busy = Array.from({ length: 30 }, (_, index) => {
  const date = new Date('2026-11-07T00:00:00Z');date.setUTCDate(date.getUTCDate() + index);
  return shoot(`busy-${index}`, date.toISOString().slice(0, 10));
});
assert.deepEqual(suggestRescheduleDates(original, busy, now), []);
console.log('PASS: suggestions, shared participants, adjacent/overnight overlaps, cancelled/completed exclusion, self IDs, Bangkok day/year boundaries, date validation, busy horizon, input immutability');
