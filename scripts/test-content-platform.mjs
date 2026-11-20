import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}
const { allowedTransitions, canTransition } = await load('lib/content-status.ts');
const { monthSummary, coverage } = await load('lib/content-metrics.ts');
const { DEFAULT_PLAN, parsePlanSettings, mergePlan } = await load('lib/plan-settings.ts');
const { parseContentInput, isIsoDate } = await load('lib/content-values.ts');

// Status machine: approval loop and no impossible jumps.
assert.ok(canTransition('editing', 'awaiting_feedback'));
assert.ok(canTransition('awaiting_feedback', 'changes_requested'));
assert.ok(canTransition('changes_requested', 'editing'));
assert.ok(canTransition('awaiting_feedback', 'approved'));
assert.ok(canTransition('approved', 'published'));
assert.ok(!canTransition('planned', 'published'), 'planned cannot jump to published');
assert.ok(!canTransition('planned', 'approved'));
assert.ok(!canTransition('editing', 'approved'), 'approval needs a version sent for feedback');
assert.deepEqual(allowedTransitions('cancelled'), ['planned']);
assert.ok(!allowedTransitions('published').includes('cancelled'));

// Metrics.
let n = 0;
const item = (o) => ({ id: 'i' + (++n), type: 'reel', title: 't' + n, primaryMember: 'Юля', participants: [], plannedPublishDate: null, publishedAt: null, productionStatus: 'planned', ...o });
const items = [
  // Joint Юля + Андрей video counts for Юля only.
  item({ primaryMember: 'Юля', participants: ['Андрей'], productionStatus: 'published', publishedAt: '2026-11-03', plannedPublishDate: '2026-11-03' }),
  item({ primaryMember: 'Андрей', productionStatus: 'published', publishedAt: '2026-11-05', plannedPublishDate: '2026-11-05' }),
  item({ primaryMember: 'Лиза', productionStatus: 'approved', plannedPublishDate: '2026-11-20' }),
  item({ primaryMember: 'Лиза', productionStatus: 'approved', plannedPublishDate: '2026-11-21' }),
  item({ primaryMember: 'Марк', productionStatus: 'editing', plannedPublishDate: '2026-11-22' }),
  item({ primaryMember: 'Лада', productionStatus: 'approved', plannedPublishDate: '2026-11-25' }),
  item({ primaryMember: 'Юля', productionStatus: 'awaiting_feedback', plannedPublishDate: '2026-11-24' }),
  item({ primaryMember: 'Марк', productionStatus: 'changes_requested' }),
  item({ primaryMember: 'Марк', productionStatus: 'cancelled', plannedPublishDate: '2026-11-26' }),
  // Published last month does not count in November.
  item({ primaryMember: 'Лиза', productionStatus: 'published', publishedAt: '2026-10-30', plannedPublishDate: '2026-10-30' }),
  // YouTube is separate from the 30 Reels.
  item({ type: 'youtube', primaryMember: 'Андрей', productionStatus: 'published', publishedAt: '2026-11-10', plannedPublishDate: '2026-11-10' }),
  item({ type: 'youtube', primaryMember: 'Андрей', productionStatus: 'editing', plannedPublishDate: '2026-11-28' }),
];
const s = monthSummary(items, '2026-11', '2026-11-19', DEFAULT_PLAN);
assert.equal(s.reels.published, 2, 'two Reels published in November, not three');
assert.equal(s.reels.target, 30);
assert.equal(s.youtube.published, 1);
assert.equal(s.youtube.target, 2);
assert.equal(s.youtube.scheduled, 2);
assert.equal(s.reels.scheduled, 7, 'cancelled and October items are not scheduled for November');
const row = Object.fromEntries(s.members.map(m => [m.member, m]));
assert.equal(row['Юля'].published, 1);
assert.equal(row['Андрей'].published, 1, 'Андрей gets only his own Reel, YouTube excluded');
assert.equal(row['Андрей'].appearances, 1, 'joint video is an appearance, not a share');
assert.equal(row['Юля'].publishedShare, 0.5);
assert.equal(s.members.reduce((a, m) => a + m.published, 0), s.reels.published, 'shares sum to 100%');
assert.equal(Math.round(row['Юля'].targetShare * 1000), 333);
assert.equal(row['Александр'].target, 0);
assert.equal(row['Лиза'].remaining, 10);
assert.equal(s.readyStock, 3, 'approved and not yet published Reels');
assert.equal(s.awaitingFeedback, 1);
assert.equal(s.changesRequested, 1);
assert.equal(s.statusCounts.published, 2);
// Coverage walks concrete future slots: 20 ✓, 21 ✓, 22 editing ✗ → 2 covered, even though 25 is approved.
assert.equal(s.coverage.coveredSlots, 2);
assert.equal(s.coverage.upcomingSlots, 5);
assert.deepEqual(s.coverage.nextUncovered.map(i => i.plannedPublishDate), ['2026-11-22', '2026-11-24']);
assert.equal(coverage([], '2026-11-19').coveredSlots, 0);
// Plan: the brief's 30 split; settings are validated, unknown names rejected.
assert.equal(Object.values(DEFAULT_PLAN.members).reduce((a, b) => a + b, 0), 30);
assert.equal(parsePlanSettings({ ...DEFAULT_PLAN, members: { ...DEFAULT_PLAN.members, 'Чужой': 2 } }), null);
assert.equal(parsePlanSettings({ ...DEFAULT_PLAN, reelsPerMonth: -1 }), null);
assert.equal(mergePlan(null), DEFAULT_PLAN);
assert.equal(parsePlanSettings({ ...DEFAULT_PLAN, members: { 'Юля': 12 } }).members['Лиза'], 0);
// Input validation.
const base = { id: '2b1f8f7e-8a1b-4c7e-9d2e-1f0a3b4c5d6e', type: 'reel', title: ' Обзор виллы с Юлей ', description: '', primaryMember: 'Юля', participants: ['Андрей', 'Юля', 'Андрей'], shootId: null, places: [' Вилла ', ''], plannedPublishDate: '2026-11-20', driveUrl: '' };
const ok = parseContentInput(base);
assert.ok(ok.ok);
assert.equal(ok.value.title, 'Обзор виллы с Юлей');
assert.deepEqual(ok.value.participants, ['Андрей'], 'primary removed from extras, duplicates removed');
assert.deepEqual(ok.value.places, ['Вилла']);
assert.equal(parseContentInput({ ...base, driveUrl: 'javascript:alert(1)' }).ok, false);
assert.equal(parseContentInput({ ...base, plannedPublishDate: '2026-02-30' }).ok, false);
assert.equal(parseContentInput({ ...base, primaryMember: 'Кто-то' }).ok, false);
assert.equal(parseContentInput({ ...base, type: 'tiktok' }).ok, false);
assert.equal(parseContentInput({ ...base, id: 'not-a-uuid' }).ok, false);
assert.ok(isIsoDate('2028-02-29') && !isIsoDate('2027-02-29'));
console.log('PASS: status transitions, plan vs fact, joint videos without double count, YouTube separate, ready stock and slot coverage, settings and input validation');
