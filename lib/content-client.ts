import type { contentItems } from '../db/schema';
import { normalizeShootValues } from './shoot-values';
import type { ReviewTurn } from './review-turn';

type Row = typeof contentItems.$inferSelect;
/** Shape returned to the browser: places as a list, participants attached, review turn while awaiting feedback. */
export function toClient(row: Row, participants: string[], reviewTurn: ReviewTurn | null = null) {
  return { ...row, places: normalizeShootValues(row.places), participants, reviewTurn: row.productionStatus === 'awaiting_feedback' ? reviewTurn : null };
}
