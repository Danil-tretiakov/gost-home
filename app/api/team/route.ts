import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../db';
import { teamMembers } from '../../../db/schema';
import { getAccess, OWNER_EMAIL } from '../../permissions';
import { forbidden, sameOrigin } from '../../../lib/actor';
import { isUuid } from '../../../lib/content-values';
import type { D1 } from '../../../lib/content-writes';
import { normEmail, ROLE_HINTS, ROLE_LABELS } from '../../../lib/rbac';
import { parseTeamInput } from '../../../lib/team';
import { applyMemberCreate, applyMemberStatus, applyMemberUpdate } from '../../../lib/team-writes';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const noStore = { 'Cache-Control': 'no-store' };

async function admin() {
  const a = await getAccess();
  return a.caps.admin ? a : null;
}
async function load(id: string) { const [m] = await getDb().select().from(teamMembers).where(eq(teamMembers.id, id)).limit(1); return m ?? null; }
async function emailTaken(email: string | null, id: string) {
  if (!email) return false;
  const [other] = await getDb().select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.email, email)).limit(1);
  return !!other && other.id !== id;
}

/** Team access list. Admins only. The owner is shown as a fixed entry and is not stored here. */
export async function GET() {
  const a = await admin();
  if (!a) return forbidden();
  try {
    const members = await getDb().select().from(teamMembers);
    return Response.json({ owner: { email: OWNER_EMAIL, label: ROLE_LABELS.owner }, members, roles: ROLE_LABELS, hints: ROLE_HINTS, canGrantFinance: a.caps.finance }, { headers: noStore });
  } catch { return bad('Список доступа недоступен. Примените миграцию 0005.', 503); }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const a = await admin();
  if (!a) return forbidden(req);
  const actor = a.name ?? a.email ?? 'admin';
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return bad('Неверный запрос'); }
  if (!isUuid(x.id)) return bad('Неверный запрос');
  const id = x.id;
  const db = getD1() as unknown as D1;
  try {
    const before = await load(id);
    // Nobody but the owner changes their own entry: an admin cannot lock themselves out or raise their own rights.
    if (before && a.role !== 'owner' && normEmail(before.email) === a.email) return bad('Свою запись может менять только владелец', 403);
    if (x.action === 'create' || x.action === 'update') {
      const p = parseTeamInput(x, OWNER_EMAIL);
      if (!p.ok) return bad(p.error);
      // Finance is a separate permission: only someone who has it can grant or keep it.
      if (!a.caps.finance && (p.fields.finance || before?.finance === 1)) return bad('Доступ к выплатам может выдавать только тот, у кого он есть', 403);
      if (await emailTaken(p.fields.email, id)) return bad('Этот адрес уже есть в списке', 409);
      if (x.action === 'create') {
        const result = await applyMemberCreate(db, { id, ...p.fields, actor });
        return Response.json(await load(id), { status: result === 'created' ? 201 : 200 });
      }
      if (!before) return bad('Запись не найдена', 404);
      if (!Number.isInteger(x.revision)) return bad('Неверный запрос');
      const ok = await applyMemberUpdate(db, { id, revision: x.revision as number, fields: p.fields, actor, before });
      if (!ok) return Response.json({ error: 'Запись уже изменили. Обновите и повторите.', current: await load(id) }, { status: 409 });
      return Response.json(await load(id));
    }
    if (x.action === 'activate' || x.action === 'disable') {
      if (!before) return bad('Запись не найдена', 404);
      if (!Number.isInteger(x.revision)) return bad('Неверный запрос');
      if (x.action === 'activate' && !before.email) return bad('Адрес не подтверждён: без почты доступ выдать нельзя');
      if (!a.caps.finance && before.finance === 1) return bad('Доступ к выплатам может менять только тот, у кого он есть', 403);
      const ok = await applyMemberStatus(db, { id, revision: x.revision as number, status: x.action === 'activate' ? 'active' : 'disabled', actor });
      if (!ok) return Response.json({ error: 'Запись уже изменили. Обновите и повторите.', current: await load(id) }, { status: 409 });
      return Response.json(await load(id));
    }
    return bad('Неизвестное действие');
  } catch { return bad('Не удалось сохранить. Ничего не изменено.', 503); }
}
