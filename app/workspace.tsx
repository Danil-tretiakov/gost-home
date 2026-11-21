'use client';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Clapperboard, FileText, House, ListChecks, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, Wand2, type LucideIcon } from 'lucide-react';
import Calendar from './calendar';
import ContentDrawer from './content-drawer';
import { SHOOT_TEAM } from '../lib/shoot-team';
import { allowedTransitions, CONTENT_STATUS_LABELS, CONTENT_TYPE_LABELS, type ContentStatus } from '../lib/content-status';
import { monthSummary } from '../lib/content-metrics';
import { DEFAULT_PLAN, type PlanSettings } from '../lib/plan-settings';
import { getUpcomingShoots, upcomingDayLabel } from '../lib/upcoming-shoots';
import { newTaskDraft, TaskBoard, TaskDrawer, TaskRow, type TaskDraft } from './tasks';
import { urgentTasks, type Task, type TaskFolder } from '../lib/tasks';
import { AiStudio, AutoplanPanel, BackupPanel, IntegrationsPanel } from './workspace-panels';
import { api, bangkokToday, dayLabel, monthLabel, newContentDraft, type ClientAccess, type ContentDraft, type ContentItem, type Shoot, shiftMonth } from './workspace-types';
import { TeamPanel } from './team-panel';
import { NotificationBell, type NoteItem } from './notifications';

type Section = 'home' | 'tasks' | 'shoots' | 'content' | 'approval' | 'ai' | 'settings';
const NAV: [Section, LucideIcon, string][] = [
  ['home', House, 'Главная'], ['tasks', ListChecks, 'Задачник'], ['shoots', Clapperboard, 'Календарь съёмок'], ['content', FileText, 'Контент-план'],
  ['settings', SettingsIcon, 'Настройки'],
];
const color = (name: string) => SHOOT_TEAM.find(t => t[0] === name)?.[2] ?? '#889';

