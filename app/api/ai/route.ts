import { desc, eq } from 'drizzle-orm';
import { getD1, getDb } from '../../../db';
import { aiAssets, aiGenerationJobs, aiProjects, appSettings, contentItems } from '../../../db/schema';
import { currentEditor, forbidden, internalReader, sameOrigin } from '../../../lib/actor';
import { isUuid } from '../../../lib/content-values';
import { applySettingsSave, q, type D1 } from '../../../lib/content-writes';
import { AI_SETTINGS_KEY, DEFAULT_AI, parseAiSettings, type AiSettings } from '../../../lib/ai-settings';
import { buildBody, PRESETS, TERMINAL, validEndpoint, type JobUpdate } from '../../../lib/integrations/higgsfield-core';
import { higgsfieldConfigured, poll, submit } from '../../../lib/integrations/higgsfield';
import { secret } from '../../../lib/integrations/env';
import { signLink } from '../../../lib/files-core';
import { bucket, fetchToBucket } from '../../../lib/files';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const httpsUrl = (v: unknown) => { try { return typeof v === 'string' && v.length <= 2000 && new URL(v).protocol === 'https:' ? v : null; } catch { return null; } };
const monthStart = () => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).slice(0, 7); return `${d}-01T00:00:00+07:00`; };

async function aiSettings(): Promise<{ settings: AiSettings; revision: number; raw: string | null }> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY)).limit(1);
  let parsed: AiSettings | null = null;
  try { parsed = row ? parseAiSettings(JSON.parse(row.value)) : null; } catch { parsed = null; }
  return { settings: parsed ?? DEFAULT_AI, revision: row?.revision ?? 0, raw: row?.value ?? null };
}
async function usedThisMonth() {
  const since = new Date(monthStart()).toISOString();
  const jobs = await getDb().select({ createdAt: aiGenerationJobs.createdAt, status: aiGenerationJobs.status }).from(aiGenerationJobs);
  return jobs.filter(j => j.createdAt >= since && j.status !== 'error').length;
}

