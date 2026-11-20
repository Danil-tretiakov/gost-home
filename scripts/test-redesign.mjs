// Redesign: smart quick add for tasks, «Снято» / «Выложено» per member this month, and the hand-kept reel pay counter.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

async function load(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' });
  const f = new URL(`../node_modules/.cache/redesign_${entry.replaceAll('/', '_')}.mjs`, import.meta.url);
  mkdirSync(new URL('.', f), { recursive: true }); writeFileSync(f, out.outputFiles[0].text);
  return import(f.href + '?' + Date.now());
}
const P = await load('lib/tasks-parse.ts');
const M = await load('lib/content-metrics.ts');
const R = await load('lib/reel-pay.ts');
const S = await load('lib/content-status.ts');

// 1. Quick add. 19.11.2026 is a Thursday.
const T = '2026-11-19';
const q = s => { const r = P.parseQuickTask(s, T); return [r.title, r.dueDate, r.dueTime, r.priority]; };
assert.deepEqual(q('Позвонить Лизе завтра в 15:00 !'), ['Позвонить Лизе', '2026-11-20', '15:00', 'high']);
assert.deepEqual(q('Смонтировать ролик в пятницу'), ['Смонтировать ролик', '2026-11-20', null, 'normal']);
assert.deepEqual(q('Созвон в четверг'), ['Созвон', T, null, 'normal'], 'same weekday is today');
assert.deepEqual(q('Созвон следующий четверг'), ['Созвон', '2026-11-26', null, 'normal']);
assert.deepEqual(q('Съёмка во вторник 9:30'), ['Съёмка', '2026-11-24', '09:30', 'normal']);
assert.deepEqual(q('Бронь локации 25.11'), ['Бронь локации', '2026-11-25', null, 'normal']);
assert.deepEqual(q('Отчёт 03.01'), ['Отчёт', '2027-01-03', null, 'normal'], 'past day of year goes to next year');
assert.deepEqual(q('Отчёт 3 декабря срочно'), ['Отчёт', '2026-12-03', null, 'high']);
assert.deepEqual(q('через 3 дня отправить сценарий'), ['Отправить сценарий', '2026-11-22', null, 'normal']);
assert.deepEqual(q('итог через неделю'), ['Итог', '2026-11-26', null, 'normal']);
assert.deepEqual(q('послезавтра монтаж'), ['Монтаж', '2026-11-21', null, 'normal']);
assert.deepEqual(q('15:00 созвон'), ['Созвон', T, '15:00', 'normal'], 'time alone means today');
assert.deepEqual(q('Сдать 30.02'), ['Сдать 30.02', null, null, 'normal'], 'impossible date stays in the title');
assert.deepEqual(q('Купить микрофон'), ['Купить микрофон', null, null, 'normal']);
assert.deepEqual(q('Задача 31.12.2026'), ['Задача', '2026-12-31', null, 'normal']);
assert.equal(P.parseQuickTask('Версия 2 завтра', T, new Set(['date'])).dueDate, null, 'tapping the chip keeps the words');
assert.equal(P.parseQuickTask('Версия 2 завтра', T, new Set(['date'])).title, 'Версия 2 завтра');
assert.equal(P.parseQuickTask('Год 2026: итоги 31.12', T).dueDate, '2026-12-31');

// 2. Labels: no names in stage labels.
assert.equal(S.CONTENT_STATUS_LABELS.awaiting_feedback, 'Нужно согласовать');
assert.ok(!Object.values(S.CONTENT_STATUS_LABELS).some(l => /Андре/.test(l)));

// 3. Shot / published per member this month. Shot date = linked shoot date, else publication (planned) date.
const plan = { reelsPerMonth: 30, youtubePerMonth: 2, yuliaIntervalDays: 3, members: { 'Юля': 10, 'Лиза': 10, 'Марк': 5, 'Андрей': 3, 'Лада': 2, 'Александр': 0 } };
const it = (o) => ({ id: Math.random().toString(36), type: 'reel', title: 't', primaryMember: 'Юля', participants: [], plannedPublishDate: null, publishedAt: null, productionStatus: 'planned', shootDate: null, ...o });
const items = [
  it({ productionStatus: 'shot', shootDate: '2026-11-04' }),
  it({ productionStatus: 'published', shootDate: '2026-10-30', publishedAt: '2026-11-02', plannedPublishDate: '2026-11-02' }), // shot in October
  it({ productionStatus: 'editing', plannedPublishDate: '2026-11-20' }), // no shoot: dated by plan
  it({ productionStatus: 'planned', shootDate: '2026-11-04' }), // not shot yet
  it({ productionStatus: 'cancelled', shootDate: '2026-11-04' }),
  it({ primaryMember: 'Лиза', participants: ['Юля'], productionStatus: 'approved', shootDate: '2026-11-10' }),
  it({ primaryMember: 'Лиза', productionStatus: 'published', publishedAt: '2026-11-15', shootDate: '2026-11-10' }),
  it({ type: 'youtube', productionStatus: 'shot', shootDate: '2026-11-04' }),
];
const sum = M.monthSummary(items, '2026-11', T, plan);
const row = n => sum.members.find(m => m.member === n);
assert.equal(row('Юля').shot, 2, 'Юля: shot in November, joint video not doubled, YouTube apart');
assert.equal(row('Лиза').shot, 2);
assert.equal(sum.reels.shot, 4);
assert.equal(row('Юля').shotShare, 0.5);
assert.equal(row('Юля').published, 1); assert.equal(row('Лиза').published, 1);
assert.equal(row('Марк').shotShare, 0);
assert.equal(M.monthSummary(items, '2026-10', T, plan).members.find(m => m.member === 'Юля').shot, 1, 'October shoot counted in October');

// 4. Reel pay counter: shot all time for the primary presenter, manual correction, paid by hand, never negative.
const pay = [
  it({ productionStatus: 'shot' }), it({ productionStatus: 'published' }), it({ productionStatus: 'paused' }), it({ productionStatus: 'cancelled' }),
  it({ productionStatus: 'planned' }), it({ primaryMember: 'Лиза', productionStatus: 'approved', participants: ['Юля'] }), it({ type: 'youtube', productionStatus: 'published' }),
];
let rows = R.reelPayRows(pay, R.emptyReelPay());
assert.deepEqual(rows.slice(0, 2).map(r => [r.member, r.shot, r.paid, r.remaining]), [['Юля', 2, 0, 2], ['Лиза', 1, 0, 1]], 'plan order, only shot Reels');
assert.equal(R.reelPayTotal(rows), 3);
rows = R.reelPayRows(pay, { paid: { 'Юля': 5 }, shotOverride: { 'Лиза': 4 } });
assert.deepEqual(rows.slice(0, 2).map(r => [r.shot, r.overridden, r.paid, r.remaining, r.shotAuto]), [[2, false, 5, 0, 2], [4, true, 0, 4, 1]]);
assert.equal(R.parseReelPay({ paid: { 'Юля': 2 } }).paid['Юля'], 2);
for (const bad of [null, [], { paid: { 'Кто-то': 1 } }, { paid: { 'Юля': -1 } }, { paid: { 'Юля': 1.5 } }, { paid: [] }, { shotOverride: { 'Лиза': '3' } }]) assert.equal(R.parseReelPay(bad), null, JSON.stringify(bad));

console.log('PASS: quick add (dates, times, priority, skip), stage labels, shot/published per member and month, reel pay counter');
