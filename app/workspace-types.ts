import type { ContentStatus, ContentType } from '../lib/content-status';

export type Shoot = {
  id?: string; revision?: number; title: string; date: string; time: string; duration: number; format: string; status: string;
  project: string; location: string; participants: string[]; notes: string; preparation: string;
};

export type ContentItem = {
  id: string; revision: number; type: ContentType; title: string; description: string; primaryMember: string; participants: string[];
  shootId: string | null; places: string[]; plannedPublishDate: string | null; publishedAt: string | null; productionStatus: ContentStatus;
  driveUrl: string; responsible: string | null; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  /** Set only while awaiting_feedback: 'author' once the reviewer asked for changes on the newest version, 'reviewer' once it's waiting on a decision. Absent elsewhere. */
  reviewTurn?: 'author' | 'reviewer' | null;
};

export type ContentDraft = Omit<ContentItem, 'revision' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'publishedAt'> & {
  revision?: number; publishedAt?: string | null;
};

export const bangkokToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function newContentDraft(partial: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: crypto.randomUUID(), type: 'reel', title: '', description: '', primaryMember: 'Юля', participants: [], shootId: null, places: [],
    plannedPublishDate: null, productionStatus: 'planned', driveUrl: '', responsible: null, ...partial,
  };
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: 'no-store',
  });
  let data: unknown = null;
  try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) throw new Error((data as { error?: string } | null)?.error || 'Сервер недоступно. Повторите попытку.');
  return data as T;
}

export const dayLabel = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('ru', { day: 'numeric', month: 'short', weekday: 'short' });
export const monthLabel = (month: string) => new Date(month + '-01T12:00:00').toLocaleDateString('ru', { month: 'long', year: 'numeric' }).replace(' г.', '');
export const shiftMonth = (month: string, by: number) => { const d = new Date(month + '-01T12:00:00'); d.setMonth(d.getMonth() + by); return d.toISOString().slice(0, 7); };

/** Server-side access of the current visitor, passed from the page. Flags only hide UI; every API checks again. */
export type ClientAccess = {
  email: string | null; name: string | null; role: 'owner' | 'admin' | 'reviewer' | 'viewer' | null; roleLabel: string | null; memberName: string | null;
  caps: { internal: boolean; edit: boolean; review: boolean; admin: boolean; finance: boolean };
  /** Where «Войти» leads: Sites sign-in, or the own password page on Cloudflare. */
  signInHref: string; canSignOut: boolean;
};
