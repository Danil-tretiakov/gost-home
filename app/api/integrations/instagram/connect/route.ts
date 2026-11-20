import { getD1 } from '../../../../../db';
import { actorWith } from '../../../../../lib/actor';
import { q, type D1 } from '../../../../../lib/content-writes';
import { authorizeUrl } from '../../../../../lib/integrations/instagram-core';
import { appId, instagramConfigured, redirectUri } from '../../../../../lib/integrations/instagram';

export const dynamic = 'force-dynamic';

/** Starts Instagram Business Login. The state is stored server-side and checked in the callback. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  if (!(await actorWith('admin'))) return Response.redirect(`${origin}/#settings`, 303);
  if (!instagramConfigured()) return Response.redirect(`${origin}/#settings`, 303);
  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getD1() as unknown as D1;
  await db.batch([q(db)`INSERT INTO integration_connections (provider, status, oauth_state, updated_at) VALUES ('instagram', 'connecting', ${state + '|' + now}, ${now})
    ON CONFLICT(provider) DO UPDATE SET oauth_state = excluded.oauth_state, updated_at = excluded.updated_at`]);
  return Response.redirect(authorizeUrl(appId()!, redirectUri(origin), state), 303);
}
