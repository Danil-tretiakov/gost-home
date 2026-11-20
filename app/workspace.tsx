'use client';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BadgeCheck, ChevronLeft, ChevronRight, Clapperboard, FileText, House, ListChecks, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, Sparkles, Wand2, type LucideIcon } from 'lucide-react';
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
import { api, bangkokToday, dayLabel, monthLabel, newContentDraft, shiftMonth, type ClientAccess, type ContentDraft, type ContentItem, type Shoot } from './workspace-types';
import { TeamPanel } from './team-panel';
import { NotificationBell, type NoteItem } from './notifications';

type Section = 'home' | 'tasks' | 'shoots' | 'content' | 'approval' | 'ai' | 'settings';
const NAV: [Section, LucideIcon, string][] = [
  ['home', House, 'Главная'], ['tasks', ListChecks, 'Задачник'], ['shoots', Clapperboard, 'Календарь съёмок'], ['content', FileText, 'Контент-план'],
  ['approval', BadgeCheck, 'Согласование'], ['ai', Sparkles, 'Higgsfield AI'], ['settings', SettingsIcon, 'Настройки'],
];
const color = (name: string) => SHOOT_TEAM.find(t => t[0] === name)?.[2] ?? '#889';
const pct = (v: number | null) => v === null ? '—' : `${Math.round(v * 1000) / 10}%`.replace('.', ',');

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
          section === 'content' ? <ContentPlan items={visible} allItems={items} shoots={shoots} summary={summary} month={month} setMonth={setMonth} canEdit={canEdit} access={access} onOpen={open} onReschedule={reschedule} onQuick={quickStatus} onAdd={date => setDrawer(newContentDraft({ plannedPublishDate: date }))} onReload={load} /> :
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
      <Kpi label="YouTube" value={summary.youtube.published} of={summary.youtube.target} note={`запланировано ${summary.youtube.scheduled}`} />
      <Kpi label="В производстве" value={summary.inProduction} note={`${summary.awaitingFeedback} ждёт согласования · ${summary.changesRequested} на правках`} onClick={() => onGo('approval')} />
      <Kpi label="Готовый запас" value={summary.readyStock} note={summary.coverage.upcomingSlots ? `обеспечено слотов подряд: ${summary.coverage.coveredSlots} из ${summary.coverage.upcomingSlots}` : 'будущих слотов нет'} onClick={() => onGo('approval')} />
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
function planTable(list: PlanRow[], ctx: RowCtx) {
  return <div className="table-wrap"><table className="ntable plan-table">
    <thead><tr><th>Дата</th><th>Название</th><th>Ведущий</th><th>Тип</th><th>Этап</th></tr></thead>
    <tbody>{list.map(i => planTableRow(i, ctx))}</tbody></table></div>;
}

