import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../db';
import { contentItems, contentParticipants, editVersions, feedbackComments, shoots } from '../../../db/schema';
import { applyContentCreate, applyContentUpdate } from '../../../lib/content-writes';
import { currentEditor, forbidden, internalReader, sameOrigin } from '../../../lib/actor';
import { parseContentInput } from '../../../lib/content-values';
import { storeShootValues } from '../../../lib/shoot-values';
import { toClient } from '../../../lib/content-client';
import { buildReviewTurns } from '../../../lib/review-turn';

export const dynamic = 'force-dynamic';


async function readItem(id: string) {
  const db = getDb();
  const [row] = await db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
  const parts = await db.select().from(contentParticipants).where(eq(contentParticipants.contentId, id));
  return toClient(row, parts.map(p => p.member));
}

export async function GET() {
  try {
    const editor = await internalReader();
    const db = getDb();
    const [rows, parts, versions, returns] = await Promise.all([
      db.select().from(contentItems), db.select().from(contentParticipants),
      db.select({ contentId: editVersions.contentId, id: editVersions.id, number: editVersions.number }).from(editVersions),
      db.select({ contentId: feedbackComments.contentId, versionId: feedbackComments.versionId, at: feedbackComments.at }).from(feedbackComments).where(eq(feedbackComments.kind, 'changes_requested')),
    ]);
    const byItem = new Map<string, string[]>();
    for (const p of parts) byItem.set(p.contentId, [...(byItem.get(p.contentId) ?? []), p.member]);
    const turns = buildReviewTurns(versions, returns);
    // Visitors without a team role see the plan only: no edit links, scripts, internal places, responsible person or author names.
    return Response.json(rows.map(r => ({ ...toClient(r, byItem.get(r.id) ?? [], turns.get(r.id) ?? null), ...(editor ? {} : { driveUrl: '', responsible: null, createdBy: '', updatedBy: '', description: '', places: [] }) })), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Не удалось загрузить ролики' }, { status: 503 });
  }
}

/** Create (idempotent by client-generated id) or update (optimistic revision check). Status changes go through /api/content/status. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await currentEditor();
  if (!actor) return forbidden(req);
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'Неверный запрос' }, { status: 400 }); }
  const parsed = parseContentInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const x = parsed.value;
  try {
    const db = getDb();
    if (x.shootId) {
      const [shoot] = await db.select({ id: shoots.id }).from(shoots).where(eq(shoots.id, x.shootId)).limit(1);
      if (!shoot) return Response.json({ error: 'Съёмка не найдена. Обновите страницу.' }, { status: 400 });
    }
    const fields = {
      type: x.type, title: x.title, description: x.description, primaryMember: x.primaryMember, shootId: x.shootId,
      places: storeShootValues(x.places), plannedPublishDate: x.plannedPublishDate, driveUrl: x.driveUrl,
    };
    const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, x.id)).limit(1);
    const withResponsible = { ...fields, responsible: x.responsible === undefined ? existing?.responsible ?? null : x.responsible };

    if (x.revision === undefined) {
      // Create. A repeated submit with the same id returns the already-created record instead of a duplicate.
      if (existing) return Response.json(await readItem(x.id), { status: 200 });
      const status = x.productionStatus ?? 'planned';
      if (status === 'published') return Response.json({ error: 'Публикацию отмечайте отдельно, с фактической датой' }, { status: 400 });
      try {
        await applyContentCreate(getD1(), { id: x.id, ...withResponsible, productionStatus: status, actor }, x.participants);
      } catch (err) {
        // A concurrent identical submit may have created it a moment earlier: return that record instead of an error.
        const [raced] = await db.select().from(contentItems).where(eq(contentItems.id, x.id)).limit(1);
        if (!raced) throw err;
      }
      return Response.json(await readItem(x.id), { status: 201 });
    }

    if (!existing) return Response.json({ error: 'Ролик не найден. Обновите страницу.' }, { status: 404 });
    const before = await db.select().from(contentParticipants).where(eq(contentParticipants.contentId, x.id));
    const applied = await applyContentUpdate(getD1(), { id: x.id, revision: x.revision, fields: withResponsible, participants: x.participants, actor,
      before: { ...existing, participants: before.map(p => p.member) } });
    if (!applied) return Response.json({ error: 'Ролик уже изменён другим пользователем. Обновите и откройте его снова.' }, { status: 409 });
    return Response.json(await readItem(x.id));
  } catch {
    return Response.json({ error: 'Не удалось сохранить ролик. Повторите попытку.' }, { status: 503 });
  }
}
