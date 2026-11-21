'use client';
import { useEffect, useMemo, useState } from 'react';
import { Archive, CalendarDays, ChevronDown, Clapperboard, Clock, CornerDownLeft, Film, Flag, Folder, FolderOpen, ListTodo, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { TASK_STATUSES, TASK_STATUS_COLORS, TASK_STATUS_LABELS, bangkokNow, filterTasks, isOverdue, sortTasks, urgentTasks, type Task, type TaskFilter, type TaskFolder, type TaskStatus } from '../lib/tasks';
import { addDays, parseQuickTask, type QuickToken } from '../lib/tasks-parse';
import { api, type ContentItem, type Shoot } from './workspace-types';

export type TaskDraft = Omit<Task, 'revision' | 'completedAt' | 'archivedAt' | 'archivedBy' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & Partial<Task>;
export const newTaskDraft = (p: Partial<TaskDraft> = {}): TaskDraft => ({
  id: crypto.randomUUID(), title: '', notes: '', assignee: null, dueDate: null, dueTime: null, priority: 'normal', status: 'todo', shootId: null, contentId: null, folderId: null, ...p,
});
const weekdayDate = (d: string) => new Date(d + 'T12:00').toLocaleDateString('ru', { weekday: 'short', day: 'numeric', month: 'short' });

/** Saves through the API. On 409 the current server copy is returned so the editor can show it. */
async function saveTask(t: TaskDraft, action: 'create' | 'update' | 'archive' | 'restore'): Promise<Task> {
  return api<Task>('/api/tasks', { method: 'POST', json: { ...t, action } });
}

/** Human date for a task: «Сегодня», «Завтра», «пт, 21 нояб.». */
function dueLabel(t: Pick<Task, 'dueDate' | 'dueTime'>, today: string) {
  if (!t.dueDate) return '';
  const d = t.dueDate === today ? 'Сегодня' : t.dueDate === addDays(today, 1) ? 'Завтра' : t.dueDate === addDays(today, -1) ? 'Вчера' : weekdayDate(t.dueDate);
  return d + (t.dueTime ? ' ' + t.dueTime : '');
}

/** Coloured status label. With onPick it opens a small menu of all statuses, each in its own colour. */
export function StatusPill({ status, onPick }: { status: TaskStatus; onPick?: (s: TaskStatus) => void }) {
  const [open, setOpen] = useState(false);
  const c = TASK_STATUS_COLORS[status];
  const pill = <span className="status-pill" style={{ background: c.fill, color: c.ink }}><i style={{ background: c.dot }} />{TASK_STATUS_LABELS[status]}</span>;
  if (!onPick) return pill;
  return <span className="status-menu-wrap" onClick={e => e.stopPropagation()}>
    <button type="button" className="status-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 120)}>{pill}</button>
    {open && <ul className="status-menu" role="listbox">{TASK_STATUSES.map(st => <li key={st}><button type="button" role="option" aria-selected={st === status} onMouseDown={e => e.preventDefault()}
      onClick={() => { setOpen(false); if (st !== status) onPick(st); }}><span className="status-pill" style={{ background: TASK_STATUS_COLORS[st].fill, color: TASK_STATUS_COLORS[st].ink }}><i style={{ background: TASK_STATUS_COLORS[st].dot }} />{TASK_STATUS_LABELS[st]}</span></button></li>)}</ul>}
  </span>;
}

/** One task line: round checkbox, title, then status, date and flag as quiet chips. */
export function TaskRow({ t, links, onOpen, onStatus, draggable }: { t: Task; links: { shoot?: string; content?: string }; onOpen: () => void; onStatus?: (s: TaskStatus) => void; draggable?: boolean }) {
  const today = bangkokNow().date;
  const done = t.status === 'done' || t.status === 'cancelled';
  const overdue = isOverdue(t);
  return <li className={'task-row s-' + t.status + (t.archivedAt ? ' archived' : '') + (t.priority === 'high' ? ' p-high' : '')} draggable={draggable}
    onDragStart={draggable ? e => { e.dataTransfer.setData('text/task', t.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}>
    {onStatus && !t.archivedAt
      ? <button type="button" className={'tick ' + (done ? 'on' : '')} aria-label={t.status === 'done' ? 'Вернуть в работу' : 'Отметить выполненной'} aria-pressed={t.status === 'done'}
        disabled={t.status === 'cancelled'} onClick={() => onStatus(t.status === 'done' ? 'todo' : 'done')}><svg viewBox="0 0 16 16" aria-hidden><path d="M4 8.5l2.5 2.5L12 5.5" /></svg></button>
      : <span className={'tick static ' + (done ? 'on' : '')} aria-hidden><svg viewBox="0 0 16 16"><path d="M4 8.5l2.5 2.5L12 5.5" /></svg></span>}
    <button type="button" className="task-main" onClick={onOpen}>
      <span className="task-title">{t.title}</span>
      <span className="task-meta">
        {t.dueDate && <span className={'tchip ' + (overdue ? 'overdue' : t.dueDate === today ? 'today' : '')}><CalendarDays size={12} />{dueLabel(t, today)}</span>}
        {t.priority === 'high' && <span className="tchip flag" title="Важно"><Flag size={12} />Важно</span>}
        {links.shoot && <span className="tchip"><Clapperboard size={12} />{links.shoot}</span>}
        {links.content && <span className="tchip"><Film size={12} />{links.content}</span>}
      </span>
    </button>
    <StatusPill status={t.status} onPick={onStatus && !t.archivedAt ? onStatus : undefined} />
  </li>;
}

const EMPTY: TaskFilter = { assignee: '', status: '', due: 'all', link: 'all', query: '', archived: false };
const KIND_ICON = { date: <CalendarDays size={12} />, time: <Clock size={12} />, priority: <Flag size={12} /> };

type View = 'all' | 'none' | string; // 'all', 'none' (no folder) or a folder id
const GROUPS: [TaskStatus, string][] = [['todo', 'К выполнению'], ['in_progress', 'В работе']];

/** Задачник: folders on the left like pages in Notes, tasks grouped by colour-coded status on the right. A short «Ключевое» strip on top. */
export function TaskBoard({ tasks, folders, shoots, items, onOpen, onSaved, onFolderSaved, readOnly = false }: {
  tasks: Task[]; folders: TaskFolder[]; shoots: Shoot[]; items: ContentItem[]; onOpen: (t: TaskDraft) => void; onSaved: (t: Task) => void; onFolderSaved: (f: TaskFolder) => void; readOnly?: boolean;
}) {
  const [f, setF] = useState<TaskFilter>(EMPTY);
  const [view, setView] = useState<View>('all');
  const [text, setText] = useState('');
  const [skip, setSkip] = useState<Set<QuickToken['kind']>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [overFolder, setOverFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const today = bangkokNow().date;
  const live = useMemo(() => folders.filter(x => !x.archivedAt).sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt)), [folders]);
  const liveIds = useMemo(() => new Set(live.map(x => x.id)), [live]);
  const folderOf = (t: Task) => (t.folderId && liveIds.has(t.folderId) ? t.folderId : null); // a task in an archived folder shows as «Без папки»
  const current = view !== 'all' && view !== 'none' && !liveIds.has(view) ? 'all' : view;
  const parsed = useMemo(() => parseQuickTask(text, today, skip), [text, today, skip]);
  const shootTitle = (id: string | null) => (id ? shoots.find(s => s.id === id)?.title : undefined);
  const contentTitle = (id: string | null) => (id ? items.find(i => i.id === id)?.title : undefined);
  const matched = useMemo(() => filterTasks(tasks, f, new Date(), t => `${shootTitle(t.shootId) ?? ''} ${contentTitle(t.contentId) ?? ''}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, f, shoots, items]);
  const inView = (t: Task) => current === 'all' || (current === 'none' ? folderOf(t) === null : folderOf(t) === current);
  const shown = sortTasks(matched.filter(inView));
  const isOpen = (t: Task) => t.status === 'todo' || t.status === 'in_progress';
  const closed = shown.filter(t => !isOpen(t)).sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  const count = (pred: (t: Task) => boolean) => tasks.filter(t => !t.archivedAt && isOpen(t) && pred(t)).length;
  const key = useMemo(() => urgentTasks(tasks.filter(t => !t.archivedAt), new Date(), 4), [tasks]);
  const archivedCount = tasks.filter(t => t.archivedAt).length;
  const currentFolder = live.find(x => x.id === current);

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault(); if (!parsed.title) return;
    setBusy(true); setError('');
    try {
      onSaved(await saveTask(newTaskDraft({ title: parsed.title.slice(0, 200), dueDate: parsed.dueDate, dueTime: parsed.dueTime, priority: parsed.priority, folderId: currentFolder?.id ?? null }), 'create'));
      setText(''); setSkip(new Set());
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function update(t: Task, patch: Partial<Task>) {
    setError('');
    try { onSaved(await saveTask({ ...t, ...patch }, 'update')); } catch (err) { setError((err as Error).message); }
  }
  async function folderAction(body: Record<string, unknown>) {
    setError('');
    try { const saved = await api<TaskFolder>('/api/tasks/folders', { method: 'POST', json: body }); onFolderSaved(saved); return saved; }
    catch (err) { setError((err as Error).message); return null; }
  }
  async function createFolder(e: React.FormEvent) {
    e.preventDefault(); const name = (newFolder ?? '').trim(); if (!name) { setNewFolder(null); return; }
    const saved = await folderAction({ action: 'create', id: crypto.randomUUID(), name });
    if (saved) { setNewFolder(null); setView(saved.id); }
  }
  async function renameFolder(e: React.FormEvent) {
    e.preventDefault(); if (!currentFolder) return; const name = (rename ?? '').trim();
    if (name && name !== currentFolder.name) await folderAction({ action: 'rename', id: currentFolder.id, name, revision: currentFolder.revision });
    setRename(null);
  }
  async function archiveFolder() {
    if (!currentFolder) return;
    if (!window.confirm(`Убрать папку «${currentFolder.name}»? Задачи не удалятся: они будут в «Без папки».`)) return;
    if (await folderAction({ action: 'archive', id: currentFolder.id, revision: currentFolder.revision })) setView('all');
  }
  const dropOnFolder = (target: string | null) => (e: React.DragEvent) => {
    e.preventDefault(); setOverFolder(null);
    const t = tasks.find(x => x.id === e.dataTransfer.getData('text/task'));
    if (t && !t.archivedAt && folderOf(t) !== target) update(t, { folderId: target });
  };
  const row = (t: Task) => <TaskRow key={t.id} t={t} links={{}} onOpen={() => onOpen({ ...t })} draggable={!readOnly && !t.archivedAt}
    onStatus={readOnly ? undefined : st => update(t, { status: st })} />;
  const folderBtn = (id: View, label: string, n: number, icon: React.ReactNode, dropTarget?: string | null) => <li key={id}>
    <button type="button" className={'folder-item ' + (current === id ? 'on' : '') + (overFolder === id ? ' over' : '')} aria-current={current === id ? 'page' : undefined} onClick={() => setView(id)}
      onDragOver={!readOnly && dropTarget !== undefined ? e => { e.preventDefault(); setOverFolder(id); } : undefined} onDragLeave={() => setOverFolder(null)}
      onDrop={!readOnly && dropTarget !== undefined ? dropOnFolder(dropTarget) : undefined}>{icon}<span className="fname">{label}</span>{n > 0 && <em>{n}</em>}</button></li>;

  return <div className="planner-layout">
    <div className="folder-pane" role="navigation" aria-label="Папки">
      <ul className="folder-list">
        {folderBtn('all', 'Все задачи', count(() => true), <ListTodo size={15} />)}
        {folderBtn('none', 'Без папки', count(t => folderOf(t) === null), <FolderOpen size={15} />, null)}
        {live.map(x => folderBtn(x.id, x.name, count(t => folderOf(t) === x.id), <Folder size={15} />, x.id))}
      </ul>
      {!readOnly && (newFolder === null
        ? <button type="button" className="folder-add" onClick={() => setNewFolder('')}><Plus size={14} /> Папка</button>
        : <form className="folder-new" onSubmit={createFolder}><input autoFocus maxLength={60} placeholder="Название папки" aria-label="Название папки" value={newFolder} onChange={e => setNewFolder(e.target.value)} onBlur={() => { if (!newFolder.trim()) setNewFolder(null); }} /></form>)}
    </div>

    <div className="planner-page">
      {key.length > 0 && <section className="key-strip" aria-label="Ключевое"><h3>Ключевое сейчас</h3>
        <ul className="task-list compact">{key.map(t => <TaskRow key={t.id} t={t} links={{}} onOpen={() => onOpen({ ...t })} onStatus={readOnly ? undefined : st => update(t, { status: st })} />)}</ul></section>}

      <div className="folder-title">{rename !== null && currentFolder
        ? <form onSubmit={renameFolder}><input autoFocus maxLength={60} aria-label="Новое название папки" value={rename} onChange={e => setRename(e.target.value)} onBlur={renameFolder} /></form>
        : <h2>{current === 'all' ? 'Все задачи' : current === 'none' ? 'Без папки' : currentFolder?.name}</h2>}
        {currentFolder && !readOnly && rename === null && <span className="folder-tools">
          <button type="button" className="icon-btn" aria-label="Переименовать папку" title="Переименовать" onClick={() => setRename(currentFolder.name)}><Pencil size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Убрать папку" title="Убрать папку" onClick={archiveFolder}><Trash2 size={14} /></button></span>}</div>

      {!readOnly && <form className="quick-add" onSubmit={quickAdd}>
        <div className="quick-line"><span className="quick-plus" aria-hidden>+</span>
          <input aria-label="Новая задача" placeholder={`Новая задача${currentFolder ? ' в «' + currentFolder.name + '»' : ''}… например: «Смонтировать ролик завтра в 15:00 !»`} maxLength={240} value={text} onChange={e => setText(e.target.value)} />
          {text.trim() && <button className="primary small" disabled={busy || !parsed.title}><CornerDownLeft size={14} /> Добавить</button>}</div>
        {text.trim() && <div className="quick-preview">
          {parsed.dueDate && <span className="tchip today">{KIND_ICON.date}{dueLabel(parsed, today)}</span>}
          {parsed.priority === 'high' && <span className="tchip flag">{KIND_ICON.priority}Важно</span>}
          {parsed.tokens.map(tk => <button type="button" key={tk.kind} className="tchip ghost" title="Не распознавать: оставить слова в названии" onClick={() => setSkip(new Set([...skip, tk.kind]))}>«{tk.text}» <X size={11} /></button>)}
          {!parsed.tokens.length && <span className="quick-hint">Срок можно написать словами: сегодня, завтра, в пятницу, 25.11, через 3 дня, в 15:00. «!» или «срочно» = важно.</span>}
          <button type="button" className="link-button" onClick={() => onOpen(newTaskDraft({ title: parsed.title, dueDate: parsed.dueDate, dueTime: parsed.dueTime, priority: parsed.priority, folderId: currentFolder?.id ?? null }))}>Подробнее…</button>
        </div>}
      </form>}

      <div className="planner-bar">
        <label className="search-box"><Search size={14} aria-hidden /><input aria-label="Поиск задач" placeholder="Поиск" value={f.query} onChange={e => setF({ ...f, query: e.target.value })} /></label>
        <button type="button" className={'ghost-btn ' + (f.archived ? 'on' : '')} onClick={() => setF({ ...f, archived: !f.archived })}><Archive size={14} />{f.archived ? 'К плану' : `Архив${archivedCount ? ' · ' + archivedCount : ''}`}</button>
        {readOnly && <span className="hint">Только просмотр</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}

      {f.archived ? <section className="tsection"><h3>Архив <span>{shown.length}</span></h3>
        {shown.length ? <ul className="task-list">{shown.map(t => <TaskRow key={t.id} t={t} links={{}} onOpen={() => onOpen({ ...t })} />)}</ul> : <p className="empty-line">Архив пуст.</p>}</section>
        : <>
          {!shown.length && !closed.length && <p className="empty-line big">{tasks.some(t => !t.archivedAt) ? 'В этой папке пока пусто. Напишите задачу строкой выше.' : 'Задач пока нет. Напишите первую строкой выше и нажмите Enter.'}</p>}
          {GROUPS.map(([st, label]) => {
            const list = shown.filter(t => t.status === st);
            if (!list.length) return null;
            const c = TASK_STATUS_COLORS[st];
            return <section key={st} className="tsection status-group"><h3><i className="gdot" style={{ background: c.dot }} />{label} <span>{list.length}</span></h3><ul className="task-list">{list.map(row)}</ul></section>;
          })}
          {closed.length > 0 && <details className="tsection done-section"><summary><ChevronDown size={14} />Готово и отменено <span>{closed.length}</span></summary>
            <ul className="task-list">{closed.slice(0, 50).map(row)}</ul></details>}
        </>}
    </div>
  </div>;
}

/** Editor for one task (new or existing). Archive/restore instead of delete. */
export function TaskDrawer({ draft: initial, folders, shoots, items, onClose, onSaved, onOpenShoot, onOpenContent, readOnly = false }: {
  draft: TaskDraft; folders: TaskFolder[]; shoots: Shoot[]; items: ContentItem[]; onClose: () => void; onSaved: (t: Task) => void;
  onOpenShoot?: (id: string) => void; onOpenContent?: (item: ContentItem) => void; readOnly?: boolean;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isNew = d.revision === undefined;
  const archived = !!d.archivedAt;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  async function run(action: 'create' | 'update' | 'archive' | 'restore', close = false) {
    setBusy(true); setError('');
    try { const saved = await saveTask(d, action); onSaved(saved); if (close) onClose(); else setD({ ...saved }); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const shoot = shoots.find(s => s.id === d.shootId);
  const item = items.find(i => i.id === d.contentId);
  return <div className="drawer-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="task-title">
      <div className="drawer-head"><div><div className="eyebrow">Задача{isNew ? ' · новая' : archived ? ' · в архиве' : ''}</div>
        <h2 id="task-title">{isNew ? 'Новая задача' : d.title}</h2></div><button className="icon-btn" aria-label="Закрыть" disabled={busy} onClick={onClose}><X size={18} /></button></div>
      {archived && <p className="hint">Задача в архиве и не видна в плане. Восстановите её, чтобы изменить.</p>}
      <form onSubmit={e => { e.preventDefault(); run(isNew ? 'create' : 'update', isNew); }}>
        <fieldset disabled={busy || archived || readOnly} className="edit-fields">
          <label>Что сделать<input required autoFocus={isNew} maxLength={200} value={d.title} onChange={e => setD({ ...d, title: e.target.value })} /></label>
          <div className="status-field" role="radiogroup" aria-label="Статус"><span className="field-label">Статус</span>
            <div className="status-choices">{TASK_STATUSES.map(st => { const c = TASK_STATUS_COLORS[st]; return <button type="button" key={st} role="radio" aria-checked={d.status === st} className={'status-choice ' + (d.status === st ? 'on' : '')}
              style={{ background: d.status === st ? c.fill : undefined, color: d.status === st ? c.ink : undefined, borderColor: d.status === st ? c.dot : undefined }} onClick={() => setD({ ...d, status: st })}><i style={{ background: c.dot }} />{TASK_STATUS_LABELS[st]}</button>; })}</div></div>
          <label className="check flag-check"><input type="checkbox" checked={d.priority === 'high'} onChange={e => setD({ ...d, priority: e.target.checked ? 'high' : 'normal' })} /><Flag size={14} /> Важно</label>
          {(shoot || item) && <div className="row-actions start">{shoot && onOpenShoot && <button type="button" className="link-button" onClick={() => onOpenShoot(shoot.id!)}>Открыть съёмку «{shoot.title}» →</button>}
            {item && onOpenContent && <button type="button" className="link-button" onClick={() => onOpenContent(item)}>Открыть ролик «{item.title}» →</button>}</div>}
          <label>Заметки<textarea rows={6} maxLength={10000} value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} /></label>
        </fieldset>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="form-actions">
          {!isNew && !readOnly && (archived
            ? <button type="button" className="danger" disabled={busy} onClick={() => run('restore')}>Восстановить из архива</button>
            : <button type="button" className="danger" disabled={busy} onClick={() => run('archive', true)}>В архив</button>)}
          <button type="button" disabled={busy} onClick={onClose}>Закрыть</button>
          {!archived && !readOnly && <button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : isNew ? 'Создать задачу' : 'Сохранить'}</button>}
        </div>
      </form>
      {!isNew && d.updatedAt && <p className="hint">Изменено {new Date(d.updatedAt).toLocaleString('ru', { timeZone: 'Asia/Bangkok' })} · {d.updatedBy}{d.completedAt ? ` · выполнено ${new Date(d.completedAt).toLocaleString('ru', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p>}
    </section>
  </div>;
}

/** Tasks of one shoot or item, shown inside its card. */
export function LinkedTasks({ tasks, onOpen, onAdd }: { tasks: Task[]; onOpen: (t: Task) => void; onAdd?: () => void }) {
  const list = sortTasks(tasks.filter(t => !t.archivedAt));
  const done = list.filter(t => t.status === 'done' || t.status === 'cancelled');
  const active = list.filter(t => t.status === 'todo' || t.status === 'in_progress');
  return <div className="linked-tasks"><div className="multiple-label">Задачи · {active.length} открыто{done.length ? `, ${done.length} закрыто` : ''}</div>
    {active.length > 0 && <ul className="task-list compact">{active.map(t => <TaskRow key={t.id} t={t} links={{}} onOpen={() => onOpen(t)} />)}</ul>}
    {done.length > 0 && <details><summary>Закрытые · {done.length}</summary><ul className="task-list compact">{done.map(t => <TaskRow key={t.id} t={t} links={{}} onOpen={() => onOpen(t)} />)}</ul></details>}
    {!list.length && <p className="hint">Задач нет.</p>}
    {onAdd && <button type="button" className="add-name" onClick={onAdd}>＋ Задача</button>}
  </div>;
}
