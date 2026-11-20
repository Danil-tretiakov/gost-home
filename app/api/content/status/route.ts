import { and, desc, eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../../db';
import { contentItems, contentParticipants, editVersions, statusEvents } from '../../../../db/schema';
import { applyStatusChange } from '../../../../lib/content-writes';
import { actorWith, forbidden, sameOrigin } from '../../../../lib/actor';
import { canReviewTransition } from '../../../../lib/rbac';
import { canTransition, CONTENT_STATUS_LABELS, isContentStatus } from '../../../../lib/content-status';
import { isIsoDate, isUuid } from '../../../../lib/content-values';
import { toClient } from '../../../../lib/content-client';

export const dynamic = 'force-dynamic';

/** Moves one item to another production stage. Publication needs the actual date; it is never inferred. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  // Editors move items between any allowed stages; reviewers only decide on items waiting for feedback.
  const editor = await actorWith('edit');
  const actor = editor ?? await actorWith('review');
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return Response.json({ error: 'Неверный запрос' }, { status: 400 }); }
  if (!isUuid(x.id) || !Number.isInteger(x.revision) || !isContentStatus(x.to)) return Response.json({ error: 'Неверный запрос' }, { status: 400 });
  const comment = typeof x.comment === 'string' ? x.comment.trim().slice(0, 5000) : '';
  if (x.to === 'published' && !isIsoDate(x.publishedAt)) return Response.json({ error: 'Укажите фактическую дату публикации' }, { status: 400 });
  if (x.to === 'changes_requested' && !comment) return Response.json({ error: 'Опишите, что нужно поправить' }, { status: 400 });
  try {
    const db = getDb();
    const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, x.id)).limit(1);
    if (!existing) return Response.json({ error: 'Ролик не найден' }, { status: 404 });
    if (!editor && !canReviewTransition(existing.productionStatus, x.to)) return forbidden(req);
    if (!isContentStatus(existing.productionStatus) || !canTransition(existing.productionStatus, x.to)) {
      return Response.json({ error: `Нельзя перейти из «${CONTENT_STATUS_LABELS[existing.productionStatus as keyof typeof CONTENT_STATUS_LABELS] ?? existing.productionStatus}» в «${CONTENT_STATUS_LABELS[x.to]}»` }, { status: 400 });
    }
    const [latest] = await db.select({ id: editVersions.id }).from(editVersions).where(eq(editVersions.contentId, x.id)).orderBy(desc(editVersions.number)).limit(1);
    if (x.to === 'awaiting_feedback' && latest) {
      // A new approval round needs a new version: the one that was returned cannot be sent again.
      const [returned] = await db.select({ versionId: statusEvents.versionId }).from(statusEvents)
        .where(and(eq(statusEvents.contentId, x.id), eq(statusEvents.toStatus, 'changes_requested'))).orderBy(desc(statusEvents.at)).limit(1);
      if (returned?.versionId === latest.id) return Response.json({ error: 'Эта версия уже возвращена на доработку. Добавьте новую версию монтажа.' }, { status: 400 });
    }
    const publishedAt = x.to === 'published' ? (x.publishedAt as string) : null;
    const versionId = ['awaiting_feedback', 'approved', 'changes_requested'].includes(x.to) ? latest?.id ?? null : null;
    const applied = await applyStatusChange(getD1(), { id: x.id, revision: x.revision as number, from: existing.productionStatus, to: x.to, publishedAt, comment, actor, previousPublishedAt: existing.publishedAt, versionId });
    if (!applied) return Response.json({ error: 'Ролик уже изменён другим пользователем. Обновите и повторите.' }, { status: 409 });
    const [updated] = await db.select().from(contentItems).where(eq(contentItems.id, x.id)).limit(1);
    const parts = await db.select().from(contentParticipants).where(eq(contentParticipants.contentId, x.id));
    return Response.json(toClient(updated, parts.map(p => p.member)));
  } catch {
    return Response.json({ error: 'Не удалось сменить статус. Повторите попытку.' }, { status: 503 });
  }
}
