import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../../db';
import { aiAssets } from '../../../../db/schema';
import { currentEditor, forbidden, internalReader, sameOrigin } from '../../../../lib/actor';
import { isUuid } from '../../../../lib/content-values';
import { q, type D1 } from '../../../../lib/content-writes';
import { contentDisposition, MAX_FILE, parseRange } from '../../../../lib/files-core';
import { bucket, storeBytes } from '../../../../lib/files';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const NOT_CONNECTED = 'Хранилище не подключено: файлы можно добавлять ссылками https://';

/** Streams a stored file to a team member. Same-origin cookies carry the Sites identity; nothing is public. */
export async function GET(req: Request) {
  if (!(await internalReader())) return forbidden(req);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!isUuid(id) && !/^[0-9a-f-]{36}:\d{1,2}$/i.test(id ?? '')) return bad('Неверный запрос');
  const b = bucket();
  if (!b) return bad(NOT_CONNECTED, 503);
  try {
    const [a] = await getDb().select().from(aiAssets).where(eq(aiAssets.id, id!)).limit(1);
    if (!a?.storageKey || !a.mime) return bad('Файл не найден', 404);
    const size = a.size ?? (await b.head(a.storageKey))?.size ?? 0;
    const range = parseRange(req.headers.get('range'), size);
    if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const obj = await b.get(a.storageKey, range ? { range } : undefined);
    if (!obj) return bad('Файл не найден в хранилище', 404);
    const headers: Record<string, string> = {
      'Content-Type': a.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': contentDisposition(url.searchParams.get('download') ? 'attachment' : 'inline', a.fileName ?? 'file'),
    };
    if (range) { headers['Content-Range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`; headers['Content-Length'] = String(range.length); }
    else if (size) headers['Content-Length'] = String(size);
    return new Response(obj.body, { status: range ? 206 : 200, headers });
  } catch { return bad('Не удалось открыть файл', 503); }
}

/** Upload (multipart): projectId, id, kind (reference | image | video), text, file. Editors only. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await currentEditor();
  if (!actor) return forbidden(req);
  const b = bucket();
  if (!b) return bad(NOT_CONNECTED, 503);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_FILE + 64 * 1024) return bad('Файл слишком большой', 413);
  let form: FormData;
  try { form = await req.formData(); } catch { return bad('Неверный запрос'); }
  const file = form.get('file');
  const projectId = form.get('projectId'), id = form.get('id'), kindIn = form.get('kind');
  const text = typeof form.get('text') === 'string' ? (form.get('text') as string).trim().slice(0, 10000) : '';
  if (!(file instanceof File) || !isUuid(projectId) || !isUuid(id) || !['reference', 'image', 'video'].includes(kindIn as string)) return bad('Выберите файл');
  if (file.size > MAX_FILE) return bad('Файл слишком большой', 413);
  try {
    const [dup] = await getDb().select({ id: aiAssets.id }).from(aiAssets).where(eq(aiAssets.id, id)).limit(1);
    if (dup) return Response.json({ id }, { status: 200 }); // repeated submit
    const stored = await storeBytes(b, id, new Uint8Array(await file.arrayBuffer()), file.type, file.name);
    if ('error' in stored) return bad(stored.error, 415);
    // A video file is always a video asset; an image may be a reference or an image (approvable frame).
    const kind = stored.kind === 'video' ? 'video' : kindIn === 'video' ? 'image' : kindIn as string;
    const db = getD1() as unknown as D1; const sql = q(db); const now = new Date().toISOString();
    const r = await db.batch([
      sql`INSERT INTO ai_assets (id, project_id, kind, url, text, source, job_id, expires_at, storage_key, mime, size, file_name, created_at, created_by)
        SELECT ${id}, ${projectId}, ${kind}, '', ${text}, 'upload', NULL, NULL, ${stored.storageKey}, ${stored.mime}, ${stored.size}, ${stored.fileName}, ${now}, ${actor}
        WHERE EXISTS (SELECT 1 FROM ai_projects WHERE id = ${projectId}) ON CONFLICT(id) DO NOTHING`,
      sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${crypto.randomUUID()}, 'ai', ${projectId}, 'asset.upload', ${actor}, ${now}, NULL, ${JSON.stringify({ id, kind, mime: stored.mime, size: stored.size })} WHERE changes() = 1`,
      sql`UPDATE ai_projects SET updated_at = ${now} WHERE id = ${projectId}`,
    ]);
    if (((r[0] as { meta?: { changes?: number } }).meta?.changes ?? 0) !== 1) {
      await b.delete(stored.storageKey).catch(() => {}); // the object was written moments ago for this request only
      return bad('Проект не найден', 404);
    }
    return Response.json({ id, kind, mime: stored.mime, size: stored.size }, { status: 201 });
  } catch { return bad('Не удалось загрузить файл. Ничего не сохранено.', 503); }
}
