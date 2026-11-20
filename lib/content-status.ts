/** Production stages of one Reels/YouTube item (spec §9). Publication is a stage, not a separate copy. */
export const CONTENT_STATUSES = [
  'planned', 'shot', 'editing', 'awaiting_feedback', 'changes_requested', 'approved', 'published', 'paused', 'cancelled',
] as const;
export type ContentStatus = typeof CONTENT_STATUSES[number];

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  planned: 'Сценарий',
  shot: 'Съёмка',
  editing: 'Монтаж',
  awaiting_feedback: 'Ждёт согласования',
  changes_requested: 'Правки',
  approved: 'Согласовано',
  published: 'Выложено',
  paused: 'На паузе',
  cancelled: 'Отменено',
};

/** Main pipeline order, used for grouping and progress. */
export const PIPELINE: ContentStatus[] = ['planned', 'shot', 'editing', 'awaiting_feedback', 'changes_requested', 'approved', 'published'];

/**
 * The real stages of production, in order. Paused/cancelled are legacy and never offered as a destination.
 * changes_requested is excluded too: it's no longer a stage you move into. A reviewer asking for changes leaves a
 * comment (kind='changes_requested' in feedback_comments, see lib/review-turn.ts) and the item stays
 * awaiting_feedback — the value remains a valid ContentStatus only so old rows still display correctly.
 */
const ACTIVE_STATUSES: ContentStatus[] = ['planned', 'shot', 'editing', 'awaiting_feedback', 'approved', 'published'];

/** Every active stage is a direct option from any other: Данил sets the actual current stage rather than stepping through each one in order. The server still requires a comment for a legacy changes_requested row and a date for published (see /api/content/status), so a jump that skips required info is rejected there, not hidden here. */
export function allowedTransitions(from: ContentStatus): ContentStatus[] {
  return ACTIVE_STATUSES.filter(s => s !== from);
}

export function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === 'string' && (CONTENT_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return from === to || allowedTransitions(from).includes(to);
}

export const CONTENT_TYPES = ['reel', 'youtube'] as const;
export type ContentType = typeof CONTENT_TYPES[number];
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = { reel: 'Reels', youtube: 'YouTube' };

/** Stages that mean the video has been filmed (whatever happened after). Paused and cancelled are not counted. */
export const SHOT_STATUSES: ContentStatus[] = ['shot', 'editing', 'awaiting_feedback', 'changes_requested', 'approved', 'published'];
export const isShotStatus = (s: ContentStatus) => SHOT_STATUSES.includes(s);
