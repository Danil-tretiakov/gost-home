import { eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../db';
import { appSettings } from '../../../db/schema';
import { applySettingsSave } from '../../../lib/content-writes';
import { currentEditor, forbidden, sameOrigin } from '../../../lib/actor';
import { mergePlan, parsePlanSettings, PLAN_SETTINGS_KEY } from '../../../lib/plan-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, PLAN_SETTINGS_KEY)).limit(1);
    let stored: unknown = null;
    try { stored = row ? JSON.parse(row.value) : null; } catch { stored = null; }
    return Response.json({ plan: mergePlan(stored), revision: row?.revision ?? 0, isDefault: !row }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Не удалось загрузить настройки' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await currentEditor();
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return Response.json({ error: 'Неверный запрос' }, { status: 400 }); }
  const plan = parsePlanSettings(x.plan);
  if (!plan || !Number.isInteger(x.revision)) return Response.json({ error: 'Проверьте значения плана' }, { status: 400 });
  const revision = x.revision as number;
  try {
    const db = getDb();
    const value = JSON.stringify(plan);
    const [before] = await db.select().from(appSettings).where(eq(appSettings.key, PLAN_SETTINGS_KEY)).limit(1);
    const applied = await applySettingsSave(getD1(), { key: PLAN_SETTINGS_KEY, value, revision, actor, before: before?.value ?? null });
    if (!applied) return Response.json({ error: 'Настройки уже изменены. Обновите страницу.' }, { status: 409 });
    return Response.json({ plan, revision: revision + 1, isDefault: false });
  } catch {
    return Response.json({ error: 'Не удалось сохранить настройки' }, { status: 503 });
  }
}
