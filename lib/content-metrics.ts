import type { ContentStatus, ContentType } from './content-status';
import { isShotStatus, PIPELINE } from './content-status';
import type { PlanSettings } from './plan-settings';

export type MetricItem = {
  id: string;
  type: ContentType;
  title: string;
  primaryMember: string;
  participants: string[];
  plannedPublishDate: string | null;
  publishedAt: string | null;
  productionStatus: ContentStatus;
  /** Set only while awaiting_feedback: 'author' once the reviewer asked for changes on the newest version. */
  reviewTurn?: 'author' | 'reviewer' | null;
  /** Date of the linked shoot, when the item is linked to one (resolved by the caller). */
  shootDate?: string | null;
};

/** When the video was filmed: the linked shoot's date, otherwise its publication (or planned) date. */
export const shotDateOf = (i: MetricItem) => i.shootDate ?? (i.productionStatus === 'published' ? i.publishedAt ?? i.plannedPublishDate : i.plannedPublishDate);
/** Filmed in that month: a stage at «Снято» or later, dated by shotDateOf. */
export const shotInMonth = (i: MetricItem, month: string) => isShotStatus(i.productionStatus) && inMonth(shotDateOf(i), month);

const inMonth = (date: string | null, month: string) => !!date && date.slice(0, 7) === month;
const ACTIVE: ContentStatus[] = ['planned', 'shot', 'editing', 'awaiting_feedback', 'changes_requested', 'approved'];

export type MemberRow = {
  member: string;
  target: number;
  targetShare: number | null;
  scheduled: number;
  shot: number;
  shotShare: number | null;
  published: number;
  publishedShare: number | null;
  remaining: number;
  deviation: number;
  appearances: number;
};

export type Coverage = { coveredSlots: number; nextUncovered: MetricItem[]; upcomingSlots: number };

/** Monthly figures for one month (YYYY-MM). Planned and published are never mixed; YouTube is counted separately. */
export function monthSummary(items: MetricItem[], month: string, today: string, plan: PlanSettings) {
  const reels = items.filter(i => i.type === 'reel');
  const youtube = items.filter(i => i.type === 'youtube');
  const publishedReels = reels.filter(i => i.productionStatus === 'published' && inMonth(i.publishedAt, month));
  const publishedYoutube = youtube.filter(i => i.productionStatus === 'published' && inMonth(i.publishedAt, month));

  const statusCounts = Object.fromEntries(PIPELINE.map(s => [s, 0])) as Record<ContentStatus, number>;
  for (const i of reels) {
    if (i.productionStatus === 'published') { if (inMonth(i.publishedAt, month)) statusCounts.published++; }
    else if (statusCounts[i.productionStatus] !== undefined) statusCounts[i.productionStatus]++;
  }

  const readyStock = reels.filter(i => i.productionStatus === 'approved');
  const inProduction = items.filter(i => ACTIVE.includes(i.productionStatus) && i.productionStatus !== 'approved');

  const members = memberRows(reels, month, plan, publishedReels.length, reels.filter(i => shotInMonth(i, month)).length);
  return {
    month,
    reels: { published: publishedReels.length, shot: reels.filter(i => shotInMonth(i, month)).length, target: plan.reelsPerMonth, scheduled: reels.filter(i => i.productionStatus !== 'cancelled' && inMonth(i.plannedPublishDate, month)).length },
    youtube: { published: publishedYoutube.length, target: plan.youtubePerMonth, scheduled: youtube.filter(i => i.productionStatus !== 'cancelled' && inMonth(i.plannedPublishDate, month)).length },
    statusCounts,
    inProduction: inProduction.length,
    awaitingFeedback: items.filter(i => i.productionStatus === 'awaiting_feedback' && i.reviewTurn !== 'author').length,
    changesRequested: items.filter(i => i.productionStatus === 'awaiting_feedback' && i.reviewTurn === 'author').length,
    readyStock: readyStock.length,
    coverage: coverage(reels, today),
    members,
  };
}

function memberRows(reels: MetricItem[], month: string, plan: PlanSettings, publishedTotal: number, shotTotal: number): MemberRow[] {
  const names = Object.keys(plan.members);
  for (const r of reels) if (!names.includes(r.primaryMember)) names.push(r.primaryMember);
  const targetTotal = plan.reelsPerMonth;
  return names.map(member => {
    const target = plan.members[member] ?? 0;
    const mine = reels.filter(r => r.primaryMember === member);
    const scheduled = mine.filter(r => r.productionStatus !== 'cancelled' && inMonth(r.plannedPublishDate, month)).length;
    const published = mine.filter(r => r.productionStatus === 'published' && inMonth(r.publishedAt, month)).length;
    const shot = mine.filter(r => shotInMonth(r, month)).length;
    const appearances = reels.filter(r => r.primaryMember !== member && r.participants.includes(member) && r.productionStatus !== 'cancelled'
      && (inMonth(r.plannedPublishDate, month) || inMonth(r.publishedAt, month))).length;
    return {
      member, target,
      targetShare: targetTotal > 0 ? target / targetTotal : null,
      scheduled, shot, shotShare: shotTotal > 0 ? shot / shotTotal : null, published,
      publishedShare: publishedTotal > 0 ? published / publishedTotal : null,
      remaining: Math.max(0, target - published),
      deviation: published - target,
      appearances,
    };
  });
}

/**
 * Coverage of upcoming publication slots by concrete approved videos: walk future unpublished slots in date order;
 * a slot counts as covered only if its own item is approved. Stops at the first slot that is not.
 */
export function coverage(reels: MetricItem[], today: string): Coverage {
  const slots = reels
    .filter(i => i.plannedPublishDate && i.plannedPublishDate >= today && i.productionStatus !== 'published' && i.productionStatus !== 'cancelled')
    .sort((a, b) => (a.plannedPublishDate! + a.id).localeCompare(b.plannedPublishDate! + b.id));
  let coveredSlots = 0;
  while (coveredSlots < slots.length && slots[coveredSlots].productionStatus === 'approved') coveredSlots++;
  const nextUncovered = slots.slice(coveredSlots).filter(i => i.productionStatus !== 'approved').slice(0, 5);
  return { coveredSlots, nextUncovered, upcomingSlots: slots.length };
}
