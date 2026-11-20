import { eq } from 'drizzle-orm';
import { getChatGPTUser } from './chatgpt-auth';
import { getDb } from '../db';
import { teamMembers } from '../db/schema';
import { normEmail, resolveAccess, type Access, type MemberRow } from '../lib/rbac';
// Explicit owner allowlist. Visitor identity is supplied by Sites, never by browser state.
// The owner is always admin with finance; team_members can never remove or downgrade this.
export const OWNER_EMAIL = "4q7h7cbdpm@privaterelay.appleid.com";

/** Server-side access of the current request. Other people get a role only through an ACTIVE team_members row. */
export async function getAccess(): Promise<Access> {
  const user = await getChatGPTUser();
  if (!user) return resolveAccess(null, OWNER_EMAIL, null);
  const email = normEmail(user.email)!;
  if (email === normEmail(OWNER_EMAIL)) return resolveAccess(user, OWNER_EMAIL, null);
  let member: (MemberRow & { id: string; firstSeenAt: string | null; lastSeenAt: string | null }) | null = null;
  try {
    const db = getDb();
    [member] = await db.select().from(teamMembers).where(eq(teamMembers.email, email)).limit(1);
    // Signing in through Sites with this email confirms the address; recorded at most hourly. Grants nothing by itself.
    if (member && (!member.lastSeenAt || Date.now() - Date.parse(member.lastSeenAt) > 3_600_000)) {
      const now = new Date().toISOString();
      await db.update(teamMembers).set({ lastSeenAt: now, firstSeenAt: member.firstSeenAt ?? now }).where(eq(teamMembers.id, member.id));
    }
  } catch { member = null; /* table missing before migration 0005, or DB down: no extra roles, owner unaffected */ }
  return resolveAccess(user, OWNER_EMAIL, member ?? null);
}
export async function canEditCalendar() { return (await getAccess()).caps.edit; }
export async function canViewFinance() { return (await getAccess()).caps.finance; }
