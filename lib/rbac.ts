/**
 * Role-based access. Pure part (no runtime imports) so it can be tested directly.
 * The owner (OWNER_EMAIL in app/permissions.ts) is always admin with finance and cannot be demoted or locked out.
 * Other people get a role only through an ACTIVE team_members row whose email equals the email Sites signed them in with.
 */
export const ROLES = ['admin', 'reviewer', 'viewer'] as const;
export type Role = typeof ROLES[number];
export const ROLE_LABELS: Record<Role | 'owner', string> = {
  owner: 'Владелец', admin: 'Администратор / контент-менеджер', reviewer: 'Руководитель (согласование)', viewer: 'Наблюдатель',
};
export const ROLE_HINTS: Record<Role, string> = {
  admin: 'Полное редактирование: съёмки, ролики, задачи, AI, настройки и команда.',
  reviewer: 'Видит внутренние данные, комментирует, согласует или возвращает на доработку. Не редактирует.',
  viewer: 'Только просмотр внутренних данных (ссылки на монтаж, задачи, AI). Ничего не меняет.',
};

export type Caps = {
  /** Read internal data: edit links, versions, history, tasks, AI projects, notifications. */
  internal: boolean;
  /** Create and change shoots, content, tasks, AI, plan settings. */
  edit: boolean;
  /** Comment and decide on items waiting for feedback. */
  review: boolean;
  /** Manage team access, integrations, backup restore. */
  admin: boolean;
  /** See pay accounting; recording it also needs the admin or reviewer role. Separate permission. */
  finance: boolean;
};
export type Access = { email: string | null; name: string | null; role: Role | 'owner' | null; memberName: string | null; caps: Caps };
export const NO_CAPS: Caps = { internal: false, edit: false, review: false, admin: false, finance: false };

export type MemberRow = { email: string | null; displayName: string; memberName: string | null; role: string; finance: number; status: string };

export function capsFor(role: Role | 'owner' | null, finance: boolean): Caps {
  switch (role) {
    case 'owner': return { internal: true, edit: true, review: true, admin: true, finance: true };
    case 'admin': return { internal: true, edit: true, review: true, admin: true, finance };
    case 'reviewer': return { internal: true, edit: false, review: true, admin: false, finance };
    case 'viewer': return { internal: true, edit: false, review: false, admin: false, finance };
    default: return NO_CAPS;
  }
}

export const normEmail = (e: string | null | undefined) => (typeof e === 'string' && e.trim() ? e.trim().toLowerCase() : null);
export const validEmail = (e: unknown): e is string => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Resolves access for a signed-in identity. Only an ACTIVE row with exactly this email grants anything. */
export function resolveAccess(user: { email: string; displayName: string } | null, ownerEmail: string, member: MemberRow | null): Access {
  if (!user) return { email: null, name: null, role: null, memberName: null, caps: NO_CAPS };
  const email = normEmail(user.email)!;
  if (email === normEmail(ownerEmail)) return { email, name: user.displayName, role: 'owner', memberName: 'Данил', caps: capsFor('owner', true) };
  if (!member || member.status !== 'active' || normEmail(member.email) !== email || !(ROLES as readonly string[]).includes(member.role)) {
    return { email, name: user.displayName, role: null, memberName: null, caps: NO_CAPS };
  }
  const role = member.role as Role;
  return { email, name: member.displayName || user.displayName, role, memberName: member.memberName, caps: capsFor(role, member.finance === 1) };
}

/** Status transitions a reviewer (not an editor) may perform: approving an item waiting for feedback. Requesting changes no longer moves the status — see lib/review-turn.ts. */
export const REVIEW_TRANSITIONS: [string, string][] = [['awaiting_feedback', 'approved']];
export const canReviewTransition = (from: string, to: string) => REVIEW_TRANSITIONS.some(([f, t]) => f === from && t === to);