export default function Workspace({ access }: { access: ClientAccess }) {
  const { caps } = access;
  const canEdit = caps.edit;
  const internal = caps.internal;
  const section = useSyncExternalStore(subscribeHash, readHash, () => 'home' as Section);
  const [collapsed, setCollapsed] = useState(false);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [shoots, setShoots] = useState<Shoot[]>([]);
  const [plan, setPlan] = useState<PlanSettings>(DEFAULT_PLAN);
  const [planRevision, setPlanRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState<ContentDraft | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskFolders, setTaskFolders] = useState<TaskFolder[]>([]);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [openShootId, setOpenShootId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => bangkokToday().slice(0, 7));
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const results = await Promise.allSettled([api<ContentItem[]>('/api/content'), api<Shoot[]>('/api/shoots'), api<{ plan: PlanSettings; revision: number }>('/api/settings'),
      internal ? api<Task[]>('/api/tasks') : Promise.resolve([] as Task[]),
      internal ? api<TaskFolder[]>('/api/tasks/folders') : Promise.resolve([] as TaskFolder[])]);
    if (results[3].status === 'fulfilled') setTasks(results[3].value);
    if (results[4].status === 'fulfilled') setTaskFolders(results[4].value);
    if (results[0].status === 'fulfilled') setItems(results[0].value);
    if (results[1].status === 'fulfilled') setShoots(results[1].value);
    if (results[2].status === 'fulfilled') { setPlan(results[2].value.plan); setPlanRevision(results[2].value.revision); }
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    setError(failed.map(f => (f.reason as Error).message).join(' · '));
    setLoading(false);
  }, [internal]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [load]);
  const go = (s: Section) => { if (s === 'home') history.pushState(null, '', location.pathname); else location.hash = s; window.dispatchEvent(new HashChangeEvent('hashchange')); };

  function openNote(n: NoteItem) {
    const id = n.target.id;
    if (n.target.type === 'task') { const t = tasks.find(x => x.id === id); if (t) openTask(t); else go('tasks'); }
    else if (n.target.type === 'content') { const c = items.find(x => x.id === id); if (c) open(c); }
    else if (n.target.type === 'shoot' && id) { setOpenShootId(id); go('shoots'); }
    else go(n.target.type === 'ai' ? 'ai' : 'settings');
  }
  const upsertFolder = (f: TaskFolder) => setTaskFolders(v => [...v.filter(x => x.id !== f.id), f]);
  const upsertTask = (t: Task) => setTasks(v => [...v.filter(x => x.id !== t.id), t]);
  const openTask = (t: TaskDraft) => setTaskDraft({ ...t });
  const upsert = (item: ContentItem) => setItems(v => [...v.filter(x => x.id !== item.id), item]);
  const open = (item: ContentItem) => setDrawer({ ...item });
  const today = bangkokToday();
  const metricItems = useMemo(() => { const dates = new Map(shoots.map(s => [s.id, s.date])); return items.map(i => ({ ...i, shootDate: i.shootId ? dates.get(i.shootId) ?? null : null })); }, [items, shoots]);
  const summary = useMemo(() => monthSummary(metricItems, month, today, plan), [metricItems, month, today, plan]);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ru');
    return q ? items.filter(i => [i.title, i.primaryMember, ...i.participants, ...i.places].join(' ').toLocaleLowerCase('ru').includes(q)) : items;
  }, [items, query]);

  async function quickStatus(item: ContentItem, to: ContentStatus) {
    try { upsert(await api<ContentItem>('/api/content/status', { method: 'POST', json: { id: item.id, revision: item.revision, to } })); }
    catch (e) { setError((e as Error).message); }
  }
  async function reschedule(item: ContentItem, date: string | null) {
    try { upsert(await api<ContentItem>('/api/content', { method: 'POST', json: { ...item, plannedPublishDate: date } })); }
    catch (e) { setError((e as Error).message); }
  }

  async function signOut() {
    try { await api('/api/auth', { method: 'POST', json: { action: 'logout' } }); } catch { /* the cookie is cleared server side; reload either way */ }
    window.location.replace('/login');
  }

  const Icon = NAV.find(n => n[0] === section)![1];
  return <div className={'app platform ' + (collapsed ? 'collapsed' : '')}>
    <aside className="side">
      <div className="side-top"><button className="brand" onClick={() => go('home')} title="GOST HOME"><span className="logo" aria-hidden>G</span><span className="brand-text">GOST HOME<i>Content studio</i></span></button>
        <button className="collapse icon-btn" aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
      <nav aria-label="Разделы">{NAV.filter(n => n[0] !== 'tasks' || internal).map(([key, NavIcon, label]) => <button key={key} className={'nav ' + (section === key ? 'active' : '')} aria-current={section === key ? 'page' : undefined} onClick={() => go(key)} title={label}>
        <span className="nav-icon" aria-hidden><NavIcon size={17} strokeWidth={1.8} /></span><span className="nav-label">{label}</span>
        {key === 'approval' && summary.awaitingFeedback > 0 && <em>{summary.awaitingFeedback}</em>}</button>)}</nav>
      {internal && <NotificationBell refreshKey={items.length + tasks.length} onOpen={openNote} />}
      {access.email && <div className="side-bottom"><span className="me" title={access.email}><span className="avatar-s" aria-hidden>{(access.memberName ?? access.name ?? access.email)[0].toUpperCase()}</span><span className="nav-label">{access.roleLabel ?? 'Без роли'}</span></span>
        {access.canSignOut && <button className="icon-btn signout" aria-label="Выйти" title="Выйти" onClick={signOut}><LogOut size={15} /></button>}</div>}
    </aside>

    {section === 'shoots' ? <Calendar key={openShootId ?? 'calendar'} canEdit={canEdit} signInHref={access.signInHref} content={items} openShootId={openShootId} onShootOpened={() => setOpenShootId(null)}
      onOpenContent={open} onAddContent={shootId => { const s = shoots.find(x => x.id === shootId); setDrawer(newContentDraft({ shootId, primaryMember: s?.participants[0] ?? 'Юля', participants: s?.participants.slice(1) ?? [], type: s?.format === 'YouTube' ? 'youtube' : 'reel' })); }}
      onShootsChanged={setShoots} tasks={internal ? tasks : undefined} onOpenTask={t => openTask(t)} onAddTask={shootId => openTask(newTaskDraft({ shootId }))} /> :
      <main className="section-main">
        <header className="section-head">
          <div><div className="crumbs">GOST HOME <span>/</span> {NAV.find(n => n[0] === section)![2]}</div>
            <h1><span className="page-icon" aria-hidden><Icon size={18} strokeWidth={1.6} /></span>{titleOf(section)}</h1></div>
          <div className="head-actions">
            {(section === 'content' || section === 'approval') && <label className="search-box"><Search size={14} aria-hidden /><input aria-label="Поиск роликов" placeholder="Найти ролик" value={query} onChange={e => setQuery(e.target.value)} /></label>}
            {canEdit && (section === 'home' || section === 'content') && <button className="primary" onClick={() => setDrawer(newContentDraft({ plannedPublishDate: null }))}><Plus size={15} /> Ролик</button>}
            {section === 'tasks' && canEdit && <button className="primary" onClick={() => openTask(newTaskDraft())}><Plus size={15} /> Задача</button>}
            {!access.email && <a className="signin" href={access.signInHref} target="_top">Вход для команды</a>}
            {access.email && !canEdit && <span className="role-chip" title={access.email}>{access.roleLabel ?? 'Нет роли в команде: только общий план'}</span>}
          </div>
        </header>
        {error && <div role="alert" className="error">{error} <button className="small" onClick={() => { setLoading(true); load(); }}>Повторить</button></div>}
        {loading ? <div className="skeleton" aria-busy="true">Загружаем…</div> :
          section === 'home' ? <Home summary={summary} items={items} shoots={shoots} today={today} month={month} onOpen={open} onOpenShoot={id => { setOpenShootId(id); go('shoots'); }} onGo={go} taskList={internal ? tasks : null} onOpenTask={openTask} /> :
          section === 'tasks' ? (internal ? <TaskBoard tasks={tasks} folders={taskFolders} shoots={shoots} items={items} onOpen={openTask} onSaved={upsertTask} onFolderSaved={upsertFolder} readOnly={!canEdit} /> : <div className="panel placeholder"><h2>Только для команды</h2></div>) :
          section === 'content' ? <ContentPlan yuliaInterval={plan.yuliaIntervalDays} items={visible} allItems={items} shoots={shoots} summary={summary} month={month} setMonth={setMonth} canEdit={canEdit} access={access} onOpen={open} onReschedule={reschedule} onQuick={quickStatus} onAdd={date => setDrawer(newContentDraft({ plannedPublishDate: date }))} onReload={load} /> :
          section === 'approval' ? <Approval items={visible} shoots={shoots} canEdit={canEdit} summary={summary} month={month} onOpen={open} onReschedule={reschedule} onQuick={quickStatus} /> :
          section === 'ai' ? <AiStudio items={items} canEdit={canEdit} canRead={internal} /> :
          <Settings key={planRevision} plan={plan} revision={planRevision} canEdit={canEdit} access={access} onReload={load} onSaved={(p, r) => { setPlan(p); setPlanRevision(r); }} />}
      </main>}

    {drawer && <ContentDrawer key={drawer.id} draft={drawer} shoots={shoots} canEdit={canEdit} canReview={caps.review} canReadInternal={internal} onClose={() => setDrawer(null)} onSaved={item => { upsert(item); }}
      onOpenShoot={id => { setDrawer(null); setOpenShootId(id); go('shoots'); }} />}
    {taskDraft && <TaskDrawer key={taskDraft.id + (taskDraft.revision ?? 'new')} draft={taskDraft} folders={taskFolders} shoots={shoots} items={items} readOnly={!canEdit} onClose={() => setTaskDraft(null)} onSaved={upsertTask}
      onOpenShoot={id => { setTaskDraft(null); setDrawer(null); setOpenShootId(id); go('shoots'); }} onOpenContent={item => { setTaskDraft(null); open(item); }} />}
  </div>;
}

