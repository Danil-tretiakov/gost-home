import { normalizeShootStatus } from './shoot-status';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { shoots } from '../db/schema';

export async function getShootById(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [shoot] = await getDb().select().from(shoots).where(eq(shoots.id, id)).limit(1);
  return shoot ? {...shoot,status:normalizeShootStatus(shoot.status)} : null;
}
