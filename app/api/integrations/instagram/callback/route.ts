import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../../../db';
import { integrationConnections } from '../../../../../db/schema';
import { actorWith } from '../../../../../lib/actor';
import { q, type D1 } from '../../../../../lib/content-writes';
import { exchangeCode } from '../../../../../lib/integrations/instagram';

export const dynamic = 'force-dynamic';

/** OAuth callback: checks state (10 minutes, single use), exchanges the code on the server, stores only the encrypted token. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (msg: string) => Response.redirect(`${url.origin}/?instagram=${encodeURIComponent(msg)}#settings`, 303);
  const actor = await actorWith('admin');
  if (!actor) return back('forbidden');
  const db = getD1() as unknown as D1;
  const sql = q(db);
  const [row] = await getDb().select().from(integrationConnections).where(eq(integrationConnections.provider, 'instagram')).limit(1);
  const [state, issued] = (row?.oauthState ?? '').split('|');
  const now = new Date().toISOString();
  const fresh = issued && Date.now() - Date.parse(issued) < 10 * 60_000;
  if (!state || !fresh || url.searchParams.get('state') !== state) return back('state');
  // Consume the state first so a replayed callback cannot reuse it.
  await db.batch([sql`UPDATE integration_connections SET oauth_state = NULL, updated_at = ${now} WHERE provider = 'instagram' AND oauth_state = ${row!.oauthState}`]);
  const code = url.searchParams.get('code');
  if (!code) {
    await db.batch([sql`UPDATE integration_connections SET status = ${row?.tokenCipher ? 'connected' : 'disconnected'}, last_error = ${'Доступ не выдан'} WHERE provider = 'instagram'`]);
    return back('denied');
  }
  try {
    const t = await exchangeCode(code, url.origin);
    await db.batch([
      sql`UPDATE integration_connections SET status = 'connected', account_id = ${t.accountId}, account_name = ${t.accountName}, token_cipher = ${t.cipher},
        token_expires_at = ${t.expiresAt}, last_error = NULL, updated_at = ${now} WHERE provider = 'instagram'`,
      sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) VALUES (${crypto.randomUUID()}, 'integration', 'instagram', 'connect', ${actor}, ${now}, NULL, ${JSON.stringify({ account: t.accountName ?? t.accountId })})`,
    ]);
    return back('connected');
  } catch (e) {
    await db.batch([sql`UPDATE integration_connections SET status = ${row?.tokenCipher ? 'connected' : 'error'}, last_error = ${(e as Error).message.slice(0, 300)}, updated_at = ${now} WHERE provider = 'instagram'`]);
    return back('error');
  }
}