function subscribeHash(cb: () => void) { window.addEventListener('hashchange', cb); window.addEventListener('popstate', cb); return () => { window.removeEventListener('hashchange', cb); window.removeEventListener('popstate', cb); }; }
function readHash(): Section {
  const h = window.location.hash.slice(1);
  return (NAV.map(n => n[0]) as string[]).includes(h) ? h as Section : 'home';
}
function titleOf(s: Section) {
  return ({ home: 'Производственная сводка', shoots: 'Календарь съёмок', content: 'Контент-план', approval: 'Согласование', tasks: 'Задачник', ai: 'Higgsfield AI', settings: 'Настройки' })[s];
}

type Summary = ReturnType<typeof monthSummary>;

function Home({ summary, items, shoots, today, month, onOpen, onOpenShoot, onGo, taskList, onOpenTask }: { summary: Summary; items: ContentItem[]; shoots: Shoot[]; today: string; month: string; onOpen: (i: ContentItem) => void; onOpenShoot: (id: string) => void; onGo: (s: Section) => void; taskList: Task[] | null; onOpenTask: (t: TaskDraft) => void }) {
  const urgent = taskList ? urgentTasks(taskList) : [];
  const upcomingShoots = getUpcomingShoots(shoots, new Date(), 3);
  const upcomingPubs = items.filter(i => i.plannedPublishDate && i.plannedPublishDate >= today && i.productionStatus !== 'published' && i.productionStatus !== 'cancelled')
    .sort((a, b) => a.plannedPublishDate!.localeCompare(b.plannedPublishDate!)).slice(0, 6);
  const tasks = [
    ...items.filter(i => i.productionStatus === 'awaiting_feedback' && i.reviewTurn === 'author').map(i => ({ i, why: 'Нужны правки' })),
    ...items.filter(i => i.productionStatus === 'awaiting_feedback' && i.reviewTurn !== 'author').map(i => ({ i, why: 'Ждёт согласования' })),
    ...summary.coverage.nextUncovered.filter(i => i.productionStatus === 'planned' || i.productionStatus === 'shot').slice(0, 3).map(i => ({ i: items.find(x => x.id === i.id)!, why: 'Слот не обеспечен' })),
  ].filter(t => t.i).slice(0, 6);
  return <div className="home">
    <div className="kpis">
      <Kpi label={`Reels · ${monthLabel(month)}`} value={summary.reels.published} of={summary.reels.target} note={`запланировано ${summary.reels.scheduled}`} />
      <Kpi label="В производстве" value={summary.inProduction} note={`${summary.awaitingFeedback} ждёт согласования · ${summary.changesRequested} на правках`} onClick={() => onGo('content')} />
      <Kpi label="Готовый запас" value={summary.readyStock} note={summary.coverage.upcomingSlots ? `обеспечено слотов подряд: ${summary.coverage.coveredSlots} из ${summary.coverage.upcomingSlots}` : 'будущих слотов нет'} onClick={() => onGo('content')} />
    </div>
    {taskList && <section className="panel home-tasks"><div className="panel-head"><h2>Срочные задачи</h2><button className="link-button" onClick={() => onGo('tasks')}>Задачник →</button></div>
      {urgent.length ? <ul className="task-list compact">{urgent.map(t => <TaskRow key={t.id} t={t} links={{ shoot: shoots.find(s => s.id === t.shootId)?.title, content: items.find(i => i.id === t.contentId)?.title }} onOpen={() => onOpenTask({ ...t })} />)}</ul>
        : <p className="hint">Просроченных, срочных и важных незавершённых задач нет.</p>}</section>}
    <div className="home-grid">
      <section className="panel"><h2>Ближайшие съёмки</h2>
        {upcomingShoots.length ? <ul className="rows">{upcomingShoots.map(s => <li key={s.id}><button className="row" onClick={() => onOpenShoot(s.id!)}>
          <span className="row-date">{upcomingDayLabel(s.date, new Date())}<small>{s.time}</small></span><span className="row-main">{s.title}<small>{s.participants.join(' · ')}</small></span></button></li>)}</ul>
          : <p className="hint">Запланированных съёмок нет.</p>}</section>
      <section className="panel"><h2>Ближайшие публикации</h2>
        {upcomingPubs.length ? <ul className="rows">{upcomingPubs.map(i => <li key={i.id}><button className="row" onClick={() => onOpen(i)}>
          <span className="row-date">{dayLabel(i.plannedPublishDate!)}</span><span className="row-main">{i.title}<small>{i.primaryMember}{i.type === 'youtube' ? ' · YouTube' : ''}</small></span>
          <span className={'pill s-' + i.productionStatus}>{CONTENT_STATUS_LABELS[i.productionStatus]}</span></button></li>)}</ul>
          : <p className="hint">В контент-плане нет будущих дат. <button className="link-button" onClick={() => onGo('content')}>Открыть контент-план →</button></p>}</section>
      <section className="panel"><h2>Требует действия</h2>
        {tasks.length ? <ul className="rows">{tasks.map(({ i, why }) => <li key={i.id + why}><button className="row" onClick={() => onOpen(i)}>
          <span className="row-main">{i.title}<small>{why}{i.plannedPublishDate ? ' · публикация ' + dayLabel(i.plannedPublishDate) : ''}</small></span></button></li>)}</ul>
          : <p className="hint">Срочных задач нет.</p>}</section>
    </div>
  </div>;
}

