import { getAccess } from '../../permissions';
import { ROLE_LABELS } from '../../../lib/rbac';

export const dynamic = 'force-dynamic';

/** What the current visitor may do. Identity comes from Sites; nothing here grants anything. */
export async function GET() {
  const a = await getAccess();
  return Response.json({ ...a, roleLabel: a.role ? ROLE_LABELS[a.role] : null }, { headers: { 'Cache-Control': 'no-store' } });
}