/** Контент-план: a Notion-like list of the month (no calendar grid), members with auto counts, and the pay card. */
function ContentPlan({ items, allItems, shoots, summary, month, setMonth, canEdit, access, onOpen, onReschedule, onQuick, onAdd, onReload }: { items: ContentItem[]; allItems: ContentItem[]; shoots: Shoot[]; summary: Summary; month: string; setMonth: (m: string) => void; canEdit: boolean; access: ClientAccess; onOpen: (i: ContentItem) => void; onReschedule: (i: ContentItem, d: string | null) => void; onQuick: (i: ContentItem, to: ContentStatus) => void; onAdd: (d: string | null) => void; onReload: () => void }) {
  const [autoplanOpen, setAutoplanOpen] = useState(false);
  const [type, setType] = useState<'all' | 'reel' | 'youtube'>('all');
  const [who, setWho] = useState('');
  const shown = items.filter(i => (type === 'all' || i.type === type) && (!who || i.primaryMember === who));
  const dateOf = (i: ContentItem) => i.productionStatus === 'published' && i.publishedAt ? i.publishedAt : i.plannedPublishDate;
  const inMonth: PlanRow[] = shown.map(i => ({ ...i, date: dateOf(i) })).filter(i => i.date?.startsWith(month)).sort((a, b) => (a.date! + a.title).localeCompare(b.date! + b.title));
  const bank: PlanRow[] = shown.filter(i => !i.plannedPublishDate && i.productionStatus !== 'published' && i.productionStatus !== 'cancelled').map(i => ({ ...i, date: null }));
  const today = bangkokToday();
  const ctx: RowCtx = { canEdit, today, shoots, onOpen, onReschedule, onQuick };
  const shotTotal = summary.members.reduce((a, m) => a + m.shot, 0);
  // Month plan by lead: Reels with a publication date in this month (published ones included), as a share of all of them.
  const planParts = summary.members.map(m => ({ member: m.member, n: m.scheduled })).filter(p => p.n > 0);
  const planTotal = planParts.reduce((a, p) => a + p.n, 0);
  const table = (list: PlanRow[]) => planTable(list, ctx);

  return <div className="content-plan">
    {autoplanOpen && <AutoplanPanel key={month} month={month} onClose={() => setAutoplanOpen(false)} onApplied={onReload} />}
    <div className="plan-top">
      <section className="members-card"><div className="card-head"><h2>Участники · {monthLabel(month)}</h2>
        <span className="hint">Снято {shotTotal} · выложено {summary.reels.published} из {summary.reels.target} Reels</span></div>
        <div className="table-wrap"><table className="ntable members-table">
          <thead><tr><th>Участник</th><th>План</th><th>Снято</th><th>Доля</th><th>Выложено</th><th>Доля</th><th>Осталось</th></tr></thead>
          <tbody>{summary.members.filter(m => m.target > 0 || m.shot > 0 || m.published > 0 || m.scheduled > 0).map(m => <tr key={m.member}>
            <td><span className="person"><i className="dot" style={{ background: color(m.member) }} />{m.member}</span></td>
            <td>{m.target}</td><td><b>{m.shot}</b></td><td className="share"><Share v={m.shotShare} c={color(m.member)} /></td>
            <td><b>{m.published}</b></td><td className="share"><Share v={m.publishedShare} c={color(m.member)} /></td><td>{m.remaining}</td></tr>)}</tbody>
        </table></div>
        {planTotal > 0 && <div className="plan-split" aria-label="Кто сколько выходит в этом месяце"><div className="split-bar">{planParts.map(p => <i key={p.member} style={{ flex: p.n, background: color(p.member) }} title={`${p.member}: ${p.n}`} />)}</div>
          <ul className="split-legend">{planParts.map(p => <li key={p.member}><i className="dot" style={{ background: color(p.member) }} />{p.member} <b>{Math.round(p.n / planTotal * 100)}%</b> <small>{p.n}</small></li>)}</ul>
        </div>}
      </section>
    </div>

    <div className="plan-bar">
      <div className="month"><button className="icon-btn" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button><h2>{monthLabel(month)}</h2>
        <button className="icon-btn" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
        {month !== today.slice(0, 7) && <button className="ghost-btn" onClick={() => setMonth(today.slice(0, 7))}>Сегодня</button>}</div>
      <div className="plan-tools"><div className="seg">{(['all', 'reel', 'youtube'] as const).map(t => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t === 'all' ? 'Все' : CONTENT_TYPE_LABELS[t]}</button>)}</div>
        {canEdit && !autoplanOpen && <button className="ghost-btn" onClick={() => setAutoplanOpen(true)}><Wand2 size={14} /> Автоплан</button>}</div>
    </div>
    <div className="who-chips" role="group" aria-label="Ведущий"><button type="button" className={'who-chip ' + (who === '' ? 'on' : '')} onClick={() => setWho('')}>Все ведущие</button>
      {summary.members.filter(m => m.target > 0 || m.published > 0 || m.scheduled > 0).map(m => <button type="button" key={m.member} className={'who-chip ' + (who === m.member ? 'on' : '')} onClick={() => setWho(who === m.member ? '' : m.member)}><i className="dot" style={{ background: color(m.member) }} />{m.member}</button>)}</div>
    {inMonth.length ? table(inMonth) : <p className="empty-line big">В этом месяце роликов нет.</p>}
    {canEdit && <button className="add-row" onClick={() => onAdd(month === today.slice(0, 7) ? today : month + '-01')}><Plus size={14} /> Новый ролик</button>}

    <h3 className="group-title">Без даты <span>{bank.length}</span></h3>
    {bank.length ? table(bank) : <p className="empty-line">Все ролики распределены по датам.</p>}
  </div>;
}

function Share({ v, c }: { v: number | null; c: string }) {
  return v === null ? <span className="muted">—</span> : <span className="share-bar"><i style={{ width: Math.round(v * 100) + '%', background: c }} /><span>{pct(v)}</span></span>;
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
          <label>Юля, интервал, дней<input type="number" min={1} max={15} value={draft.yuliaIntervalDays} onChange={e => setDraft({ ...draft, yuliaIntervalDays: Math.max(1, Math.min(15, num(e.target.value))) })} /></label>
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