function Kpi({ label, value, of, note, onClick }: { label: string; value: number; of?: number; note?: string; onClick?: () => void }) {
  const body = <><span className="kpi-label">{label}</span><strong>{value}{of !== undefined && <small> / {of}</small>}</strong>
    {of !== undefined && of > 0 && <div className="bar" aria-hidden><i style={{ width: Math.min(100, value / of * 100) + '%' }} /></div>}{note && <small className="kpi-note">{note}</small>}</>;
  return onClick ? <button className="kpi" onClick={onClick}>{body}</button> : <div className="kpi">{body}</div>;
}

type PlanRow = ContentItem & { date: string | null };
type RowCtx = { canEdit: boolean; today: string; shoots: Shoot[]; onOpen: (i: ContentItem) => void; onReschedule: (i: ContentItem, d: string | null) => void; onQuick: (i: ContentItem, to: ContentStatus) => void };
// Published needs a date; that still opens the full item. Approving is instant, and changes_requested is no longer a stage (see lib/review-turn.ts).
const needsConfirm = (s: ContentStatus) => s === 'published';

/** One row of the shared Notion-like table: a date, the item, and an inline stage select that moves it between groups. Used by both Контент-план (grouped by month) and Согласование (grouped by stage). */
function planTableRow(i: PlanRow, { canEdit, today, shoots, onOpen, onReschedule, onQuick }: RowCtx) {
  const shootOf = shoots.find(s => s.id === i.shootId);
  return <tr key={i.id} className={'s-' + i.productionStatus + (i.date && i.date < today && i.productionStatus !== 'published' && i.productionStatus !== 'cancelled' ? ' late' : '')} onClick={() => onOpen(i)}>
    <td className="c-date" onClick={e => canEdit && i.productionStatus !== 'published' && e.stopPropagation()}>
      {canEdit && i.productionStatus !== 'published'
        ? <input type="date" aria-label={'Дата публикации: ' + i.title} value={i.plannedPublishDate ?? ''} onChange={e => onReschedule(i, e.target.value || null)} />
        : <span>{i.date ? dayLabel(i.date) : '—'}</span>}</td>
    <td className="c-title"><span className="t">{i.title}</span>{shootOf && <small>съёмка {new Date(shootOf.date + 'T12:00').toLocaleDateString('ru', { day: 'numeric', month: 'short' })}</small>}</td>
    <td className="c-member"><span className="person"><i className="dot" style={{ background: color(i.primaryMember) }} />{i.primaryMember}{i.participants.length ? <small> +{i.participants.length}</small> : null}</span></td>
    <td className="c-type"><span className={'tag t-' + i.type}>{CONTENT_TYPE_LABELS[i.type]}</span></td>
    <td className="c-status" onClick={e => canEdit && e.stopPropagation()}>
      {canEdit
        ? <select className={'pill-select s-' + i.productionStatus} value={i.productionStatus}
            onChange={e => { const to = e.target.value as ContentStatus; if (to === i.productionStatus) return; needsConfirm(to) ? onOpen(i) : onQuick(i, to); }}>
            <option value={i.productionStatus}>{CONTENT_STATUS_LABELS[i.productionStatus]}</option>
            {allowedTransitions(i.productionStatus).map(s => <option key={s} value={s}>{CONTENT_STATUS_LABELS[s]}</option>)}
          </select>
        : <span className={'pill s-' + i.productionStatus}>{CONTENT_STATUS_LABELS[i.productionStatus]}</span>}
      {i.productionStatus === 'awaiting_feedback' && i.reviewTurn === 'author' && <span className="turn-badge turn-author" title="Ревьюер попросил правки">автору</span>}
    </td>
  </tr>;
}
type SortKey = 'date' | 'title' | 'primaryMember' | 'type' | 'status';
const SORT_COLS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Дата' }, { key: 'title', label: 'Название' }, { key: 'primaryMember', label: 'Ведущий' }, { key: 'type', label: 'Тип' }, { key: 'status', label: 'Этап' },
];
function planTable(list: PlanRow[], ctx: RowCtx, sortCtx?: { sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void }) {
  return <div className="table-wrap"><table className="ntable plan-table">
    <thead><tr>{SORT_COLS.map(c => sortCtx
      ? <th key={c.key} className="sortable" onClick={() => sortCtx.onSort(c.key)}>{c.label}{sortCtx.sort.key === c.key ? (sortCtx.sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>
      : <th key={c.key}>{c.label}</th>)}</tr></thead>
    <tbody>{list.map(i => planTableRow(i, ctx))}</tbody></table></div>;
}

const STAGE_SORT_ORDER: Record<string, number> = { planned: 0, shot: 1, editing: 1, awaiting_feedback: 2, approved: 3 };

/** Контент-план: members card, a month calendar, and one flat sortable list of everything still in the pipeline — no month switcher, Данил found it confusing to keep searching across months. */
function ContentPlan({ items, allItems, shoots, summary, month, yuliaInterval, canEdit, access, onOpen, onReschedule, onQuick, onAdd, onReload }: { yuliaInterval: number; items: ContentItem[]; allItems: ContentItem[]; shoots: Shoot[]; summary: Summary; month: string; setMonth: (m: string) => void; canEdit: boolean; access: ClientAccess; onOpen: (i: ContentItem) => void; onReschedule: (i: ContentItem, d: string | null) => void; onQuick: (i: ContentItem, to: ContentStatus) => void; onAdd: (d: string | null) => void; onReload: () => void }) {
  const [autoplanOpen, setAutoplanOpen] = useState(false);
  const [type, setType] = useState<'all' | 'reel' | 'youtube'>('all');
  const [who, setWho] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  const shown = items.filter(i => (type === 'all' || i.type === type) && (!who || i.primaryMember === who));
  const today = bangkokToday();
  const ctx: RowCtx = { canEdit, today, shoots, onOpen, onReschedule, onQuick };
  const shotTotal = summary.members.reduce((a, m) => a + m.shot, 0);
  // Month plan by lead: each member's monthly quota (the «План» column) as a share of all Reels.
  const planParts = summary.members.map(m => ({ member: m.member, n: m.target })).filter(p => p.n > 0);
  const planTotal = planParts.reduce((a, p) => a + p.n, 0);

  // Always-on list of everything still in the pipeline (not published, not cancelled), across all months — sortable, not month-filtered.
  const pipeline: PlanRow[] = shown.filter(i => i.productionStatus !== 'published' && i.productionStatus !== 'cancelled').map(i => ({ ...i, date: i.plannedPublishDate }));
  const sortVal = (i: PlanRow): string | number => sort.key === 'date' ? (i.date ?? '9999-99-99') : sort.key === 'status' ? (STAGE_SORT_ORDER[i.productionStatus] ?? 9) : i[sort.key];
  const sorted = [...pipeline].sort((a, b) => { const av = sortVal(a), bv = sortVal(b); return av < bv ? -sort.dir : av > bv ? sort.dir : 0; });
  const onSort = (key: SortKey) => setSort(s => s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 });

  return <div className="content-plan">
    {autoplanOpen && <AutoplanPanel key={month} month={month} onClose={() => setAutoplanOpen(false)} onApplied={onReload} />}
    <div className="plan-top">
      <section className="members-card"><div className="card-head"><h2>Участники · {monthLabel(month)}</h2>
        <span className="hint">Снято {shotTotal} · выложено {summary.reels.published} из {summary.reels.target} Reels</span></div>
        <div className="table-wrap"><table className="ntable members-table">
          <thead><tr><th>Участник</th><th>План</th><th>Снято</th><th>Выложено</th><th>Осталось</th></tr></thead>
          <tbody>{summary.members.filter(m => m.target > 0 || m.shot > 0 || m.published > 0 || m.scheduled > 0).map(m => <tr key={m.member}>
            <td><span className="person"><i className="dot" style={{ background: color(m.member) }} />{m.member}</span></td>
            <td>{m.target}</td><td><b>{m.shot}</b></td><td><b>{m.published}</b></td><td>{m.remaining}</td></tr>)}</tbody>
        </table></div>
        {planTotal > 0 && <div className="plan-split" aria-label="Кто сколько выходит в этом месяце"><div className="split-bar">{planParts.map(p => <i key={p.member} style={{ flex: p.n, background: color(p.member) }} title={`${p.member}: ${p.n}`} />)}</div>
          <ul className="split-legend">{planParts.map(p => <li key={p.member}><i className="dot" style={{ background: color(p.member) }} />{p.member} <b>{Math.round(p.n / planTotal * 100)}%</b> <small>{p.n}</small></li>)}</ul>
        </div>}
      </section>
      <MiniCalendar month={month} allItems={allItems} today={today} members={summary.members.filter(m => m.target > 0 || m.published > 0 || m.scheduled > 0).map(m => m.member)} targets={Object.fromEntries(summary.members.map(m => [m.member, m.target]))} yuliaInterval={yuliaInterval} />
    </div>

    <div className="plan-bar">
      <div className="plan-tools"><div className="seg">{(['all', 'reel', 'youtube'] as const).map(t => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t === 'all' ? 'Все' : CONTENT_TYPE_LABELS[t]}</button>)}</div>
        {canEdit && !autoplanOpen && <button className="ghost-btn" onClick={() => setAutoplanOpen(true)}><Wand2 size={14} /> Автоплан</button>}</div>
    </div>
    <div className="who-chips" role="group" aria-label="Ведущий"><button type="button" className={'who-chip ' + (who === '' ? 'on' : '')} onClick={() => setWho('')}>Все ведущие</button>
      {summary.members.filter(m => m.target > 0 || m.published > 0 || m.scheduled > 0).map(m => <button type="button" key={m.member} className={'who-chip ' + (who === m.member ? 'on' : '')} onClick={() => setWho(who === m.member ? '' : m.member)}><i className="dot" style={{ background: color(m.member) }} />{m.member}</button>)}</div>
    {sorted.length ? planTable(sorted, ctx, { sort, onSort }) : <p className="empty-line big">В работе ничего нет.</p>}
    {canEdit && <button className="add-row" onClick={() => onAdd(today)}><Plus size={14} /> Новый ролик</button>}
  </div>;
}

