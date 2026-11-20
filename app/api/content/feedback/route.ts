import { and, eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../../db';
import { contentItems, editVersions } from '../../../../db/schema';
import { actorWith, forbidden, sameOrigin } from '../../../../lib/actor';
import { isUuid } from '../../../../lib/content-values';
import { applyComment } from '../../../../lib/content-writes';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return Response.json({ error: 'Неверный запрос' }, { status: 400 }); }
  const kind = x.kind === 'changes_requested' ? 'changes_requested' as const : 'comment' as const;
  // A plain comment: editors and reviewers. Requesting changes: reviewers only (it flips review-turn to the author).
  const actor = kind === 'changes_requested' ? await actorWith('review') : (await actorWith('edit')) ?? (await actorWith('review'));
  if (!actor) return forbidden(req);
  const body = typeof x.body === 'string' ? x.body.trim() : '';
  if (!isUuid(x.contentId) || !body || body.length > 5000 || (x.versionId !== null && x.versionId !== undefined && !isUuid(x.versionId))) return Response.json({ error: 'Напишите комментарий' }, { status: 400 });
  try {
    const db = getDb();
    const [item] = await db.select({ id: contentItems.id, productionStatus: contentItems.productionStatus }).from(contentItems).where(eq(contentItems.id, x.contentId)).limit(1);
    if (!item) return Response.json({ error: 'Ролик не найден' }, { status: 404 });
    if (kind === 'changes_requested' && item.productionStatus !== 'awaiting_feedback') return Response.json({ error: 'Ролик сейчас не на согласовании' }, { status: 400 });
    const versionId = (x.versionId as string | undefined) ?? null;
    if (versionId) {
      const [v] = await db.select({ id: editVersions.id }).from(editVersions).where(and(eq(editVersions.id, versionId), eq(editVersions.contentId, x.contentId))).limit(1);
      if (!v) return Response.json({ error: 'Версия не найдена' }, { status: 400 });
    }
    const id = await applyComment(getD1(), { contentId: x.contentId, versionId, body, actor, kind });
    return Response.json({ id }, { status: 201 });
  } catch { return Response.json({ error: 'Не удалось сохранить комментарий' }, { status: 503 }); }
}
