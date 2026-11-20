import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../../db';
import { appSettings, contentItems } from '../../../../db/schema';
import { currentEditor, forbidden, sameOrigin } from '../../../../lib/actor';
import { autoplan } from '../../../../lib/autoplan';
import { applyAutoplan } from '../../../../lib/content-writes';
import { mergePlan, PLAN_SETTINGS_KEY } from '../../../../lib/plan-settings';

export const dynamic = 'force-dynamic';
const bangkokToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

async function compute(month: string, fillEmpty: boolean) {
  const db = getDb();
  const [rows, [setting]] = await Promise.all([db.select().from(contentItems), db.select().from(appSettings).where(eq(appSettings.key, PLAN_SETTINGS_KEY)).limit(1)]);
  let stored: unknown = null; try { stored = setting ? JSON.parse(setting.value) : null; } catch { stored = null; }
  return autoplan(rows.map(r => ({ ...r, type: r.type as 'reel' | 'youtube' })), month, bangkokToday(), mergePlan(stored), { fillEmpty });
}

/** Preview only. Nothing is written. */
export async function GET(req: Request) {
  if (!(await currentEditor())) return forbidden(req);
  const u = new URL(req.url);
  const month = u.searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return Response.json({ error: 'Неверный месяц' }, { status: 400 });
  try { return Response.json(await compute(month, u.searchParams.get('fillEmpty') === '1'), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Не удалось рассчитать план' }, { status: 503 }); }
}

/** Applies the slots the user kept from the preview. The server recomputes the plan and accepts only slots it proposes. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await currentEditor();
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return Response.json({ error: 'Неверный запрос' }, { status: 400 }); }
  const month = typeof x.month === 'string' ? x.month : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Array.isArray(x.slots)) return Response.json({ error: 'Неверный запрос' }, { status: 400 });
  try {
    const plan = await compute(month, true);
    const key = (s: { date: string; member: string; itemId?: string | null }) => `${s.date}|${s.member}|${s.itemId ?? ''}`;
    const allowed = new Map(plan.slots.map(s => [key(s), s]));
    const chosen = (x.slots as { date: string; member: string; itemId?: string | null }[]).map(s => allowed.get(key({ ...s, itemId: s.itemId ?? null })));
    if (chosen.some(s => !s)) return Response.json({ error: 'План изменился. Пересчитайте предпросмотр.' }, { status: 409 });
    const assignments = chosen.filter(s => s!.kind === 'assign').map(s => ({ id: s!.itemId!, revision: s!.itemRevision!, date: s!.date }));
    const newSlots = chosen.filter(s => s!.kind !== 'assign').map(s => ({ id: crypto.randomUUID(), member: s!.member, date: s!.date, title: `Reels: ${s!.member}` }));
    if (!assignments.length && !newSlots.length) return Response.json({ error: 'Нечего применять' }, { status: 400 });
    try { await applyAutoplan(getD1(), { month, actor, assignments, newSlots }); }
    catch { return Response.json({ error: 'Часть роликов уже изменилась. Ничего не сохранено, пересчитайте предпросмотр.' }, { status: 409 }); }
    return Response.json({ assigned: assignments.length, created: newSlots.length });
  } catch { return Response.json({ error: 'Не удалось применить план' }, { status: 503 }); }
}
