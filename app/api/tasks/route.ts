import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../db';
import { contentItems, shoots, taskFolders, tasks } from '../../../db/schema';
import { forbidden, ownerOnly, sameOrigin } from '../../../lib/actor';
import { isUuid } from '../../../lib/content-values';
import { type D1 } from '../../../lib/content-writes';
import { applyTaskArchive, applyTaskCreate, applyTaskUpdate } from '../../../lib/task-writes';
import { parseTaskInput } from '../../../lib/tasks';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const noStore = { 'Cache-Control': 'no-store' };

/** Tasks are internal: only the signed-in editor can read them. Archived tasks are included (the board filters them). */
export async function GET() {
  if (!(await ownerOnly())) return forbidden();
  try { return Response.json(await getDb().select().from(tasks), { headers: noStore }); }
  catch { return bad('Не удалось загрузить задачи', 503); }
}

async function load(id: string) { const [t] = await getDb().select().from(tasks).where(eq(tasks.id, id)).limit(1); return t ?? null; }

/** Links must point to existing records; a deleted shoot or item is refused instead of silently dropped. */
async function linksExist(shootId: string | null, contentId: string | null, folderId: string | null) {
  const db = getDb();
  if (folderId && !(await db.select({ id: taskFolders.id }).from(taskFolders).where(eq(taskFolders.id, folderId)).limit(1)).length) return 'Папка не найдена';
  if (shootId && !(await db.select({ id: shoots.id }).from(shoots).where(eq(shoots.id, shootId)).limit(1)).length) return 'Съёмка не найдена';
  if (contentId && !(await db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, contentId)).limit(1)).length) return 'Ролик не найден';
  return null;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await ownerOnly();
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return bad('Неверный запрос'); }
  if (!isUuid(x.id)) return bad('Неверный запрос');
  const id = x.id;
  const db = getD1() as unknown as D1;
  try {
    if (x.action === 'create' || x.action === 'update') {
      const p = parseTaskInput(x);
      if (!p.ok) return bad(p.error);
      const linkError = await linksExist(p.fields.shootId, p.fields.contentId, p.fields.folderId);
      if (linkError) return bad(linkError);
      if (x.action === 'create') {
        const result = await applyTaskCreate(db, { id, ...p.fields, actor });
        return Response.json(await load(id), { status: result === 'created' ? 201 : 200 });
      }
      if (!Number.isInteger(x.revision)) return bad('Неверный запрос');
      const before = await load(id);
      if (!before) return bad('Задача не найдена', 404);
      if (before.archivedAt) return bad('Задача в архиве. Сначала восстановите её.', 409);
      const ok = await applyTaskUpdate(db, { id, revision: x.revision as number, fields: p.fields, actor, before });
      if (!ok) return Response.json({ error: 'Задачу уже изменили. Обновите и повторите.', current: await load(id) }, { status: 409 });
      return Response.json(await load(id));
    }
    if (x.action === 'archive' || x.action === 'restore') {
      if (!Number.isInteger(x.revision)) return bad('Неверный запрос');
      if (!(await load(id))) return bad('Задача не найдена', 404);
      const ok = await applyTaskArchive(db, { id, revision: x.revision as number, archive: x.action === 'archive', actor });
      if (!ok) return Response.json({ error: 'Задачу уже изменили. Обновите и повторите.', current: await load(id) }, { status: 409 });
      return Response.json(await load(id));
    }
    return bad('Неизвестное действие');
  } catch { return bad('Не удалось сохранить задачу. Ничего не изменено.', 503); }
}
