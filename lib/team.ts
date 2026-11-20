import { SHOOT_TEAM } from './shoot-team';
import { normEmail, ROLES, validEmail, type Role } from './rbac';

/** Team access entries. Pure validation, no runtime imports. */
export const MEMBER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type MemberStatus = typeof MEMBER_STATUSES[number];
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = { invited: 'Подготовлено, доступ не выдан', active: 'Доступ действует', disabled: 'Отключён' };
export const MEMBER_NAMES = SHOOT_TEAM.map(m => m[0]);

export type TeamFields = { displayName: string; email: string | null; memberName: string | null; role: Role; finance: boolean; note: string };

/** Validates a prepared invitation or assignment. An email is optional: without it nobody can use the entry. */
export function parseTeamInput(x: Record<string, unknown>, ownerEmail: string): { ok: true; fields: TeamFields } | { ok: false; error: string } {
  const displayName = typeof x.displayName === 'string' ? x.displayName.trim() : '';
  if (!displayName || displayName.length > 100) return { ok: false, error: 'Укажите имя до 100 символов' };
  const rawEmail = typeof x.email === 'string' ? x.email.trim() : '';
  if (rawEmail && !validEmail(rawEmail)) return { ok: false, error: 'Проверьте адрес почты' };
  const email = normEmail(rawEmail);
  if (email && email === normEmail(ownerEmail)) return { ok: false, error: 'Это адрес владельца: его доступ постоянный и не настраивается здесь' };
  const memberName = x.memberName === null || x.memberName === undefined || x.memberName === '' ? null : x.memberName;
  if (memberName !== null && !MEMBER_NAMES.includes(memberName as string)) return { ok: false, error: 'Неизвестный участник команды' };
  if (!(ROLES as readonly string[]).includes(x.role as string)) return { ok: false, error: 'Выберите роль' };
  if (x.finance !== undefined && typeof x.finance !== 'boolean') return { ok: false, error: 'Неверный запрос' };
  const note = typeof x.note === 'string' ? x.note.trim().slice(0, 1000) : '';
  return { ok: true, fields: { displayName, email, memberName: memberName as string | null, role: x.role as Role, finance: x.finance === true, note } };
}
