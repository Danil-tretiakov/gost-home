import { SHOOT_TEAM } from './shoot-team';
import { CONTENT_TYPES, isContentStatus, type ContentStatus, type ContentType } from './content-status';

export type ContentInput = {
  id: string;
  revision?: number;
  type: ContentType;
  title: string;
  description: string;
  primaryMember: string;
  participants: string[];
  shootId: string | null;
  places: string[];
  plannedPublishDate: string | null;
  driveUrl: string;
  /** Who drives production. undefined = keep the stored value (older clients). */
  responsible?: string | null;
  productionStatus?: ContentStatus;
};
/** People who can be responsible for an item: Данил plus the team. Assignment only, never an access grant. */
export const RESPONSIBLE_NAMES = ['Данил', ...SHOOT_TEAM.map(m => m[0])];

const NAMES = SHOOT_TEAM.map(m => m[0]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function isDriveUrl(v: string) {
  if (!v) return true;
  try { const u = new URL(v); return u.protocol === 'https:' && v.length <= 1000; } catch { return false; }
}

/** Validates and normalises a create/update payload. Returns an error message in Russian or the clean value. */
export function parseContentInput(x: unknown): { ok: true; value: ContentInput } | { ok: false; error: string } {
  if (!x || typeof x !== 'object') return { ok: false, error: 'Пустой запрос' };
  const v = x as Record<string, unknown>;
  if (!isUuid(v.id)) return { ok: false, error: 'Нет идентификатора ролика' };
  if (v.revision !== undefined && !(Number.isInteger(v.revision) && (v.revision as number) > 0)) return { ok: false, error: 'Неверная версия записи' };
  if (!(CONTENT_TYPES as readonly string[]).includes(v.type as string)) return { ok: false, error: 'Выберите тип: Reels или YouTube' };
  const title = typeof v.title === 'string' ? v.title.trim() : '';
  if (!title || title.length > 200) return { ok: false, error: 'Укажите название до 200 символов' };
  if (typeof v.description !== 'string' || v.description.length > 10000) return { ok: false, error: 'Описание слишком длинное' };
  if (!NAMES.includes(v.primaryMember as string)) return { ok: false, error: 'Выберите основного ведущего' };
  if (!Array.isArray(v.participants) || !v.participants.every(p => NAMES.includes(p))) return { ok: false, error: 'Проверьте участников' };
  if (v.shootId !== null && !isUuid(v.shootId)) return { ok: false, error: 'Неверная съёмка' };
  if (!Array.isArray(v.places) || !v.places.every(p => typeof p === 'string' && p.length <= 200) || v.places.length > 20) return { ok: false, error: 'Проверьте объекты и локации' };
  if (v.plannedPublishDate !== null && !isIsoDate(v.plannedPublishDate)) return { ok: false, error: 'Неверная дата публикации' };
  const driveUrl = typeof v.driveUrl === 'string' ? v.driveUrl.trim() : '';
  if (!isDriveUrl(driveUrl)) return { ok: false, error: 'Ссылка должна начинаться с https://' };
  if (v.responsible !== undefined && v.responsible !== null && v.responsible !== '' && !RESPONSIBLE_NAMES.includes(v.responsible as string)) return { ok: false, error: 'Неизвестный ответственный' };
  if (v.productionStatus !== undefined && !isContentStatus(v.productionStatus)) return { ok: false, error: 'Неверный статус' };
  const primary = v.primaryMember as string;
  const participants = [...new Set((v.participants as string[]).filter(p => p !== primary))];
  const places = [...new Set((v.places as string[]).map(p => p.trim()).filter(Boolean))];
  return { ok: true, value: {
    id: v.id as string, revision: v.revision as number | undefined, type: v.type as ContentType, title, description: v.description as string,
    primaryMember: primary, participants, shootId: (v.shootId as string | null), places, plannedPublishDate: v.plannedPublishDate as string | null,
    driveUrl, productionStatus: v.productionStatus as ContentStatus | undefined,
    responsible: v.responsible === undefined ? undefined : (v.responsible || null) as string | null,
  } };
}
