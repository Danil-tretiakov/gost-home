/**
 * Whose turn it is on an item that is awaiting_feedback. There is no separate "changes_requested" stage any more:
 * a reviewer asking for changes just leaves a feedback_comments row (kind='changes_requested') without moving the
 * item off awaiting_feedback. The turn flips back to the reviewer the moment a newer edit version is added.
 */
export type ReviewTurn = 'author' | 'reviewer';

type VersionRow = { contentId: string; id: string; number: number };
type ReturnRow = { contentId: string; versionId: string | null; at: string };

/** Builds a contentId -> turn map from the full edit_versions table and the changes_requested feedback_comments rows. */
export function buildReviewTurns(versions: VersionRow[], returns: ReturnRow[]): Map<string, ReviewTurn> {
  const latest = new Map<string, VersionRow>();
  for (const v of versions) { const cur = latest.get(v.contentId); if (!cur || v.number > cur.number) latest.set(v.contentId, v); }
  const lastReturn = new Map<string, ReturnRow>();
  for (const r of returns) { const cur = lastReturn.get(r.contentId); if (!cur || r.at > cur.at) lastReturn.set(r.contentId, r); }
  const turns = new Map<string, ReviewTurn>();
  for (const [contentId, v] of latest) turns.set(contentId, lastReturn.get(contentId)?.versionId === v.id ? 'author' : 'reviewer');
  return turns;
}
