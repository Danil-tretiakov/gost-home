import { bangkokNow, isOverdue, type Task } from './tasks';
import type { Caps } from './rbac';

/**
 * In-app notifications, computed from live data on every request (nothing is sent anywhere, no browser permission).
 * Keys are stable per event, so a read mark survives refreshes and a NEW event (another due date, a new round) shows again.
 */
export type Note = { key: string; level: 'urgent' | 'warn' | 'info'; title: string; detail: string; target: { type: 'task' | 'content' | 'ai' | 'settings' | 'shoot'; id?: string }; mine: boolean };

type ContentRow = { id: string; title: string; productionStatus: string; reviewTurn?: 'author' | 'reviewer' | null; plannedPublishDate: string | null; responsible: string | null; primaryMember: string; updatedAt: string };
type JobRow = { id: string; projectId: string; status: string; error: string | null; updatedAt: string };
type AssetRow = { id: string; projectId: string; expiresAt: string | null; storageKey: string | null; url: string };
type ShootRow = { id: string; title: string; date: string; time: string; status: string; participants: string[] };
type IgRow = { status: string; tokenExpiresAt: string | null; lastError: string | null } | null;

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export function buildNotifications(input: {
  caps: Caps; memberName: string | null; tasks: Task[]; content: ContentRow[]; jobs: JobRow[]; assets: AssetRow[]; shoots: ShootRow[]; instagram: IgRow; now?: Date;
}): Note[] {
  const { caps, memberName } = input;
  const now = input.now ?? new Date();
  const today = bangkokNow(now).date, tomorrow = addDays(today, 1);
  const out: Note[] = [];
  if (!caps.internal) return out;
  const mine = (who: string | null) => !!memberName && who === memberName;

  for (const t of input.tasks) {
    if (t.archivedAt || !(t.status === 'todo' || t.status === 'in_progress') || !t.dueDate) continue;
    const when = `${day(t.dueDate)}${t.dueTime ? ' ' + t.dueTime : ''}`;
    if (isOverdue(t, now)) out.push({ key: `task-overdue:${t.id}:${t.dueDate}${t.dueTime ?? ''}`, level: 'urgent', title: `Просрочена задача: ${t.title}`, detail: `Срок ${when}`, target: { type: 'task', id: t.id }, mine: mine(t.assignee) });
    else if (t.dueDate === today || t.dueDate === tomorrow) out.push({ key: `task-due:${t.id}:${t.dueDate}${t.dueTime ?? ''}`, level: 'warn', title: `${t.dueDate === today ? 'Сегодня' : 'Завтра'} срок: ${t.title}`, detail: when, target: { type: 'task', id: t.id }, mine: mine(t.assignee) });
  }
  for (const c of input.content) {
    if (c.productionStatus === 'awaiting_feedback' && c.reviewTurn !== 'author' && caps.review)
      out.push({ key: `content-awaiting:${c.id}:${c.updatedAt}`, level: 'warn', title: `Ждёт согласования: ${c.title}`, detail: c.plannedPublishDate ? `Публикация ${day(c.plannedPublishDate)}` : 'Без даты публикации', target: { type: 'content', id: c.id }, mine: memberName === 'Андрей' });
    if (c.productionStatus === 'awaiting_feedback' && c.reviewTurn === 'author' && caps.edit)
      out.push({ key: `content-changes:${c.id}:${c.updatedAt}`, level: 'warn', title: `Нужны правки: ${c.title}`, detail: 'Добавьте новую версию монтажа после правок', target: { type: 'content', id: c.id }, mine: mine(c.responsible) });
    if (caps.edit && c.plannedPublishDate && c.plannedPublishDate < today && !['published', 'cancelled', 'paused'].includes(c.productionStatus))
      out.push({ key: `content-late:${c.id}:${c.plannedPublishDate}`, level: 'urgent', title: `Дата публикации прошла: ${c.title}`, detail: `План ${day(c.plannedPublishDate)}. Отметьте публикацию с фактической датой или перенесите.`, target: { type: 'content', id: c.id }, mine: mine(c.responsible) });
  }
  for (const s of input.shoots) {
    if (s.status !== 'Запланировано' || (s.date !== today && s.date !== tomorrow)) continue;
    out.push({ key: `shoot-soon:${s.id}:${s.date}${s.time}`, level: 'info', title: `${s.date === today ? 'Сегодня' : 'Завтра'} съёмка: ${s.title}`, detail: `${s.time} · ${s.participants.join(', ')}`, target: { type: 'shoot', id: s.id }, mine: !!memberName && s.participants.includes(memberName) });
  }
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  for (const j of input.jobs) {
    if (j.updatedAt < weekAgo) continue;
    if (j.status === 'completed') out.push({ key: `ai-done:${j.id}`, level: 'info', title: 'Готов результат Higgsfield', detail: 'Откройте AI-проект, чтобы посмотреть и утвердить', target: { type: 'ai', id: j.projectId }, mine: false });
    if (['failed', 'nsfw', 'error'].includes(j.status)) out.push({ key: `ai-failed:${j.id}`, level: 'warn', title: 'Запуск Higgsfield не удался', detail: (j.error ?? j.status).slice(0, 160), target: { type: 'ai', id: j.projectId }, mine: false });
  }
  const soon = new Date(now.getTime() + 48 * 3_600_000).toISOString();
  for (const a of input.assets) {
    if (a.storageKey || !a.url || !a.expiresAt || a.expiresAt > soon || a.expiresAt < now.toISOString()) continue;
    out.push({ key: `ai-expiring:${a.id}`, level: 'warn', title: 'Ссылка на результат AI скоро истечёт', detail: 'Сохраните файл в хранилище или на Диск', target: { type: 'ai', id: a.projectId }, mine: false });
  }
  const ig = input.instagram;
  if (caps.admin && ig?.status === 'connected' && ig.tokenExpiresAt) {
    const days = Math.floor((Date.parse(ig.tokenExpiresAt) - now.getTime()) / 86_400_000);
    if (days <= 14) out.push({ key: `ig-token:${ig.tokenExpiresAt}`, level: days <= 3 ? 'urgent' : 'warn', title: days < 0 ? 'Доступ Instagram истёк' : `Доступ Instagram истекает через ${days} дн.`, detail: 'Переподключите Instagram в настройках', target: { type: 'settings' }, mine: false });
  }
  if (caps.admin && ig?.lastError) out.push({ key: `ig-error:${ig.lastError.slice(0, 60)}`, level: 'warn', title: 'Ошибка синхронизации Instagram', detail: ig.lastError.slice(0, 160), target: { type: 'settings' }, mine: false });
  const rank = { urgent: 0, warn: 1, info: 2 };
  return out.sort((a, b) => Number(b.mine) - Number(a.mine) || rank[a.level] - rank[b.level]);
}
