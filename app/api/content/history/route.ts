import { asc, eq } from 'drizzle-orm';
import { getDb } from '../../../../db';
import { statusEvents } from '../../../../db/schema';
import { internalReader, forbidden } from '../../../../lib/actor';
import { isUuid } from '../../../../lib/content-values';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await internalReader())) return forbidden(req);
  const id = new URL(req.url).searchParams.get('id');
  if (!isUuid(id)) return Response.json({ error: 'Неверный запрос' }, { status: 400 });
  try {
    const rows = await getDb().select().from(statusEvents).where(eq(statusEvents.contentId, id)).orderBy(asc(statusEvents.at));
    return Response.json(rows, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Не удалось загрузить историю' }, { status: 503 });
  }
}
