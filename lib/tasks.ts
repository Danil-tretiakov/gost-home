import { SHOOT_TEAM } from './shoot-team';

/** Internal task board. Assignee is a name only: it never grants access to the site. */
export const TASK_ASSIGNEES = ['Данил', ...SHOOT_TEAM.map(m => m[0])];
export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { todo: 'К выполнению', in_progress: 'В работе', done: 'Готово', cancelled: 'Отменено' };
/** One colour per status, used by the pills, the picker and the row marker. Tuned for the black theme: soft translucent fill, light ink. */
export const TASK_STATUS_COLORS: Record<TaskStatus, { fill: string; ink: string; dot: string }> = {
  todo: { fill: 'rgba(74,123,192,.22)', ink: '#9cc0f0', dot: '#5b93e0' },
  in_progress: { fill: 'rgba(224,162,27,.22)', ink: '#f0c466', dot: '#e8ad2c' },
  done: { fill: 'rgba(58,154,99,.24)', ink: '#7fd1a0', dot: '#45b374' },
  cancelled: { fill: 'rgba(192,90,90,.24)', ink: '#f09a9a', dot: '#d46a6a' },
};
export type TaskFolder = { id: string; name: string; sort: number; archivedAt: string | null; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; revision: number };
export const FOLDER_NAME_MAX = 60;
export const parseFolderName = (v: unknown) => { const n = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''; return n && n.length <= FOLDER_NAME_MAX ? n : null; };

export const TASK_PRIORITIES = ['high', 'normal', 'low'] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { high: 'Высокий', normal: 'Обычный', low: 'Низкий' };

export type Task = {
  id: string; title: string; notes: string; assignee: string | null; dueDate: string | null; dueTime: string | null;
  priority: TaskPriority; status: TaskStatus; shootId: string | null; contentId: string | null; folderId: string | null;
  completedAt: string | null; archivedAt: string | null; archivedBy: string | null;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; revision: number;
};
export type TaskFields = Pick<Task, 'title' | 'notes' | 'assignee' | 'dueDate' | 'dueTime' | 'priority' | 'status' | 'shootId' | 'contentId' | 'folderId'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().startsWith(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const optId = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'string' && UUID.test(v) ? v : undefined);

/** Validates task fields from the browser. Returns an error message for the first problem. */
export function parseTaskInput(x: Record<string, unknown>): { ok: true; fields: TaskFields } | { ok: false; error: string } {
  const title = typeof x.title === 'string' ? x.title.trim() : '';
  if (!title || title.length > 200) return { ok: false, error: 'Название задачи: от 1 до 200 символов' };
  const notes = typeof x.notes === 'string' ? x.notes : '';
  if (notes.length > 10000) return { ok: false, error: 'Заметки слишком длинные' };
  const assignee = x.assignee === null || x.assignee === undefined || x.assignee === '' ? null : x.assignee;
  if (assignee !== null && !TASK_ASSIGNEES.includes(assignee as string)) return { ok: false, error: 'Неизвестный ответственный' };
  const dueDate = x.dueDate === null || x.dueDate === undefined || x.dueDate === '' ? null : x.dueDate;
  if (dueDate !== null && !isDate(dueDate)) return { ok: false, error: 'Неверная дата срока' };
  const dueTime = x.dueTime === null || x.dueTime === undefined || x.dueTime === '' ? null : x.dueTime;
  if (dueTime !== null && (!isTime(dueTime) || dueDate === null)) return { ok: false, error: 'Время срока указывается вместе с датой (ЧЧ:ММ)' };
  const priority = (x.priority ?? 'normal') as TaskPriority;
  if (!TASK_PRIORITIES.includes(priority)) return { ok: false, error: 'Неверный приоритет' };
  const status = (x.status ?? 'todo') as TaskStatus;
  if (!TASK_STATUSES.includes(status)) return { ok: false, error: 'Неверный статус' };
  const shootId = optId(x.shootId), contentId = optId(x.contentId), folderId = optId(x.folderId);
  if (shootId === undefined || contentId === undefined) return { ok: false, error: 'Неверная связь со съёмкой или роликом' };
  if (folderId === undefined) return { ok: false, error: 'Неверная папка' };
  return { ok: true, fields: { title, notes, assignee: assignee as string | null, dueDate: dueDate as string | null, dueTime: dueTime as string | null, priority, status, shootId, contentId, folderId } };
}

export const bangkokNow = (now = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
const open = (t: Pick<Task, 'status' | 'archivedAt'>) => !t.archivedAt && (t.status === 'todo' || t.status === 'in_progress');
/** Overdue: open, with a due date (and time) before now in Bangkok. A date without time is due until the end of that day. */
export function isOverdue(t: Pick<Task, 'status' | 'archivedAt' | 'dueDate' | 'dueTime'>, now = new Date()) {
  if (!open(t) || !t.dueDate) return false;
  const b = bangkokNow(now);
  return t.dueDate < b.date || (t.dueDate === b.date && !!t.dueTime && t.dueTime < b.time);
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';
export type LinkFilter = 'all' | 'shoot' | 'content' | 'none';
export type TaskFilter = { assignee: string; status: string; due: DueFilter; link: LinkFilter; query: string; archived: boolean };

export function filterTasks<T extends Task>(list: T[], f: TaskFilter, now = new Date(), titles: (t: T) => string = () => ''): T[] {
  const today = bangkokNow(now).date, week = addDays(today, 7);
  const q = f.query.trim().toLocaleLowerCase('ru');
  return list.filter(t => {
    if (f.archived ? !t.archivedAt : !!t.archivedAt) return false;
    if (f.assignee === '—' ? t.assignee !== null : f.assignee && t.assignee !== f.assignee) return false;
    if (f.status === 'open' ? !(t.status === 'todo' || t.status === 'in_progress') : f.status && t.status !== f.status) return false;
    if (f.due === 'overdue' && !isOverdue(t, now)) return false;
    if (f.due === 'today' && t.dueDate !== today) return false;
    if (f.due === 'week' && !(t.dueDate && t.dueDate >= today && t.dueDate <= week)) return false;
    if (f.due === 'none' && t.dueDate) return false;
    if (f.link === 'shoot' && !t.shootId) return false;
    if (f.link === 'content' && !t.contentId) return false;
    if (f.link === 'none' && (t.shootId || t.contentId)) return false;
    if (q && ![t.title, t.notes, t.assignee ?? '', titles(t)].join(' ').toLocaleLowerCase('ru').includes(q)) return false;
    return true;
  });
}

const PRI: Record<string, number> = { high: 0, normal: 1, low: 2 };
/** Order inside a status group: overdue first, then by due date/time (none last), then priority, then newest. */
export function sortTasks<T extends Task>(list: T[], now = new Date()): T[] {
  return [...list].sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now))
    || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99')
    || PRI[a.priority] - PRI[b.priority] || b.createdAt.localeCompare(a.createdAt));
}

/** Urgent for the home page: open and overdue, due within 2 days, or high priority. */
export function urgentTasks<T extends Task>(list: T[], now = new Date(), limit = 6): T[] {
  const soon = addDays(bangkokNow(now).date, 2);
  return sortTasks(list.filter(t => open(t) && (isOverdue(t, now) || (t.dueDate && t.dueDate <= soon) || t.priority === 'high')), now).slice(0, limit);
}