/** AI studio data. Editors only: prompts and provider links are internal. */
export async function GET() {
  if (!(await internalReader())) return forbidden();
  try {
    const db = getDb();
    const [projects, assets, jobs, s, used] = await Promise.all([
      db.select().from(aiProjects).orderBy(desc(aiProjects.updatedAt)), db.select().from(aiAssets), db.select().from(aiGenerationJobs).orderBy(desc(aiGenerationJobs.createdAt)),
      aiSettings(), usedThisMonth(),
    ]);
    return Response.json({
      configured: higgsfieldConfigured(), storage: !!bucket(), linkSigning: !!secret('FILE_LINK_SECRET'), presets: PRESETS, settings: s.settings, settingsRevision: s.revision, usedThisMonth: used,
      projects, assets, jobs: jobs.map(j => ({ ...j, statusUrl: undefined })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return bad('Не удалось загрузить AI-студию', 503); }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  const actor = await currentEditor();
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return bad('Неверный запрос'); }
  const db = getD1() as unknown as D1;
  const sql = q(db);
  const now = new Date().toISOString();
  try {
    switch (x.action) {
      case 'settings.save': {
        const s = parseAiSettings(x.settings);
        if (!s || !Number.isInteger(x.revision)) return bad('Лимит: целое число от 0 до 1000');
        const cur = await aiSettings();
        const ok = await applySettingsSave(getD1(), { key: AI_SETTINGS_KEY, value: JSON.stringify(s), revision: x.revision as number, actor, before: cur.raw });
        return ok ? Response.json({ settings: s, revision: (x.revision as number) + 1 }) : bad('Настройки уже изменены. Обновите.', 409);
      }
      case 'project.create': {
        const title = str(x.title, 200);
        if (!title) return bad('Укажите название');
        const contentId = isUuid(x.contentId) ? x.contentId : null;
        if (contentId) { const [c] = await getDb().select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, contentId)).limit(1); if (!c) return bad('Ролик не найден', 404); }
        const id = isUuid(x.id) ? x.id : crypto.randomUUID();
        await db.batch([
          sql`INSERT INTO ai_projects (id, content_id, title, brief, prompt, motion_prompt, approved_asset_id, created_at, created_by, updated_at, revision)
            VALUES (${id}, ${contentId}, ${title}, ${str(x.brief, 5000)}, '', '', NULL, ${now}, ${actor}, ${now}, 1) ON CONFLICT(id) DO NOTHING`,
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${crypto.randomUUID()}, 'ai', ${id}, 'project.create', ${actor}, ${now}, NULL, ${JSON.stringify({ title, contentId })} WHERE changes() = 1`,
        ]);
        return Response.json({ id }, { status: 201 });
      }
      case 'project.update': {
        if (!isUuid(x.id) || !Number.isInteger(x.revision)) return bad('Неверный запрос');
        const title = str(x.title, 200);
        if (!title) return bad('Укажите название');
        const contentId = isUuid(x.contentId) ? x.contentId : null;
        const r = await db.batch([
          sql`UPDATE ai_projects SET title = ${title}, content_id = ${contentId}, brief = ${str(x.brief, 5000)}, prompt = ${str(x.prompt, 4000)}, motion_prompt = ${str(x.motionPrompt, 4000)}, updated_at = ${now}, revision = revision + 1
            WHERE id = ${x.id} AND revision = ${x.revision}`,
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${crypto.randomUUID()}, 'ai', ${x.id}, 'project.update', ${actor}, ${now}, NULL, ${JSON.stringify({ title, contentId })} WHERE changes() = 1`,
        ]);
        return changed(r[0]) ? Response.json({ ok: true }) : bad('Проект уже изменён. Обновите.', 409);
      }
      case 'asset.add': {
        // Manual work always works: notes, references, prompts or results imported from ChatGPT, images/videos made elsewhere.
        const kind = ['note', 'reference', 'image', 'video'].includes(x.kind as string) ? x.kind as string : null;
        const url = x.url ? httpsUrl(x.url) : '';
        const text = str(x.text, 10000);
        if (!isUuid(x.projectId) || !kind || url === null || (!url && !text) || ((kind === 'image' || kind === 'video') && !url)) return bad('Нужна ссылка https:// или текст');
        const id = isUuid(x.id) ? x.id : crypto.randomUUID();
        await db.batch([
          sql`INSERT INTO ai_assets (id, project_id, kind, url, text, source, job_id, expires_at, created_at, created_by)
            SELECT ${id}, ${x.projectId}, ${kind}, ${url}, ${text}, 'manual', NULL, NULL, ${now}, ${actor} WHERE EXISTS (SELECT 1 FROM ai_projects WHERE id = ${x.projectId}) ON CONFLICT(id) DO NOTHING`,
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${crypto.randomUUID()}, 'ai', ${x.projectId}, 'asset.add', ${actor}, ${now}, NULL, ${JSON.stringify({ kind, id })} WHERE changes() = 1`,
          sql`UPDATE ai_projects SET updated_at = ${now} WHERE id = ${x.projectId}`,
        ]);
        return Response.json({ id }, { status: 201 });
      }
      case 'asset.persist': {
        // Copies a linked file (provider result or any public https link) into private storage before the link expires.
        const b = bucket();
        if (!b) return bad('Хранилище не подключено', 503);
        if (!isUuid(x.id) && !/^[0-9a-f-]{36}:\d{1,2}$/i.test(String(x.id))) return bad('Неверный запрос');
        const [a] = await getDb().select().from(aiAssets).where(eq(aiAssets.id, x.id as string)).limit(1);
        if (!a) return bad('Материал не найден', 404);
        if (a.storageKey) return Response.json({ ok: true, already: true });
        if (!a.url || (a.kind !== 'image' && a.kind !== 'video' && a.kind !== 'reference')) return bad('У материала нет ссылки на файл');
        const stored = await fetchToBucket(b, a.id, a.url);
        if ('error' in stored) return bad(stored.error, 422);
        await persistRow(db, a.id, a.projectId, stored, actor, now);
        return Response.json({ ok: true });
      }
      case 'asset.approve': {
        // The approved image is required before an image-to-video launch.
        if (!isUuid(x.projectId) || !Number.isInteger(x.revision) || !(x.assetId === null || typeof x.assetId === 'string')) return bad('Неверный запрос');
        const assetId = x.assetId as string | null;
        const r = await db.batch([
          sql`UPDATE ai_projects SET approved_asset_id = ${assetId}, updated_at = ${now}, revision = revision + 1 WHERE id = ${x.projectId} AND revision = ${x.revision}
            AND (${assetId} IS NULL OR EXISTS (SELECT 1 FROM ai_assets WHERE id = ${assetId} AND project_id = ${x.projectId} AND kind = 'image'))`,
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${crypto.randomUUID()}, 'ai', ${x.projectId}, 'asset.approve', ${actor}, ${now}, NULL, ${JSON.stringify({ assetId })} WHERE changes() = 1`,
        ]);
        return changed(r[0]) ? Response.json({ ok: true }) : bad('Проект изменён или изображение не найдено. Обновите.', 409);
      }
      case 'job.submit': {
        if (!higgsfieldConfigured()) return bad('Higgsfield не подключён: на сервере нет ключа API', 409);
        if (x.confirm !== true) return bad('Подтвердите платный запуск');
        if (!isUuid(x.projectId) || !isUuid(x.idempotencyKey) || !validEndpoint(x.endpoint)) return bad('Неверный запрос');
        const [project] = await getDb().select().from(aiProjects).where(eq(aiProjects.id, x.projectId)).limit(1);
        if (!project) return bad('Проект не найден', 404);
        const [existing] = await getDb().select().from(aiGenerationJobs).where(eq(aiGenerationJobs.idempotencyKey, x.idempotencyKey)).limit(1);
        if (existing) return Response.json({ job: { ...existing, statusUrl: undefined }, duplicate: true });
        const preset = PRESETS.find(p => p.endpoint === x.endpoint);
        const kind = preset?.kind ?? (x.kind === 'video' ? 'video' : 'image');
        const params = (x.params && typeof x.params === 'object' ? x.params : {}) as Record<string, unknown>;
        if (kind === 'video') {
          const [img] = project.approvedAssetId ? await getDb().select().from(aiAssets).where(eq(aiAssets.id, project.approvedAssetId)).limit(1) : [];
          if (!img) return bad('Сначала утвердите изображение для видео', 409);
          if (!params.image_url) {
            if (img.url && !img.storageKey) params.image_url = img.url;
            else if (img.url && img.expiresAt && Date.parse(img.expiresAt) > Date.now() + 600_000) params.image_url = img.url;
            else if (img.storageKey && secret('FILE_LINK_SECRET')) {
              // The stored frame is private: the provider gets a signed link valid for one hour.
              const exp = Math.floor(Date.now() / 1000) + 3600;
              const sig = await signLink(secret('FILE_LINK_SECRET')!, img.id, exp);
              params.image_url = `${new URL(req.url).origin}/api/ai/files/signed?id=${encodeURIComponent(img.id)}&exp=${exp}&sig=${sig}`;
            } else if (img.url) params.image_url = img.url;
            else return bad('Кадр хранится только в закрытом хранилище. Для запуска видео задайте FILE_LINK_SECRET на сервере или добавьте публичную ссылку.', 409);
          }
        }
        const built = buildBody(x.endpoint, params);
        if (!built.ok) return bad(built.error);
        const { settings } = await aiSettings();
        const since = new Date(monthStart()).toISOString();
        const jobId = crypto.randomUUID();
        // Reserve the job first: the unique key blocks double launches, the count blocks launches above the monthly limit.
        const r = await db.batch([
          sql`INSERT INTO ai_generation_jobs (id, project_id, kind, endpoint, params, idempotency_key, status, request_id, status_url, result_url, error, cost, created_at, created_by, updated_at)
            SELECT ${jobId}, ${project.id}, ${kind}, ${x.endpoint}, ${JSON.stringify(built.body)}, ${x.idempotencyKey}, 'submitting', NULL, NULL, NULL, NULL, NULL, ${now}, ${actor}, ${now}
            WHERE (SELECT COUNT(*) FROM ai_generation_jobs WHERE created_at >= ${since} AND status != 'error') < ${settings.monthlyJobLimit}
            ON CONFLICT(idempotency_key) DO NOTHING`,
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${crypto.randomUUID()}, 'ai', ${project.id}, 'job.submit', ${actor}, ${now}, NULL, ${JSON.stringify({ jobId, endpoint: x.endpoint })} WHERE changes() = 1`,
        ]);
        if (!changed(r[0])) return bad(settings.monthlyJobLimit === 0 ? 'Лимит запусков не задан. Укажите его в настройках AI.' : 'Лимит запусков на месяц исчерпан', 409);
        const res = await submit(x.endpoint, built.body, x.idempotencyKey).catch(e => ({ status: 'error', resultUrls: [] as string[], error: (e as Error).message }));
        await saveUpdate(db, jobId, project.id, kind, res, actor, now);
        const [job] = await getDb().select().from(aiGenerationJobs).where(eq(aiGenerationJobs.id, jobId)).limit(1);
        return Response.json({ job: { ...job, statusUrl: undefined } }, { status: 201 });
      }
      case 'job.refresh': {
        if (!isUuid(x.id)) return bad('Неверный запрос');
        const [job] = await getDb().select().from(aiGenerationJobs).where(eq(aiGenerationJobs.id, x.id)).limit(1);
        if (!job) return bad('Запуск не найден', 404);
        if (TERMINAL.includes(job.status) || job.status === 'error' || !job.statusUrl) return Response.json({ job: { ...job, statusUrl: undefined } });
        if (!higgsfieldConfigured()) return bad('Higgsfield не подключён', 409);
        const res: JobUpdate = await poll(job.statusUrl).catch(e => ({ status: job.status, resultUrls: [] as string[], error: (e as Error).message }));
        await saveUpdate(db, job.id, job.projectId, job.kind, { ...res, statusUrl: res.statusUrl ?? job.statusUrl }, actor, now);
        const [saved] = await getDb().select().from(aiGenerationJobs).where(eq(aiGenerationJobs.id, job.id)).limit(1);
        return Response.json({ job: { ...saved, statusUrl: undefined } });
      }
      default: return bad('Неизвестное действие');
    }
  } catch { return bad('Не удалось сохранить. Ничего не изменено.', 503); }
}

/** Stores provider status; completed results become project assets (deterministic ids, so a repeated refresh adds nothing). */
async function saveUpdate(db: D1, jobId: string, projectId: string, kind: string, u: { status: string; requestId?: string; statusUrl?: string; resultUrls: string[]; expiresAt?: string; error?: string }, actor: string, now: string) {
  const sql = q(db);
  await db.batch([
    sql`UPDATE ai_generation_jobs SET status = ${u.status}, request_id = COALESCE(${u.requestId ?? null}, request_id), status_url = ${u.statusUrl ?? null},
      result_url = COALESCE(${u.resultUrls[0] ?? null}, result_url), error = ${u.error ?? null}, updated_at = ${now} WHERE id = ${jobId}`,
    ...(u.status === 'completed' ? u.resultUrls.map((url, i) => sql`INSERT INTO ai_assets (id, project_id, kind, url, text, source, job_id, expires_at, created_at, created_by)
      VALUES (${`${jobId}:${i}`}, ${projectId}, ${kind}, ${url}, '', 'higgsfield', ${jobId}, ${u.expiresAt ?? null}, ${now}, ${actor}) ON CONFLICT(id) DO NOTHING`) : []),
  ]);
  // Provider links expire: with storage connected, results are copied right away. A failure leaves the link and a "save" button.
  const b = bucket();
  if (b && u.status === 'completed') {
    for (let i = 0; i < u.resultUrls.length; i++) {
      const assetId = `${jobId}:${i}`;
      const stored = await fetchToBucket(b, assetId, u.resultUrls[i]).catch(e => ({ error: (e as Error).message }));
      if (!('error' in stored)) await persistRow(db, assetId, projectId, stored, actor, now).catch(() => {});
    }
  }
}

async function persistRow(db: D1, assetId: string, projectId: string, s: { storageKey: string; mime: string; size: number; fileName: string }, actor: string, now: string) {
  const sql = q(db);
  await db.batch([
    sql`UPDATE ai_assets SET storage_key = ${s.storageKey}, mime = ${s.mime}, size = ${s.size}, file_name = ${s.fileName} WHERE id = ${assetId} AND storage_key IS NULL`,
    sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${crypto.randomUUID()}, 'ai', ${projectId}, 'asset.persist', ${actor}, ${now}, NULL, ${JSON.stringify({ assetId, size: s.size, mime: s.mime })} WHERE changes() = 1`,
  ]);
}

function changed(r: unknown) { return ((r as { meta?: { changes?: number } }).meta?.changes ?? 0) === 1; }
