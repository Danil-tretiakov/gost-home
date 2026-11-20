import { getAccess } from '../app/permissions';
import type { Caps } from './rbac';

/** The signed-in user's display name if they have the capability, else null. Identity comes from Sites headers only. */
export async function actorWith(cap: keyof Caps): Promise<string | null> {
  const a = await getAccess();
  return a.caps[cap] ? a.name ?? a.email : null;
}
/** Editor (admin role or owner). */
export const currentEditor = () => actorWith('edit');
/** Anyone allowed to read internal data (viewer, reviewer, admin, owner). */
export const internalReader = () => actorWith('internal');

export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

/** 403. With the request, a small unread body is drained first (the local dev proxy stalls the next request otherwise). */
export function forbidden(req?: Request): Response | Promise<Response> {
  const res = Response.json({ error: 'Недостаточно прав для этого действия' }, { status: 403 });
  return req ? drainThen(req, res) : res;
}
export function drainThen(req: Request, res: Response): Response | Promise<Response> {
  if (!req.body || req.bodyUsed) return res;
  if (Number(req.headers.get('content-length') ?? Infinity) > 1_000_000) { req.body.cancel().catch(() => {}); return res; }
  return req.arrayBuffer().then(() => res, () => res);
}