/** Month grid of dots per actor, next to the members table — a quick visual of who publishes when. */
function monthCalendarCells(month: string): (string | null)[] {
  const first = new Date(month + '-01T12:00:00');
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const firstWeekday = (first.getDay() + 6) % 7; // Monday = 0
  const cells: (string | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

type CalEntry = { title: string; ready: boolean; planned?: boolean };

/** Month calendar: one fixed row per active member (same order every day, from SHOOT_TEAM). Real dated items are solid; empty future days get one dashed planned placeholder. */
function MiniCalendar({ month: startMonth, allItems, today, members, targets, yuliaInterval }: { month: string; allItems: ContentItem[]; today: string; members: string[]; targets: Record<string, number>; yuliaInterval: number }) {
  const [month, setMonth] = useState(startMonth);
  const dateOf = (i: ContentItem) => i.productionStatus === 'published' && i.publishedAt ? i.publishedAt : i.plannedPublishDate;
  const byDateMember = new Map<string, Map<string, CalEntry>>();
  const realCount: Record<string, number> = {};
  for (const i of allItems) {
    if (i.productionStatus === 'cancelled') continue;
    const d = dateOf(i);
    if (!d || !d.startsWith(month)) continue;
    realCount[i.primaryMember] = (realCount[i.primaryMember] ?? 0) + 1;
    const ready = i.productionStatus === 'approved' || i.productionStatus === 'published';
    const forDate = byDateMember.get(d) ?? new Map<string, CalEntry>();
    forDate.set(i.primaryMember, { title: i.title, ready });
    byDateMember.set(d, forDate);
  }
  // Planned placeholders for empty future days, paced evenly: each actor's ideal spacing is month length / monthly target, a slot only goes to someone far enough from their nearest dated reel (and not over quota), the most overdue first. Actors with no dated reel are anchored at today so they come later. Display only, nothing is saved.
  const planned: Record<string, number> = {};
  const days = monthCalendarCells(month).filter((d): d is string => !!d);
  // Юля goes on a fixed rhythm: every `yuliaInterval` days, with a gap one day shorter every 4th time (the extra different-format reels, about twice a month), counted from her earliest dated reel; everyone else fills the remaining days.
  const dayNum = (x: string) => Math.round(Date.parse(x + 'T00:00:00Z') / 864e5);
  const yuliaDates = allItems.filter(i => i.primaryMember === 'Юля' && i.productionStatus !== 'cancelled' && i.plannedPublishDate).map(i => i.plannedPublishDate as string).sort();
  const yuliaDays = new Set<number>();
  if (yuliaDates.length && 'Юля' in targets) { let n = dayNum(yuliaDates[0]); for (let k = 0; n < dayNum(yuliaDates[0]) + 400; k++) { yuliaDays.add(n); n += Math.max(1, yuliaInterval - (k % 4 === 2 ? 1 : 0)); } }
  const isYuliaDay = (d: string) => yuliaDays.has(dayNum(d));
  const anchors: Record<string, number[]> = {};
  for (const i of allItems) { const d = dateOf(i); if (d && i.productionStatus !== 'cancelled') (anchors[i.primaryMember] ??= []).push(dayNum(d)); }
  for (const d of days) {
    if (d < today || byDateMember.has(d)) continue;
    if (isYuliaDay(d)) { byDateMember.set(d, new Map([['Юля', { title: 'нужно подготовить ролик', ready: false, planned: true }]])); continue; }
    const dn = dayNum(d);
    // Договорённость с Данилом: Андрей в ноябре 2026 только 30-го.
    if (d === '2026-11-30' && 'Андрей' in targets) { planned['Андрей'] = (planned['Андрей'] ?? 0) + 1; (anchors['Андрей'] ??= []).push(dn); byDateMember.set(d, new Map([['Андрей', { title: 'нужно подготовить ролик', ready: false, planned: true }]])); continue; }
    const cand = Object.keys(targets).filter(m => m !== 'Юля' && !(m === 'Андрей' && d.startsWith('2026-11')) && targets[m] > 0 && (realCount[m] ?? 0) + (planned[m] ?? 0) < targets[m]).map(m => {
      const interval = Math.max(1, Math.round(days.length / targets[m]));
      const dist = Math.min(...(anchors[m] ?? [dayNum(today)]).map(a => Math.abs(dn - a)));
      return { m, dist, interval, ok: dist >= Math.max(2, Math.ceil(interval * 0.8)), score: dist / interval };
    });
    const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;
    // сначала строго по интервалу; если никто не подходит, закрываем день тем, кто дальше всех от своих роликов (не вплотную)
    const picked = (cand.filter(c => c.ok).sort(byScore)[0] ?? cand.filter(c => c.dist >= 2).sort((a, b) => b.dist - a.dist || b.interval - a.interval)[0])?.m;
    // Ролик должен выходить каждый день: если квоты закончились, день закрывает Марк (он «добирает остаток»)
    const pick = picked ?? ('Марк' in targets ? 'Марк' : undefined);
    if (!pick) continue;
    planned[pick] = (planned[pick] ?? 0) + 1;
    (anchors[pick] ??= []).push(dn);
    byDateMember.set(d, new Map([[pick, { title: 'нужно подготовить ролик', ready: false, planned: true }]]));
  }
  const rows = SHOOT_TEAM.filter(([name]) => members.includes(name));
  const perDay = Math.max(1, ...[...byDateMember.values()].map(m => m.size));
  const cells = monthCalendarCells(month);
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  return <section className="mini-cal">
    <div className="card-head"><h2>Календарь · {monthLabel(month)}</h2>
      <div className="cal-nav"><button type="button" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <button type="button" className="cal-today" onClick={() => setMonth(startMonth)}>Сегодня</button>
        <button type="button" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div></div>
    <div className="mini-cal-grid">
      {weekdays.map(w => <span key={w} className="mini-cal-wd">{w}</span>)}
      {cells.map((date, idx) => {
        const forDate = date ? byDateMember.get(date) : undefined;
        return <div key={idx} className={'mini-cal-cell' + (date ? '' : ' empty') + (date === today ? ' today' : '')}>
          {date && <><span className="mini-cal-day">{Number(date.slice(8))}</span>
            {Array.from({ length: perDay }, (_, k) => { const name = rows.map(r => r[0]).filter(n => forDate?.has(n))[k]; const e = name ? forDate?.get(name) : undefined; return <div key={k} className="mc-row">
              {e && name && <span className={'mc-item' + (e.planned ? ' planned' : '')} style={{ '--c': color(name) } as React.CSSProperties} title={`${name}: ${e.title}`}>
                <i className={'rdot ' + (e.ready ? 'ready' : 'pending')} />{name}</span>}
            </div>; })}</>}
        </div>;
      })}
    </div>
    <ul className="mini-cal-legend">
      <li><i className="rdot ready" /> готово к выкладке</li><li><i className="rdot pending" /> ещё не готово</li><li><span className="mc-item planned legend-sample" style={{ '--c': '#9a9a94' } as React.CSSProperties}>Имя</span> слот по плану, ролика ещё нет</li>
    </ul>
    <ul className="mini-cal-legend">{rows.map(([name]) => <li key={name}><i className="dot" style={{ background: color(name) }} />{name}</li>)}</ul>
  </section>;
}

type Block = { key: string; title: string; hint: string; statuses: ContentStatus[] };
const BLOCKS: Block[] = [
  { key: 'script', title: 'Сценарий готов', hint: 'Ещё не снято', statuses: ['planned'] },
  { key: 'shot', title: 'Съёмка', hint: 'Съёмка и монтаж', statuses: ['shot', 'editing'] },
  { key: 'review', title: 'Ждёт согласования', hint: 'Ждёт решения или правок', statuses: ['awaiting_feedback'] },
  { key: 'ready', title: 'Согласовано', hint: 'Готово к выкладке', statuses: ['approved'] },
  { key: 'published', title: 'Выложено', hint: 'За выбранный месяц', statuses: ['published'] },
];

/** Согласование: one Notion-like list per stage, same table and inline stage-select as Контент-план — change the stage, the row moves to its group. */
function Approval({ items, shoots, canEdit, summary, month, onOpen, onReschedule, onQuick }: { items: ContentItem[]; shoots: Shoot[]; canEdit: boolean; summary: Summary; month: string; onOpen: (i: ContentItem) => void; onReschedule: (i: ContentItem, d: string | null) => void; onQuick: (i: ContentItem, to: ContentStatus) => void }) {
  const today = bangkokToday();
  const ctx: RowCtx = { canEdit, today, shoots, onOpen, onReschedule, onQuick };
  const listOf = (b: Block): PlanRow[] => items.filter(i => b.statuses.includes(i.productionStatus) && (b.key !== 'published' || (i.publishedAt ?? '').startsWith(month)))
    .map(i => ({ ...i, date: b.key === 'published' ? i.publishedAt : i.plannedPublishDate }))
    .sort((a, c) => b.key === 'published' ? (c.date ?? '').localeCompare(a.date ?? '') : (a.date ?? '9999').localeCompare(c.date ?? '9999'));
  const lists = BLOCKS.map(b => [b, listOf(b)] as const);
  return <div className="approval">
    <div className="stage-strip">{lists.map(([b, list]) => <a key={b.key} href={'#approval'} onClick={e => { e.preventDefault(); document.getElementById('block-' + b.key)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={'stage st-' + b.key}>
      <b>{list.length}</b><span>{b.title}</span></a>)}</div>
    {summary.coverage.upcomingSlots > 0 && <p className="hint">Согласованный запас покрывает {summary.coverage.coveredSlots} из {summary.coverage.upcomingSlots} ближайших дат.{summary.coverage.nextUncovered[0] ? ` Первая непокрытая: ${dayLabel(summary.coverage.nextUncovered[0].plannedPublishDate!)} · ${summary.coverage.nextUncovered[0].title}.` : ''}</p>}
    {lists.map(([b, list]) => <section key={b.key} id={'block-' + b.key} className={'block st-' + b.key}>
      <div className="block-head"><span className="block-title">{b.title}</span><span className="count">{list.length}</span><small>{b.hint}</small></div>
      {list.length ? planTable(list, ctx) : <p className="empty-line">Пусто</p>}
    </section>)}
  </div>;
}

function Settings({ plan, revision, canEdit, access, onReload, onSaved }: { plan: PlanSettings; revision: number; canEdit: boolean; access: ClientAccess; onReload: () => void; onSaved: (p: PlanSettings, r: number) => void }) {
  const [draft, setDraft] = useState(plan);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const sum = Object.values(draft.members).reduce((a, b) => a + b, 0);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('');
    try { const r = await api<{ plan: PlanSettings; revision: number }>('/api/settings', { method: 'POST', json: { plan: draft, revision } }); onSaved(r.plan, r.revision); setMsg('Сохранено'); }
    catch (err) { setMsg((err as Error).message); } finally { setBusy(false); }
  }
  const num = (v: string) => Math.max(0, Math.min(200, Math.round(Number(v) || 0)));
  return <div className="settings">
    <form className="panel" onSubmit={save}><h2>Нормативы месяца</h2>
      <fieldset disabled={!canEdit || busy} className="edit-fields">
        <div className="fields">
          <label>Reels в месяц<input type="number" min={0} max={200} value={draft.reelsPerMonth} onChange={e => setDraft({ ...draft, reelsPerMonth: num(e.target.value) })} /></label>
          <label>YouTube в месяц<input type="number" min={0} max={50} value={draft.youtubePerMonth} onChange={e => setDraft({ ...draft, youtubePerMonth: num(e.target.value) })} /></label>
        </div>
        <div className="member-targets">{SHOOT_TEAM.map(([name]) => <label key={name}><span><i className="dot" style={{ background: color(name) }} />{name}</span>
          <input type="number" min={0} max={200} value={draft.members[name] ?? 0} onChange={e => setDraft({ ...draft, members: { ...draft.members, [name]: num(e.target.value) } })} /></label>)}</div>
        <p className={'hint ' + (sum !== draft.reelsPerMonth ? 'warn' : '')}>Сумма по участникам: {sum} из {draft.reelsPerMonth}{sum !== draft.reelsPerMonth ? ' · не совпадает с общим планом' : ''}. 0 = пауза.</p>
      </fieldset>
      {canEdit && <div className="form-actions"><span className="hint">{msg}</span><button className="primary" disabled={busy}>Сохранить нормативы</button></div>}
    </form>
    {access.caps.admin && <TeamPanel access={access} />}
    <IntegrationsPanel canEdit={access.caps.admin} onContentChanged={onReload} />
    <BackupPanel canEdit={access.caps.admin && access.caps.finance} onRestored={onReload} />
  </div>;
}
