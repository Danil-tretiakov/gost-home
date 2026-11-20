import { asc, eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../../db';
import { contentItems, editVersions, feedbackComments } from '../../../../db/schema';
import { currentEditor, forbidden, internalReader, sameOrigin } from '../../../../lib/actor';
import { isUuid } from '../../../../lib/content-values';
import { applyAddVersion } from '../../../../lib/content-writes';

export const dynamic = 'force-dynamic';

/** Versions and the feedback thread of one item. Editors only: links to unpublished edits are internal. */
export async function GET(req: Request) {
  if (!(await internalReader())) return forbidden(req);
  const id = new URL(req.url).searchParams.get('id');
  if (!isUuid(id)) return Response.json({ error: 'Неверный запрос' }, { status: 400 });
  try {
    const db = getDb();
    const [versions, comments] = await Promise.all([
      db.select().from(editVersions).where(eq(editVersions.contentId, id)).orderBy(asc(editVersions.number)),
      db.select().from(feedbackComments).where(eq(feedbackComments.contentId, id)).orderBy(asc(feedbackComments.at)),
    ]);
    return Response.json({ versions, comments }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Не удалось загрузить версии' }, { status: 503 }); }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await currentEditor();
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return Response.json({ error: 'Неверный запрос' }, { status: 400 }); }
  const url = typeof x.driveUrl === 'string' ? x.driveUrl.trim() : '';
  let okUrl = false; try { okUrl = new URL(url).protocol === 'https:' && url.length <= 1000; } catch { okUrl = false; }
  if (!isUuid(x.contentId) || !Number.isInteger(x.revision) || !okUrl) return Response.json({ error: 'Нужна ссылка https:// на монтаж' }, { status: 400 });
  const note = typeof x.note === 'string' ? x.note.trim().slice(0, 2000) : '';
  try {
    const versionId = await applyAddVersion(getD1(), { contentId: x.contentId, revision: x.revision as number, driveUrl: url, note, actor });
    if (!versionId) return Response.json({ error: 'Ролик уже изменён. Обновите и повторите.' }, { status: 409 });
    const [item] = await getDb().select().from(contentItems).where(eq(contentItems.id, x.contentId)).limit(1);
    return Response.json({ versionId, revision: item.revision, driveUrl: item.driveUrl, updatedAt: item.updatedAt, updatedBy: item.updatedBy }, { status: 201 });
  } catch { return Response.json({ error: 'Не удалось добавить версию' }, { status: 503 }); }
}
