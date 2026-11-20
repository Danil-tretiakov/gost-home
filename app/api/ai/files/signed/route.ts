import { eq } from 'drizzle-orm';
import { getDb } from '../../../../../db';
import { aiAssets } from '../../../../../db/schema';
import { verifyLink } from '../../../../../lib/files-core';
import { bucket } from '../../../../../lib/files';
import { secret } from '../../../../../lib/integrations/env';

export const dynamic = 'force-dynamic';

/**
 * Short-lived signed link (max 1 hour) for ONE stored image: lets the video provider read the approved frame.
 * Works only when FILE_LINK_SECRET is set on the server; otherwise always 404.
 */
export async function GET(req: Request) {
  const key = secret('FILE_LINK_SECRET');
  const b = bucket();
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? '', exp = Number(u.searchParams.get('exp')), sig = u.searchParams.get('sig') ?? '';
  if (!key || !b || !(await verifyLink(key, id, exp, sig))) return new Response('Not found', { status: 404 });
  const [a] = await getDb().select().from(aiAssets).where(eq(aiAssets.id, id)).limit(1);
  if (!a?.storageKey || a.kind !== 'image' || !a.mime?.startsWith('image/')) return new Response('Not found', { status: 404 });
  const obj = await b.get(a.storageKey);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, { headers: { 'Content-Type': a.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=0, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}
