import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle only this pure formatter so tests need no server, database, or browser.
const compiled = await build({ entryPoints: ['lib/event-calendar.ts'], bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022' });
const { eventTimes, eventCalendar } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const now = new Date('2026-11-03T00:00:00Z');
const shoot = {
  id: '24409564-a4d4-450d-a2cb-0fd0d48fa331', title: 'Обзор виллы', date: '2026-11-06', time: '23:30', duration: 90,
  format: 'Reels', status: 'Запланировано', project: JSON.stringify(['Проект А', 'Проект Б']), location: JSON.stringify(['Пляж, южный вход', 'Офис; этаж 2']),
  participants: ['Юля', 'Андрей'], notes: 'Взять камеру', revision: 3,
};
const url = 'https://gost-home.example/events/' + shoot.id;
const unfold = value => value.replace(/\r\n[ \t]/g, '');
const time = eventTimes(shoot);
assert.equal(time.start.toISOString(), '2026-11-06T16:30:00.000Z');
assert.equal(time.end.toISOString(), '2026-11-06T18:00:00.000Z');
const calendar = eventCalendar(shoot, url, now);
const content = unfold(calendar);
assert(content.includes('DTSTART:20261106T163000Z\r\nDTEND:20261106T180000Z'));
assert(content.includes('TRIGGER:-P1D\r\n'));
assert(content.includes('Проекты: Проект А\\, Проект Б'));
assert(content.includes('LOCATION:Пляж\\, южный вход\\; Офис\\; этаж 2'));
assert(content.includes('UID:' + shoot.id + '@gost-home-calendar\r\n'));
assert(content.includes('SEQUENCE:3\r\n'));
assert(!content.includes('ATTENDEE') && !content.includes('ORGANIZER'));
assert(calendar.endsWith('\r\n'));
assert(!calendar.replace(/\r\n/g, '').includes('\n'));

const injection = eventCalendar({ ...shoot, title: 'Текст\\,;\r\nATTENDEE:mallory@example.com', notes: 'Строка 1\nEND:VEVENT\nBEGIN:VEVENT' }, url, now);
assert.equal((unfold(injection).match(/^BEGIN:VEVENT\r?$/gm) || []).length, 1);
assert(!unfold(injection).includes('\r\nATTENDEE:'));
assert(unfold(injection).includes('Текст\\\\\\,\\;\\nATTENDEE:'));
assert(unfold(injection).includes('Строка 1\\nEND:VEVENT\\nBEGIN:VEVENT'));

const longTitle = 'Длинное название съёмки 🏡 '.repeat(30);
const longCalendar = eventCalendar({ ...shoot, title: longTitle }, url, now);
for (const line of longCalendar.split('\r\n')) assert(Buffer.byteLength(line, 'utf8') <= 75);
assert(!longCalendar.includes('\uFFFD'));
assert(unfold(longCalendar).includes('SUMMARY:Gost Home · ' + longTitle));

const updated = unfold(eventCalendar({ ...shoot, title: 'Перенос', time: '10:00', revision: 4 }, 'https://new-domain.example/events/' + shoot.id, now));
assert.equal(updated.match(/^UID:(.*)\r?$/m)[1], content.match(/^UID:(.*)\r?$/m)[1]);
assert(updated.includes('SEQUENCE:4'));
const cancelled = unfold(eventCalendar({ ...shoot, status: 'Отменено' }, url, now));
assert(cancelled.includes('STATUS:CANCELLED'));
assert(!cancelled.includes('BEGIN:VALARM'));
const past = unfold(eventCalendar({ ...shoot, date: '2026-10-01' }, url, now));
assert(!past.includes('BEGIN:VALARM'));
const legacy = unfold(eventCalendar({ ...shoot, project: 'ЖК, корпус 2', location: 'Офис', notes: '' }, url, now));
assert(legacy.includes('Проекты: ЖК\\, корпус 2'));
assert(legacy.includes('LOCATION:Офис'));
assert.throws(() => eventTimes({ ...shoot, date: '2026-02-30' }));
assert.throws(() => eventTimes({ ...shoot, duration: 0 }));
assert.throws(() => eventCalendar(shoot, 'https://example.com\r\nATTENDEE:test', now));
assert.throws(() => eventCalendar(shoot, 'javascript:alert(1)', now));
console.log('PASS: event times, 24-hour alarm, multiple/legacy values, injection escaping, UTF-8 folding, stable UID, updates, cancellation, past events, invalid dates');
