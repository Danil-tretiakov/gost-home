import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../../db';
import { taskFolders } from '../../../../db/schema';
import { currentEditor, forbidden, internalReader, sameOrigin } from '../../../../lib/actor';
import { isUuid } from '../../../../lib/content-values';
import { type D1 } from '../../../../lib/content-writes';
import { applyFolderCreate, applyFolderUpdate } from '../../../../lib/task-writes';
import { parseFolderName } from '../../../../lib/tasks';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const noStore = { 'Cache-Control': 'no-store' };

/** Planner folders: internal, like tasks. Archived folders are included (the board hides them). */
export async function GET() {
  if (!(await internalReader())) return forbidden();
  try { return Response.json(await getDb().select().from(taskFolders), { headers: noStore }); }
  catch { return bad('Не удалось загрузить папки', 503); }
}

async function load(id: string) { const [f] = await getDb().select().from(taskFolders).where(eq(taskFolders.id, id)).limit(1); return f ?? null; }

/** {action: create | rename | archive | restore, id, name?, revision?}. Archiving never deletes tasks: they show as «Без папки». */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await currentEditor();
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return bad('Неверный запрос'); }
  if (!isUuid(x.id)) return bad('Неверный запрос');
  const id = x.id, db = getD1() as unknown as D1;
  try {
    if (x.action === 'create') {
      const name = parseFolderName(x.name);
      if (!name) return bad('Название папки: от 1 до 60 символов');
      const r = await applyFolderCreate(db, { id, name, actor });
      return Response.json(await load(id), { status: r === 'created' ? 201 : 200 });
    }
    if (x.action === 'rename' || x.action === 'archive' || x.action === 'restore') {
      if (!Number.isInteger(x.revision)) return bad('Неверный запрос');
      if (!(await load(id))) return bad('Папка не найдена', 404);
      const name = x.action === 'rename' ? parseFolderName(x.name) : undefined;
      if (x.action === 'rename' && !name) return bad('Название папки: от 1 до 60 символов');
      const ok = await applyFolderUpdate(db, { id, revision: x.revision as number, name: name ?? undefined, archive: x.action === 'rename' ? undefined : x.action === 'archive', actor });
      if (!ok) return Response.json({ error: 'Папку уже изменили. Обновите и повторите.', current: await load(id) }, { status: 409 });
      return Response.json(await load(id));
    }
    return bad('Неизвестное действие');
  } catch { return bad('Не удалось сохранить папку. Ничего не изменено.', 503); }
}
