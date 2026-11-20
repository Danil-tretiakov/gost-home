import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../db';
import { contentItems, instagramMedia, integrationConnections } from '../../../db/schema';
import { actorWith, forbidden, sameOrigin } from '../../../lib/actor';
import { isIsoDate, isUuid } from '../../../lib/content-values';
import { q, type D1 } from '../../../lib/content-writes';
import { bangkokDay, candidates, isReel } from '../../../lib/integrations/instagram-core';
import { fetchMedia, instagramConfigured, usableToken } from '../../../lib/integrations/instagram';
import { higgsfieldConfigured } from '../../../lib/integrations/higgsfield';
import { secret } from '../../../lib/integrations/env';
import { bucket } from '../../../lib/files';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const SYNC_EVERY_MS = 6 * 3_600_000;
type Conn = typeof integrationConnections.$inferSelect;

/** Reads media through the official API and upserts API facts only; links, ignore flags and manual data are never overwritten. */
async function syncInstagram(conn: Conn, actor: string, now: string): Promise<{ synced: number } | { error: string }> {
  const db = getD1() as unknown as D1;
  const sql = q(db);
  try {
    const { token, refreshed } = await usableToken(conn.tokenCipher!, conn.tokenExpiresAt);
    const media = await fetchMedia(token);
    await db.batch([
      ...media.map(m => sql`INSERT INTO instagram_media (media_id, permalink, caption, media_type, media_product_type, timestamp, like_count, comments_count, content_id, matched_at, matched_by, ignored, synced_at)
        VALUES (${m.mediaId}, ${m.permalink}, ${m.caption}, ${m.mediaType}, ${m.mediaProductType}, ${m.timestamp}, ${m.likeCount}, ${m.commentsCount}, NULL, NULL, NULL, 0, ${now})
        ON CONFLICT(media_id) DO UPDATE SET permalink = excluded.permalink, caption = excluded.caption, media_type = excluded.media_type,
          media_product_type = excluded.media_product_type, like_count = excluded.like_count, comments_count = excluded.comments_count, synced_at = excluded.synced_at`),
      refreshed
        ? sql`UPDATE integration_connections SET token_cipher = ${refreshed.cipher}, token_expires_at = ${refreshed.expiresAt}, last_sync_at = ${now}, last_error = NULL, status = 'connected', updated_at = ${now} WHERE provider = 'instagram'`
        : sql`UPDATE integration_connections SET last_sync_at = ${now}, last_error = NULL, status = 'connected', updated_at = ${now} WHERE provider = 'instagram'`,
      sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) VALUES (${crypto.randomUUID()}, 'integration', 'instagram', 'instagram.sync', ${actor}, ${now}, NULL, ${JSON.stringify({ media: media.length })})`,
    ]);
    return { synced: media.length };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    // The error stops automatic retries until a manual sync succeeds (it clears last_error).
    await db.batch([sql`UPDATE integration_connections SET last_error = ${msg}, updated_at = ${now} WHERE provider = 'instagram'`]).catch(() => {});
    return { error: msg };
  }
}

/** Connection status for editors. Tokens and secrets are never returned, only whether they exist. */
export async function GET() {
  if (!(await actorWith('admin'))) return forbidden();
  try {
    const db = getDb();
    let [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.provider, 'instagram')).limit(1);
    // Sites gives this project no scheduled jobs (no cron trigger), so the sync runs when an admin opens the status, at most every 6 hours.
    let autoSync: 'ran' | 'failed' | null = null;
    if (instagramConfigured() && conn?.tokenCipher && conn.status !== 'error' && !conn.lastError && (!conn.lastSyncAt || Date.now() - Date.parse(conn.lastSyncAt) > SYNC_EVERY_MS)) {
      const r = await syncInstagram(conn, 'автосинхронизация', new Date().toISOString());
      autoSync = 'error' in r ? 'failed' : 'ran';
      [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.provider, 'instagram')).limit(1);
    }
    const media = await db.select().from(instagramMedia);
    const items = await db.select().from(contentItems);
    const reels = media.filter(m => !m.ignored && isReel(m)).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const unmatched = reels.filter(m => !m.contentId).slice(0, 30).map(m => {
      const day = bangkokDay(m.timestamp);
      return { ...m, day, candidates: day ? candidates(day, items).slice(0, 5).map(i => ({ id: i.id, title: i.title, primaryMember: i.primaryMember, plannedPublishDate: i.plannedPublishDate, productionStatus: i.productionStatus, revision: i.revision })) : [] };
    });
    return Response.json({
      higgsfield: { configured: higgsfieldConfigured() }, storage: { connected: !!bucket(), linkSigning: !!secret('FILE_LINK_SECRET') },
      instagram: {
        configured: instagramConfigured(),
        status: conn?.tokenCipher ? (conn.status === 'error' ? 'error' : 'connected') : 'not_connected',
        account: conn?.tokenCipher ? (conn.accountName ?? conn.accountId) : null,
        tokenExpiresAt: conn?.tokenCipher ? conn.tokenExpiresAt : null,
        lastSyncAt: conn?.lastSyncAt ?? null, lastError: conn?.lastError ?? null, autoSync, syncEveryHours: SYNC_EVERY_MS / 3_600_000,
        mediaCount: media.length, matched: media.filter(m => m.contentId).map(m => ({ mediaId: m.mediaId, contentId: m.contentId, permalink: m.permalink, likeCount: m.likeCount, commentsCount: m.commentsCount, timestamp: m.timestamp })),
        unmatched,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return bad('Не удалось загрузить интеграции', 503); }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await actorWith('admin');
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return bad('Неверный запрос'); }
  const db = getD1() as unknown as D1;
  const sql = q(db);
  const now = new Date().toISOString();
  const audit = (action: string, id: string, after: unknown) =>
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) VALUES (${crypto.randomUUID()}, 'integration', ${id}, ${action}, ${actor}, ${now}, NULL, ${JSON.stringify(after)})`;
  try {
    switch (x.action) {
      case 'instagram.sync': {
        if (!instagramConfigured()) return bad('Instagram не подключён: на сервере нет ключей приложения', 409);
        const [conn] = await getDb().select().from(integrationConnections).where(eq(integrationConnections.provider, 'instagram')).limit(1);
        if (!conn?.tokenCipher) return bad('Сначала подключите аккаунт Instagram', 409);
        const r = await syncInstagram(conn, actor, now);
        return 'error' in r ? bad(`Синхронизация не удалась: ${r.error}`, 502) : Response.json(r);
      }
      case 'instagram.match': {
        // The user confirms that this Instagram Reel is this content item. Only then the item becomes "published".
        const mediaId = typeof x.mediaId === 'string' && /^\d{1,40}$/.test(x.mediaId) ? x.mediaId : null;
        if (!mediaId || !isUuid(x.contentId) || !Number.isInteger(x.revision)) return bad('Неверный запрос');
        const [m] = await getDb().select().from(instagramMedia).where(eq(instagramMedia.mediaId, mediaId)).limit(1);
        const [item] = await getDb().select().from(contentItems).where(eq(contentItems.id, x.contentId)).limit(1);
        if (!m || !item) return bad('Публикация или ролик не найдены', 404);
        if (m.contentId) return bad('Эта публикация уже сопоставлена', 409);
        if (item.productionStatus !== 'approved' && item.productionStatus !== 'published') return bad('Отметить публикацию можно только у согласованного ролика', 409);
        const day = bangkokDay(m.timestamp);
        if (!day || !isIsoDate(day)) return bad('У публикации нет даты', 409);
        const auditId = crypto.randomUUID();
        const finalId = crypto.randomUUID();
        const guard = `EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`;
        const toPublish = item.productionStatus === 'approved';
        await db.batch([
          sql`UPDATE content_items SET production_status = 'published', published_at = ${toPublish ? day : item.publishedAt ?? day}, updated_at = ${now}, updated_by = ${actor}, revision = revision + 1
            WHERE id = ${item.id} AND revision = ${x.revision} AND production_status = ${item.productionStatus}`,
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
            SELECT ${auditId}, 'content', ${item.id}, 'instagram.match', ${actor}, ${now}, ${JSON.stringify({ productionStatus: item.productionStatus, publishedAt: item.publishedAt })},
              ${JSON.stringify({ productionStatus: 'published', publishedAt: toPublish ? day : item.publishedAt ?? day, mediaId, permalink: m.permalink })} WHERE changes() = 1`,
          ...(toPublish ? [db.prepare(`INSERT INTO status_events (id, content_id, from_status, to_status, version_id, comment, actor, at) SELECT ?, ?, 'approved', 'published', NULL, ?, ?, ? WHERE ${guard}`)
            .bind(crypto.randomUUID(), item.id, `Instagram: ${m.permalink ?? mediaId}`, actor, now, auditId)] : []),
          db.prepare(`UPDATE instagram_media SET content_id = ?, matched_at = ?, matched_by = ? WHERE media_id = ? AND content_id IS NULL AND ${guard}`).bind(item.id, now, actor, mediaId, auditId),
          // All or nothing: if the item changed or the media got linked meanwhile, this NULL primary key aborts the whole batch.
          db.prepare(`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after)
            VALUES (CASE WHEN (SELECT content_id FROM instagram_media WHERE media_id = ?) = ? AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?) THEN ? ELSE NULL END, 'integration', 'instagram', 'match.check', ?, ?, NULL, NULL)`)
            .bind(mediaId, item.id, auditId, finalId, actor, now),
        ]).catch(e => { if (/NOT NULL/i.test(String(e))) throw new Error('stale'); throw e; });
        const [saved] = await getDb().select().from(contentItems).where(eq(contentItems.id, item.id)).limit(1);
        return Response.json({ ok: true, item: saved });
      }
      case 'instagram.ignore': {
        const mediaId = typeof x.mediaId === 'string' && /^\d{1,40}$/.test(x.mediaId) ? x.mediaId : null;
        if (!mediaId) return bad('Неверный запрос');
        await db.batch([sql`UPDATE instagram_media SET ignored = 1 WHERE media_id = ${mediaId} AND content_id IS NULL`, audit('instagram.ignore', mediaId, {})]);
        return Response.json({ ok: true });
      }
      case 'instagram.disconnect': {
        // Removes the stored token. Synced media and confirmed links stay as history.
        await db.batch([
          sql`UPDATE integration_connections SET status = 'disconnected', token_cipher = NULL, token_expires_at = NULL, oauth_state = NULL, updated_at = ${now} WHERE provider = 'instagram'`,
          audit('instagram.disconnect', 'instagram', {}),
        ]);
        return Response.json({ ok: true });
      }
      default: return bad('Неизвестное действие');
    }
  } catch (e) {
    if ((e as Error).message === 'stale') return bad('Ролик или публикация уже изменены. Обновите.', 409);
    return bad('Не удалось сохранить. Ничего не изменено.', 503);
  }
}
