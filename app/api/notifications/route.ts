import { eq } from 'drizzle-orm';
import { getDb } from '../../../db';
import { aiAssets, aiGenerationJobs, contentItems, editVersions, feedbackComments, integrationConnections, notificationReads, shoots, tasks } from '../../../db/schema';
import { getAccess } from '../../permissions';
import { forbidden, sameOrigin } from '../../../lib/actor';
import { buildNotifications } from '../../../lib/notifications';
import { buildReviewTurns } from '../../../lib/review-turn';
import type { Task } from '../../../lib/tasks';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** Notifications for the signed-in team member, with their own read marks. */
export async function GET() {
  const a = await getAccess();
  if (!a.caps.internal || !a.email) return forbidden();
  try {
    const db = getDb();
    const [t, c, j, as, sh, ig, reads, versions, returns] = await Promise.all([
      db.select().from(tasks), db.select().from(contentItems), db.select().from(aiGenerationJobs), db.select().from(aiAssets), db.select().from(shoots),
      db.select().from(integrationConnections).where(eq(integrationConnections.provider, 'instagram')).limit(1),
      db.select().from(notificationReads).where(eq(notificationReads.userEmail, a.email)),
      db.select({ contentId: editVersions.contentId, id: editVersions.id, number: editVersions.number }).from(editVersions),
      db.select({ contentId: feedbackComments.contentId, versionId: feedbackComments.versionId, at: feedbackComments.at }).from(feedbackComments).where(eq(feedbackComments.kind, 'changes_requested')),
    ]);
    const turns = buildReviewTurns(versions, returns);
    const memberName = a.role === 'owner' ? 'Данил' : a.memberName;
    const content = c.map(row => ({ ...row, reviewTurn: turns.get(row.id) ?? null }));
    const items = buildNotifications({ caps: a.caps, memberName, tasks: t as Task[], content, jobs: j, assets: as, shoots: sh, instagram: ig[0] ?? null });
    const read = new Set(reads.map(r => r.key));
    const list = items.map(n => ({ ...n, read: read.has(n.key) }));
    return Response.json({ items: list, unread: list.filter(n => !n.read).length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return bad('Уведомления недоступны', 503); }
}

/** Marks notifications as read for this user only. Marks are never removed; a new event gets a new key. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const a = await getAccess();
  if (!a.caps.internal || !a.email) return forbidden(req);
  let x: { keys?: unknown };
  try { x = await req.json(); } catch { return bad('Неверный запрос'); }
  const keys = Array.isArray(x.keys) ? [...new Set(x.keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 300))].slice(0, 200) : [];
  if (!keys.length) return bad('Неверный запрос');
  try {
    const db = getDb();
    const now = new Date().toISOString();
    // D1 allows up to 100 bound values per statement: 3 per row, so 30 rows per insert.
    for (let i = 0; i < keys.length; i += 30) await db.insert(notificationReads).values(keys.slice(i, i + 30).map(key => ({ userEmail: a.email!, key, readAt: now }))).onConflictDoNothing();
    return Response.json({ ok: true });
  } catch { return bad('Не удалось сохранить', 503); }
}
