'use client';
/* eslint-disable @next/next/no-img-element -- previews come from provider links or our own authorized file route; next/image cannot proxy them */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SHOOT_TEAM } from '../lib/shoot-team';
import { RATE_MODELS, RATE_MODEL_LABELS, formatMoney } from '../lib/finance';
import { CONTENT_STATUS_LABELS } from '../lib/content-status';
import { api, bangkokToday, dayLabel, monthLabel, shiftMonth, type ContentItem } from './workspace-types';

const NAMES = SHOOT_TEAM.map(t => t[0]);
const color = (name: string) => SHOOT_TEAM.find(t => t[0] === name)?.[2] ?? '#889';
const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('ru', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** Loads JSON once and on demand; errors are shown, never swallowed. */
function useLoad<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!url) return;
    try { setData(await api<T>(url)); setError(''); } catch (e) { setError((e as Error).message); }
  }, [url]);
  useEffect(() => { Promise.resolve().then(reload); }, [reload]);
  return { data, error, reload, setError };
}

/* ───────────── Autoplan ───────────── */

type Slot = { date: string; member: string; kind: 'assign' | 'new' | 'empty'; itemId: string | null; itemRevision?: number; title: string; note?: string };
type Preview = { month: string; from: string; to: string; slots: Slot[]; conflicts: string[]; members: { member: string; target: number; existing: number; proposed: number }[] };

export function AutoplanPanel({ month, onClose, onApplied }: { month: string; onClose: () => void; onApplied: () => void }) {
  const [fillEmpty, setFillEmpty] = useState(true);
  const { data, error, reload, setError } = useLoad<Preview>(`/api/content/autoplan?month=${month}&fillEmpty=${fillEmpty ? 1 : 0}`);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const key = (s: Slot) => `${s.date}|${s.member}|${s.itemId ?? ''}`;
  const chosen = (data?.slots ?? []).filter(s => !off.has(key(s)));

  async function apply() {
    if (!data) return;
    setBusy(true); setError(''); setDone('');
    try {
      const r = await api<{ assigned: number; created: number }>('/api/content/autoplan', { method: 'POST', json: { month, slots: chosen.map(s => ({ date: s.date, member: s.member, itemId: s.itemId })) } });
      setDone(`Готово: назначено дат ${r.assigned}, новых слотов ${r.created}.`); setOff(new Set()); onApplied(); await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return <section className="panel autoplan" aria-label="Автоплан">
    <div className="panel-head"><h2>Автоплан Reels · {monthLabel(month)}</h2><button className="small" onClick={onClose}>Закрыть</button></div>
    <p className="hint">Предварительный просмотр. Уже назначенные и опубликованные ролики не двигаются, один ролик не ставится дважды. Сохраняются только отмеченные строки.</p>
    <label className="inline-check"><input type="checkbox" checked={fillEmpty} onChange={e => { setFillEmpty(e.target.checked); setOff(new Set()); }} /> Создавать пустые слоты, если в банке не хватает роликов</label>
    {error && <p role="alert" className="error">{error}</p>}
    {done && <p className="ok">{done}</p>}
    {!data ? <p className="hint">Считаем…</p> : <>
      {data.from > data.to ? <p className="hint">Этот месяц уже прошёл: предлагать нечего.</p> : <p className="hint">Период расчёта: {dayLabel(data.from)} – {dayLabel(data.to)}</p>}
      <div className="table-wrap"><table className="mini">
        <thead><tr><th>Участник</th><th>План</th><th>Уже есть</th><th>Предложено</th></tr></thead>
        <tbody>{data.members.filter(m => m.target || m.existing || m.proposed).map(m => <tr key={m.member}><td><span className="dot" style={{ background: color(m.member) }} />{m.member}</td><td>{m.target}</td><td>{m.existing}</td><td>{m.proposed}</td></tr>)}</tbody>
      </table></div>
      {data.conflicts.length > 0 && <ul className="conflicts">{data.conflicts.map(c => <li key={c}>{c}</li>)}</ul>}
      {data.slots.length ? <ul className="slot-list">{data.slots.map(s => <li key={key(s)}>
        <label><input type="checkbox" checked={!off.has(key(s))} onChange={e => { const n = new Set(off); if (e.target.checked) n.delete(key(s)); else n.add(key(s)); setOff(n); }} />
          <span className="slot-date">{dayLabel(s.date)}</span><span className="dot" style={{ background: color(s.member) }} /><b>{s.member}</b>
          <span className="slot-title">{s.kind === 'assign' ? s.title : s.kind === 'new' ? 'новый слот, тема не выбрана' : 'пусто, роликов в банке нет'}</span>
          {s.note && <small>{s.note}</small>}</label></li>)}</ul> : <p className="hint">Предложений нет: план месяца уже закрыт датами.</p>}
      <div className="form-actions"><span className="hint">Отмечено {chosen.filter(s => s.kind !== 'empty').length}</span>
        <button className="primary" disabled={busy || !chosen.some(s => s.kind !== 'empty')} onClick={apply}>{busy ? 'Сохраняем…' : 'Применить отмеченные'}</button></div>
    </>}
  </section>;
}

/* ───────────── Finance ───────────── */

type Rule = { id: string; member: string; model: string; amountMinor: number; currency: string; validFrom: string; validTo: string | null; note: string; active: number; revision: number };
type UnitRow = { id: string; member: string; basis: string; basisKey: string; period: string; amountMinor: number; currency: string; description: string; voidedAt: string | null; voidReason: string | null; createdAt: string };
type Pay = { id: string; member: string; amountMinor: number; currency: string; paidAt: string; note: string; voidedAt: string | null; voidReason: string | null };
type Sugg = { member: string; basis: string; basisKey: string; amountMinor: number; currency: string; description: string };
type Fin = { rules: Rule[]; units: UnitRow[]; payments: Pay[]; balancesAll: { member: string; units: number; accruedMinor: number; paidMinor: number; balanceMinor: number }[]; suggestions: Sugg[] };

export function Finance() {
  const [period, setPeriod] = useState(() => bangkokToday().slice(0, 7));
  const { data, error, reload, setError } = useLoad<Fin>(`/api/finance?period=${period}`);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rule, setRule] = useState({ member: NAMES[0], model: 'per_reel', amount: '', validFrom: bangkokToday().slice(0, 7) + '-01', note: '' });
  const [pay, setPay] = useState(() => ({ id: crypto.randomUUID(), member: NAMES[0], amount: '', paidAt: bangkokToday(), note: '' }));
  const [oneoff, setOneoff] = useState({ member: NAMES[0], amount: '', description: '' });
  const sk = (s: Sugg) => `${s.member}|${s.basis}|${s.basisKey}`;

  async function act(json: Record<string, unknown>, after?: () => void) {
    setBusy(true); setError('');
    try { await api('/api/finance', { method: 'POST', json }); after?.(); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const voidRow = (action: 'unit.void' | 'payment.void', id: string) => {
    const reason = window.prompt('Причина исправления (запись останется в истории как аннулированная)');
    if (reason && reason.trim()) act({ action, id, reason });
  };
  const activeRules = (data?.rules ?? []).filter(r => r.active);

  return <div className="finance">
    <div className="toolbar"><div className="month"><button aria-label="Предыдущий месяц" onClick={() => { setPeriod(shiftMonth(period, -1)); setPicked(new Set()); }}>‹</button><h2>{monthLabel(period)}</h2>
      <button aria-label="Следующий месяц" onClick={() => { setPeriod(shiftMonth(period, 1)); setPicked(new Set()); }}>›</button></div>
      <span className="hint">Видно только владельцу. Суммы вводятся вручную, система ничего не выдумывает.</span></div>
    {error && <p role="alert" className="error">{error}</p>}
    {!data ? <div className="skeleton">Загружаем…</div> : <>
      <section className="panel"><h2>Баланс по участникам · за всё время</h2>
        {data.balancesAll.length ? <div className="table-wrap"><table className="mini">
          <thead><tr><th>Участник</th><th>Начислено</th><th>Выплачено</th><th>Остаток</th></tr></thead>
          <tbody>{data.balancesAll.map(b => <tr key={b.member}><td><span className="dot" style={{ background: color(b.member) }} />{b.member}</td><td>{formatMoney(b.accruedMinor)}</td><td>{formatMoney(b.paidMinor)}</td><td className={b.balanceMinor > 0 ? 'due' : ''}>{formatMoney(b.balanceMinor)}</td></tr>)}</tbody>
        </table></div> : <p className="hint">Начислений и выплат пока нет.</p>}
      </section>

      <div className="fin-grid">
        <section className="panel"><h2>Предложенные начисления · {monthLabel(period)}</h2>
          {!activeRules.length ? <p className="hint">Тарифы не заданы. Добавьте тариф ниже, тогда здесь появятся начисления за опубликованные Reels, съёмочные дни со статусом «Снято» или фикс.</p>
            : data.suggestions.length ? <>
              <ul className="check-list">{data.suggestions.map(s => <li key={sk(s)}><label><input type="checkbox" checked={picked.has(sk(s))} onChange={e => { const n = new Set(picked); if (e.target.checked) n.add(sk(s)); else n.delete(sk(s)); setPicked(n); }} />
                <span className="dot" style={{ background: color(s.member) }} />{s.member}<span className="grow">{s.description}</span><b>{formatMoney(s.amountMinor, s.currency)}</b></label></li>)}</ul>
              <div className="row-actions"><button className="small" onClick={() => setPicked(new Set(data.suggestions.map(sk)))}>Отметить все</button>
                <button className="primary small" disabled={busy || !picked.size} onClick={() => act({ action: 'accrue', period, keys: [...picked] }, () => setPicked(new Set()))}>Начислить отмеченные</button></div>
            </> : <p className="hint">Новых начислений по данным месяца нет.</p>}
          <details><summary>Разовое начисление</summary>
            <form className="fields three" onSubmit={e => { e.preventDefault(); act({ action: 'unit.oneoff', period, ...oneoff }, () => setOneoff({ ...oneoff, amount: '', description: '' })); }}>
              <label>Участник<select value={oneoff.member} onChange={e => setOneoff({ ...oneoff, member: e.target.value })}>{NAMES.map(n => <option key={n}>{n}</option>)}</select></label>
              <label>Сумма, ฿<input inputMode="decimal" required value={oneoff.amount} onChange={e => setOneoff({ ...oneoff, amount: e.target.value })} /></label>
              <label>За что<input required maxLength={300} value={oneoff.description} onChange={e => setOneoff({ ...oneoff, description: e.target.value })} /></label>
              <button className="small" disabled={busy}>Добавить</button></form></details>
        </section>

        <section className="panel"><h2>Записать выплату</h2>
          <form className="fields three" onSubmit={e => { e.preventDefault(); act({ action: 'payment.create', ...pay }, () => setPay({ id: crypto.randomUUID(), member: pay.member, amount: '', paidAt: bangkokToday(), note: '' })); }}>
            <label>Кому<select value={pay.member} onChange={e => setPay({ ...pay, member: e.target.value })}>{NAMES.map(n => <option key={n}>{n}</option>)}</select></label>
            <label>Сумма, ฿<input inputMode="decimal" required placeholder="можно частично" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></label>
            <label>Дата<input type="date" required max={bangkokToday()} value={pay.paidAt} onChange={e => setPay({ ...pay, paidAt: e.target.value })} /></label>
            <label className="span3">Комментарий<input maxLength={500} value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} /></label>
            <button className="primary small" disabled={busy}>Записать выплату</button></form>
          <p className="hint">Выплата уменьшает остаток участника. Ошибочную запись можно аннулировать с причиной, удаления нет.</p>
        </section>
      </div>

      <section className="panel"><h2>Начисления · {monthLabel(period)}</h2>
        {data.units.length ? <ul className="ledger">{[...data.units].sort((a, b) => a.member.localeCompare(b.member)).map(u => <li key={u.id} className={u.voidedAt ? 'void' : ''}>
          <span className="dot" style={{ background: color(u.member) }} /><span>{u.member}</span><span className="grow">{u.description}{u.voidedAt && <small> · аннулировано: {u.voidReason}</small>}</span>
          <b>{formatMoney(u.amountMinor, u.currency)}</b>{!u.voidedAt && <button className="small" disabled={busy} onClick={() => voidRow('unit.void', u.id)}>Аннулировать</button>}</li>)}</ul>
          : <p className="hint">За месяц начислений нет.</p>}
      </section>

      <section className="panel"><h2>Выплаты · все</h2>
        {data.payments.length ? <ul className="ledger">{[...data.payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt)).map(p => <li key={p.id} className={p.voidedAt ? 'void' : ''}>
          <span className="ledger-date">{dayLabel(p.paidAt)}</span><span className="dot" style={{ background: color(p.member) }} /><span>{p.member}</span>
          <span className="grow">{p.note}{p.voidedAt && <small> · аннулировано: {p.voidReason}</small>}</span><b>{formatMoney(p.amountMinor, p.currency)}</b>
          {!p.voidedAt && <button className="small" disabled={busy} onClick={() => voidRow('payment.void', p.id)}>Аннулировать</button>}</li>)}</ul>
          : <p className="hint">Выплат пока нет.</p>}
      </section>

      <section className="panel"><h2>Тарифы</h2>
        {activeRules.length ? <ul className="ledger">{activeRules.map(r => <li key={r.id}><span className="dot" style={{ background: color(r.member) }} /><span>{r.member}</span>
          <span className="grow">{RATE_MODEL_LABELS[r.model as keyof typeof RATE_MODEL_LABELS] ?? r.model} · с {dayLabel(r.validFrom)}{r.note ? ' · ' + r.note : ''}</span><b>{formatMoney(r.amountMinor, r.currency)}</b>
          <button className="small" disabled={busy} onClick={() => { if (window.confirm('Отключить тариф? Уже сделанные начисления останутся.')) act({ action: 'rule.deactivate', id: r.id, revision: r.revision, reason: 'отключён вручную' }); }}>Отключить</button></li>)}</ul>
          : <p className="hint">Активных тарифов нет.</p>}
        <form className="fields three" onSubmit={e => { e.preventDefault(); act({ action: 'rule.create', ...rule }, () => setRule({ ...rule, amount: '', note: '' })); }}>
          <label>Участник<select value={rule.member} onChange={e => setRule({ ...rule, member: e.target.value })}>{NAMES.map(n => <option key={n}>{n}</option>)}</select></label>
          <label>Модель<select value={rule.model} onChange={e => setRule({ ...rule, model: e.target.value })}>{RATE_MODELS.filter(m => m !== 'one_off').map(m => <option key={m} value={m}>{RATE_MODEL_LABELS[m]}</option>)}</select></label>
          <label>Ставка, ฿<input inputMode="decimal" required value={rule.amount} onChange={e => setRule({ ...rule, amount: e.target.value })} /></label>
          <label>Действует с<input type="date" required value={rule.validFrom} onChange={e => setRule({ ...rule, validFrom: e.target.value })} /></label>
          <label className="span2">Заметка<input maxLength={500} value={rule.note} onChange={e => setRule({ ...rule, note: e.target.value })} /></label>
          <button className="small" disabled={busy}>Добавить тариф</button></form>
        <p className="hint">Совместный ролик начисляется только основному ведущему. Несколько съёмок в один день считаются одним съёмочным днём.</p>
      </section>
    </>}
  </div>;
}

/* ───────────── Higgsfield AI studio ───────────── */

type Project = { id: string; contentId: string | null; title: string; brief: string; prompt: string; motionPrompt: string; approvedAssetId: string | null; updatedAt: string; revision: number };
type Asset = { id: string; projectId: string; kind: 'note' | 'reference' | 'image' | 'video'; url: string; text: string; source: string; expiresAt: string | null; storageKey: string | null; mime: string | null; size: number | null; fileName: string | null; createdAt: string };
type Job = { id: string; projectId: string; kind: string; endpoint: string; status: string; resultUrl: string | null; error: string | null; createdAt: string; updatedAt: string };
type Preset = { endpoint: string; kind: 'image' | 'video'; label: string };
type Ai = { configured: boolean; storage: boolean; linkSigning: boolean; presets: Preset[]; settings: { monthlyJobLimit: number }; settingsRevision: number; usedThisMonth: number; projects: Project[]; assets: Asset[]; jobs: Job[] };
const JOB_LABEL: Record<string, string> = { submitting: 'отправляется', queued: 'в очереди', in_progress: 'генерируется', completed: 'готово', failed: 'ошибка', nsfw: 'отклонено фильтром', canceled: 'отменено', error: 'ошибка' };

export function AiStudio({ items, canEdit, canRead = canEdit }: { items: ContentItem[]; canEdit: boolean; canRead?: boolean }) {
  const { data, error, reload, setError } = useLoad<Ai>(canRead ? '/api/ai' : null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [limit, setLimit] = useState<string | null>(null);

  if (!canRead) return <div className="panel placeholder"><h2>Только для команды</h2><p className="hint">AI-проекты содержат внутренние материалы. Войдите с аккаунтом, которому выдан доступ.</p></div>;
  async function post(json: Record<string, unknown>) {
    setBusy(true); setError('');
    try { const r = await api<Record<string, unknown>>('/api/ai', { method: 'POST', json }); await reload(); return r; }
    catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }
  const project = data?.projects.find(p => p.id === openId) ?? null;
  const contentTitle = (id: string | null) => items.find(i => i.id === id)?.title;

  return <div className="ai-studio"><fieldset className="bare" disabled={!canEdit}>
    {!canEdit && <p className="hint">Только просмотр: менять AI-проекты может администратор.</p>}
    <section className="panel ai-status">
      <div><b>Higgsfield API</b> <span className={'pill ' + (data?.configured ? 's-approved' : '')}>{data ? data.configured ? 'Ключ на сервере есть' : 'Не подключено' : '…'}</span></div>
      {data && <span className="hint">{data.storage ? 'Файлы хранятся в закрытом хранилище проекта. ' : 'Хранилище не подключено: файлы добавляются ссылками. '}{data.configured ? `Запусков в этом месяце: ${data.usedThisMonth} из ${data.settings.monthlyJobLimit}.` : 'Генерации недоступны и не тарифицируются. Ручная работа с промптами, референсами и готовыми файлами работает.'}</span>}
      {data && <form className="limit" onSubmit={async e => { e.preventDefault(); if (limit === null) return; if (await post({ action: 'settings.save', settings: { monthlyJobLimit: Number(limit) }, revision: data.settingsRevision })) setLimit(null); }}>
        <label>Лимит запусков в месяц<input type="number" min={0} max={1000} value={limit ?? data.settings.monthlyJobLimit} onChange={e => setLimit(e.target.value)} /></label>
        {limit !== null && <button className="small" disabled={busy}>Сохранить</button>}</form>}
    </section>
    {error && <p role="alert" className="error">{error}</p>}
    {!data ? <div className="skeleton">Загружаем…</div> : <div className="ai-grid">
      <section className="panel"><h2>Проекты · {data.projects.length}</h2>
        <form className="new-project" onSubmit={async e => { e.preventDefault(); const r = await post({ action: 'project.create', id: crypto.randomUUID(), title: newTitle, contentId: newContent || null }); if (r) { setNewTitle(''); setOpenId(r.id as string); } }}>
          <input required maxLength={200} placeholder="Название вставки" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
          <select value={newContent} onChange={e => setNewContent(e.target.value)} aria-label="Ролик"><option value="">Без ролика</option>{items.filter(i => i.productionStatus !== 'cancelled').map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select>
          <button className="small primary" disabled={busy}>Создать</button></form>
        <ul className="rows">{data.projects.map(p => <li key={p.id}><button className={'row ' + (p.id === openId ? 'chosen' : '')} onClick={() => setOpenId(p.id)}>
          <span className="row-main">{p.title}<small>{contentTitle(p.contentId) ?? 'без ролика'} · {data.assets.filter(a => a.projectId === p.id).length} материалов{p.approvedAssetId ? ' · кадр утверждён' : ''}</small></span></button></li>)}</ul>
        {!data.projects.length && <p className="hint">Проектов пока нет.</p>}
      </section>
      {project ? <ProjectView key={project.id + project.revision} project={project} ai={data} items={items} busy={busy} post={post} onRefreshJob={id => post({ action: 'job.refresh', id })} onUploaded={reload} />
        : <section className="panel placeholder"><h2>Как это работает</h2><p className="hint">1. Создайте проект для вставки и привяжите ролик. 2. Опишите задачу, скопируйте промпт в ChatGPT или Higgsfield вручную и вставьте результат. 3. Добавьте изображения и утвердите кадр. 4. Видео запускается только с утверждённого кадра, после подтверждения и в пределах лимита.</p></section>}
    </div>}
  </fieldset></div>;
}

function ProjectView({ project, ai, items, busy, post, onRefreshJob, onUploaded }: { project: Project; ai: Ai; items: ContentItem[]; busy: boolean; post: (j: Record<string, unknown>) => Promise<Record<string, unknown> | null>; onRefreshJob: (id: string) => void; onUploaded: () => void }) {
  const [p, setP] = useState(project);
  const [asset, setAsset] = useState({ kind: 'note', url: '', text: '' });
  const [endpoint, setEndpoint] = useState(ai.presets[0]?.endpoint ?? '');
  const [videoOpts, setVideoOpts] = useState({ duration: '5', resolution: '720p' });
  const [copied, setCopied] = useState(false);
  const [upload, setUpload] = useState<{ file: File | null; kind: string; text: string; busy: boolean; error: string }>({ file: null, kind: 'reference', text: '', busy: false, error: '' });
  async function sendFile(e: React.FormEvent) {
    e.preventDefault(); if (!upload.file) return;
    const fd = new FormData();
    fd.set('file', upload.file); fd.set('projectId', project.id); fd.set('id', crypto.randomUUID()); fd.set('kind', upload.kind); fd.set('text', upload.text);
    setUpload({ ...upload, busy: true, error: '' });
    try {
      const r = await fetch('/api/ai/files', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || 'Не удалось загрузить');
      setUpload({ file: null, kind: upload.kind, text: '', busy: false, error: '' }); (e.target as HTMLFormElement).reset(); onUploaded();
    } catch (err) { setUpload(u => ({ ...u, busy: false, error: (err as Error).message })); }
  }
  const fileUrl = (a: Asset, download = false) => `/api/ai/files?id=${encodeURIComponent(a.id)}${download ? '&download=1' : ''}`;
  const assets = ai.assets.filter(a => a.projectId === project.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const jobs = ai.jobs.filter(j => j.projectId === project.id);
  const approved = assets.find(a => a.id === project.approvedAssetId);
  const preset = ai.presets.find(x => x.endpoint === endpoint);
  const dirty = p.title !== project.title || p.brief !== project.brief || p.prompt !== project.prompt || p.motionPrompt !== project.motionPrompt || p.contentId !== project.contentId;
  const chatgptText = useMemo(() => [`Задача: ${p.title}`, p.brief && `Бриф: ${p.brief}`, p.prompt && `Промпт изображения: ${p.prompt}`, p.motionPrompt && `Движение для видео: ${p.motionPrompt}`,
    'Правила: без названия жилого проекта, без выдуманных цен и характеристик.'].filter(Boolean).join('\n\n'), [p]);

  async function launch() {
    const isVideo = preset?.kind === 'video';
    const prompt = isVideo ? p.motionPrompt : p.prompt;
    if (!prompt.trim()) { window.alert(isVideo ? 'Заполните описание движения' : 'Заполните промпт изображения'); return; }
    if (!window.confirm(`Платный запуск Higgsfield: ${preset?.label ?? endpoint}. Стоимость API заранее не сообщает, списание по тарифу вашего аккаунта. Запустить?`)) return;
    await post({ action: 'job.submit', confirm: true, projectId: project.id, idempotencyKey: crypto.randomUUID(), endpoint,
      params: isVideo ? { prompt, duration: videoOpts.duration, resolution: videoOpts.resolution } : { prompt } });
  }

  return <section className="panel project">
    <form className="edit-fields" onSubmit={async e => { e.preventDefault(); await post({ action: 'project.update', ...p }); }}>
      <div className="fields two"><label>Название<input required maxLength={200} value={p.title} onChange={e => setP({ ...p, title: e.target.value })} /></label>
        <label>Ролик<select value={p.contentId ?? ''} onChange={e => setP({ ...p, contentId: e.target.value || null })}><option value="">Без ролика</option>{items.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label></div>
      <label>Бриф: что нужно и зачем<textarea rows={3} maxLength={5000} value={p.brief} onChange={e => setP({ ...p, brief: e.target.value })} /></label>
      <label>Промпт изображения<textarea rows={3} maxLength={4000} value={p.prompt} onChange={e => setP({ ...p, prompt: e.target.value })} /></label>
      <label>Движение для видео<textarea rows={2} maxLength={4000} value={p.motionPrompt} onChange={e => setP({ ...p, motionPrompt: e.target.value })} /></label>
      <div className="form-actions"><button type="button" className="small" onClick={async () => { await navigator.clipboard.writeText(chatgptText).catch(() => {}); setCopied(true); }}>{copied ? 'Скопировано' : 'Скопировать для ChatGPT'}</button>
        <button className="primary small" disabled={busy || !dirty}>Сохранить</button></div>
    </form>

    <h3>Материалы</h3>
    <form className="fields three asset-form" onSubmit={async e => { e.preventDefault(); if (await post({ action: 'asset.add', projectId: project.id, id: crypto.randomUUID(), ...asset })) setAsset({ ...asset, url: '', text: '' }); }}>
      <label>Тип<select value={asset.kind} onChange={e => setAsset({ ...asset, kind: e.target.value })}><option value="note">Заметка / ответ ChatGPT</option><option value="reference">Референс</option><option value="image">Изображение</option><option value="video">Видео</option></select></label>
      <label className="span2">Ссылка https://<input type="url" value={asset.url} required={asset.kind === 'image' || asset.kind === 'video'} onChange={e => setAsset({ ...asset, url: e.target.value })} /></label>
      <label className="span3">Текст<textarea rows={2} maxLength={10000} value={asset.text} onChange={e => setAsset({ ...asset, text: e.target.value })} /></label>
      <button className="small" disabled={busy}>Добавить</button></form>
    {ai.storage && <form className="fields three asset-form" onSubmit={sendFile}>
      <label className="span2">Файл (JPEG, PNG, WebP до 20 МБ; MP4, MOV, WebM до 95 МБ)<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={e => setUpload({ ...upload, file: e.target.files?.[0] ?? null, error: '' })} /></label>
      <label>Как сохранить<select value={upload.kind} onChange={e => setUpload({ ...upload, kind: e.target.value })}><option value="reference">Референс</option><option value="image">Изображение (можно утвердить кадр)</option><option value="video">Видео-результат</option></select></label>
      <label className="span3">Комментарий<input maxLength={10000} value={upload.text} onChange={e => setUpload({ ...upload, text: e.target.value })} /></label>
      <button className="small" disabled={upload.busy || !upload.file}>{upload.busy ? 'Загружаем…' : 'Загрузить файл'}</button>
      {upload.error && <p role="alert" className="error span3">{upload.error}</p>}</form>}
    {assets.length ? <ul className="assets">{assets.map(a => <li key={a.id} className={a.id === project.approvedAssetId ? 'approved' : ''}>
      <span className="pill">{({ note: 'заметка', reference: 'референс', image: 'изображение', video: 'видео' })[a.kind]}{a.source === 'higgsfield' ? ' · Higgsfield' : ''}</span>
      {a.storageKey ? <>
        {a.mime?.startsWith('image/') ? <a href={fileUrl(a)} target="_blank" rel="noreferrer"><img src={fileUrl(a)} alt="" loading="lazy" /></a>
          : a.mime?.startsWith('video/') ? <video src={fileUrl(a)} controls preload="metadata" /> : null}
        <span className="row-actions start"><a href={fileUrl(a)} target="_blank" rel="noreferrer">Открыть ↗</a><a href={fileUrl(a, true)}>Скачать</a>
          <small>{a.fileName}{a.size ? ` · ${(a.size / 1024 / 1024).toFixed(1).replace('.', ',')} МБ` : ''} · в хранилище</small></span></>
        : a.url && (a.kind === 'image' ? <a href={a.url} target="_blank" rel="noreferrer noopener"><img src={a.url} alt="" loading="lazy" /></a> : <a href={a.url} target="_blank" rel="noreferrer noopener">Открыть ↗</a>)}
      {a.text && <p>{a.text}</p>}
      {a.expiresAt && !a.storageKey && <small>ссылка провайдера действует до {fmtDate(a.expiresAt)}{ai.storage ? '' : ', сохраните файл на Диск'}</small>}
      {ai.storage && !a.storageKey && a.url && a.kind !== 'note' && <button className="small" disabled={busy} onClick={() => post({ action: 'asset.persist', id: a.id })}>Сохранить в хранилище</button>}
      {a.kind === 'image' && (a.id === project.approvedAssetId
        ? <button className="small" disabled={busy} onClick={() => post({ action: 'asset.approve', projectId: project.id, revision: project.revision, assetId: null })}>Снять утверждение</button>
        : <button className="small" disabled={busy} onClick={() => post({ action: 'asset.approve', projectId: project.id, revision: project.revision, assetId: a.id })}>Утвердить кадр</button>)}
    </li>)}</ul> : <p className="hint">Материалов пока нет.</p>}

    <h3>Генерация через API</h3>
    {!ai.configured ? <p className="hint">Не подключено: на сервере нет секрета HF_API_KEY (ключ Higgsfield целиком, «id:secret»). Запуски недоступны.</p> : <div className="launch">
      <label>Модель<select value={endpoint} onChange={e => setEndpoint(e.target.value)}>{ai.presets.map(x => <option key={x.endpoint} value={x.endpoint}>{x.label}</option>)}</select></label>
      {preset?.kind === 'video' && <>
        <label>Длительность<select value={videoOpts.duration} onChange={e => setVideoOpts({ ...videoOpts, duration: e.target.value })}>{['5', '10', '15'].map(v => <option key={v} value={v}>{v} с</option>)}</select></label>
        <label>Качество<select value={videoOpts.resolution} onChange={e => setVideoOpts({ ...videoOpts, resolution: e.target.value })}>{['480p', '720p', '1080p'].map(v => <option key={v}>{v}</option>)}</select></label>
        <p className="hint">{approved ? 'Кадр для видео: утверждённое изображение.' : 'Сначала утвердите изображение: видео без него не запускается.'}</p></>}
      <button className="primary small" disabled={busy || (preset?.kind === 'video' && !approved) || ai.usedThisMonth >= ai.settings.monthlyJobLimit} onClick={launch}>Запустить</button>
      {ai.usedThisMonth >= ai.settings.monthlyJobLimit && <p className="hint warn">{ai.settings.monthlyJobLimit === 0 ? 'Лимит запусков не задан.' : 'Лимит месяца исчерпан.'}</p>}
    </div>}
    {jobs.length > 0 && <ul className="ledger">{jobs.map(j => <li key={j.id}><span className="ledger-date">{fmtDate(j.createdAt)}</span><span className="grow">{j.endpoint}{j.error && <small> · {j.error}</small>}</span>
      <span className="pill">{JOB_LABEL[j.status] ?? j.status}</span>{['submitting', 'queued', 'in_progress'].includes(j.status) && <button className="small" disabled={busy} onClick={() => onRefreshJob(j.id)}>Проверить</button>}</li>)}</ul>}
  </section>;
}

/* ───────────── Settings: integrations and backup ───────────── */

type Integrations = {
  higgsfield: { configured: boolean }; storage: { connected: boolean; linkSigning: boolean };
  instagram: { configured: boolean; status: string; account: string | null; tokenExpiresAt: string | null; lastSyncAt: string | null; lastError: string | null; mediaCount: number;
    matched: { mediaId: string; contentId: string; permalink: string | null; likeCount: number | null; commentsCount: number | null }[];
    unmatched: { mediaId: string; permalink: string | null; caption: string | null; timestamp: string; day: string | null; likeCount: number | null; candidates: { id: string; title: string; primaryMember: string; plannedPublishDate: string | null; productionStatus: string; revision: number }[] }[] };
};

export function IntegrationsPanel({ canEdit, onContentChanged }: { canEdit: boolean; onContentChanged: () => void }) {
  const { data, error, reload, setError } = useLoad<Integrations>(canEdit ? '/api/integrations' : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [returned] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('instagram'));
  async function act(json: Record<string, unknown>, ok?: string) {
    setBusy(true); setError(''); setMsg('');
    try { const r = await api<{ synced?: number }>('/api/integrations', { method: 'POST', json }); setMsg(ok ?? (r.synced !== undefined ? `Получено публикаций: ${r.synced}` : 'Готово')); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const ig = data?.instagram;
  const returnedText = returned && ({ connected: 'Instagram подключён.', denied: 'Доступ в Instagram не выдан.', state: 'Сессия подключения устарела, попробуйте ещё раз.', error: 'Подключение не удалось, подробности ниже.', forbidden: 'Подключать может только редактор.' } as Record<string, string>)[returned];

  return <section className="panel"><h2>Интеграции</h2>
    {!canEdit ? <p className="hint">Статус интеграций видит редактор.</p> : !data ? (error ? <p role="alert" className="error">{error}</p> : <p className="hint">Загружаем…</p>) : <>
      <ul className="integrations">
        <li><b>Higgsfield AI</b><span className={'pill ' + (data.higgsfield.configured ? 's-approved' : '')}>{data.higgsfield.configured ? 'Ключ на сервере есть' : 'Не подключено'}</span>
          <small>{data.higgsfield.configured ? 'Ключ подключён. Вставки делаются в чате с Claude, вкладки в меню нет.' : 'Нужен секрет HF_API_KEY на сервере (ключ Higgsfield целиком). Ручная работа в студии доступна.'}</small></li>
        <li><b>Хранилище файлов AI</b><span className={'pill ' + (data.storage?.connected ? 's-approved' : '')}>{data.storage?.connected ? 'Подключено' : 'Не подключено'}</span>
          <small>{data.storage?.connected ? `Закрытое хранилище проекта: файлы открываются только участникам с доступом.${data.storage.linkSigning ? ' Подписанные ссылки для видео-запусков включены.' : ' Для запуска видео с загруженного кадра нужен секрет FILE_LINK_SECRET.'}` : 'Нужна привязка r2 BUCKET в настройках хостинга. Без неё файлы добавляются ссылками.'}</small></li>
        <li><b>Instagram</b><span className={'pill ' + (ig!.status === 'connected' ? 's-approved' : ig!.status === 'error' ? 's-changes_requested' : '')}>{!ig!.configured ? 'Не подключено' : ig!.status === 'connected' ? 'Подключено' : ig!.status === 'error' ? 'Ошибка' : 'Не подключено'}</span>
          <small>{!ig!.configured ? 'Нужны секреты IG_APP_ID, IG_APP_SECRET и TOKEN_ENCRYPTION_KEY и приложение Meta. Публикации отмечаются вручную в карточке ролика.'
            : ig!.status === 'connected' ? `Аккаунт ${ig!.account ?? ''}. Токен до ${fmtDate(ig!.tokenExpiresAt)}. Последняя синхронизация: ${fmtDate(ig!.lastSyncAt)}. Публикаций в базе: ${ig!.mediaCount}. Автоматически: при открытии этой страницы, не чаще раза в 6 часов (планировщик задач Sites проекту недоступен).`
              : 'Профессиональный аккаунт подключается через вход Instagram. Токен хранится только на сервере в зашифрованном виде.'}</small>
          {ig!.lastError && <small className="warn">Последняя ошибка: {ig!.lastError}</small>}
          {ig!.configured && <div className="row-actions">
            {ig!.status === 'connected' ? <><button className="small primary" disabled={busy} onClick={() => act({ action: 'instagram.sync' })}>Синхронизировать</button>
              <button className="small" disabled={busy} onClick={() => { if (window.confirm('Отключить Instagram? Токен будет удалён, сопоставления останутся.')) act({ action: 'instagram.disconnect' }, 'Отключено'); }}>Отключить</button></>
              : <a className="button small primary" href="/api/integrations/instagram/connect">Подключить Instagram</a>}</div>}
        </li>
      </ul>
      {returnedText && <p className="hint">{returnedText}</p>}
      {msg && <p className="ok">{msg}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {ig!.unmatched.length > 0 && <div className="ig-match"><h3>Сопоставить публикации · {ig!.unmatched.length}</h3>
        <p className="hint">Ролик станет «Опубликован» только после вашего подтверждения. Дата берётся из Instagram.</p>
        <ul>{ig!.unmatched.map(m => <li key={m.mediaId}>
          <div><a href={m.permalink ?? '#'} target="_blank" rel="noreferrer noopener">{m.day ? dayLabel(m.day) : m.timestamp}</a> <small>{(m.caption ?? '').slice(0, 90)}</small></div>
          <div className="row-actions">{m.candidates.length ? m.candidates.map(c => <button key={c.id} className="small" disabled={busy || (c.productionStatus !== 'approved')}
            title={c.productionStatus !== 'approved' ? 'Сначала согласуйте ролик' : ''}
            onClick={() => { if (window.confirm(`Отметить «${c.title}» опубликованным ${m.day ? dayLabel(m.day) : ''}?`)) act({ action: 'instagram.match', mediaId: m.mediaId, contentId: c.id, revision: c.revision }, 'Сопоставлено').then(onContentChanged); }}>
            {c.title} · {c.primaryMember} · {CONTENT_STATUS_LABELS[c.productionStatus as keyof typeof CONTENT_STATUS_LABELS] ?? c.productionStatus}</button>) : <small className="hint">Нет роликов в плане рядом с этой датой</small>}
            <button className="small" disabled={busy} onClick={() => act({ action: 'instagram.ignore', mediaId: m.mediaId }, 'Скрыто')}>Не наше / скрыть</button></div></li>)}</ul></div>}
    </>}
  </section>;
}

type RestoreReport = { dryRun: boolean; report: { table: string; inFile: number; existing: number; toInsert: number; invalid: number }[]; shootsBefore: number; shootsAfter?: number; toInsert?: number; inserted?: number };

export function BackupPanel({ canEdit, onRestored }: { canEdit: boolean; onRestored: () => void }) {
  const [file, setFile] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(dryRun: boolean) {
    setBusy(true); setError('');
    try { const r = await api<RestoreReport>('/api/backup', { method: 'POST', json: { dryRun, data: file } }); setReport(r); if (!dryRun) onRestored(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel"><h2>Экспорт и восстановление</h2>
    {!canEdit ? <p className="hint">Доступно редактору.</p> : <>
      <p className="hint">Полная копия: съёмки, ролики, история, версии, финансы, AI-проекты. Токены интеграций в файл не попадают.</p>
      <a className="button" href="/api/backup" download>Скачать полную копию (JSON)</a>
      <h3>Восстановить из файла</h3>
      <p className="hint">Добавляются только отсутствующие записи. Существующие данные, включая съёмки, не меняются и не удаляются. Подходит и старая копия съёмок.</p>
      <input type="file" accept="application/json,.json" aria-label="Файл копии" onChange={async e => {
        const f = e.target.files?.[0]; setReport(null); setError(''); if (!f) return;
        try { setFile(JSON.parse(await f.text())); setName(f.name); } catch { setFile(null); setError('Файл не похож на JSON'); }
      }} />
      {file !== null && <div className="row-actions"><span className="hint">{name}</span><button className="small" disabled={busy} onClick={() => run(true)}>Проверить</button>
        {report?.dryRun && (report.toInsert ?? 0) > 0 && <button className="small primary" disabled={busy} onClick={() => { if (window.confirm(`Добавить ${report.toInsert} записей? Существующие не изменятся.`)) run(false); }}>Восстановить</button>}</div>}
      {error && <p role="alert" className="error">{error}</p>}
      {report && <div className="table-wrap"><table className="mini"><thead><tr><th>Таблица</th><th>В файле</th><th>Уже есть</th><th>{report.dryRun ? 'Будет добавлено' : 'Добавлено'}</th><th>Ошибки</th></tr></thead>
        <tbody>{report.report.map(r => <tr key={r.table}><td>{r.table}</td><td>{r.inFile}</td><td>{r.existing}</td><td>{r.toInsert}</td><td>{r.invalid || ''}</td></tr>)}</tbody></table>
        <p className="hint">Съёмок до: {report.shootsBefore}{report.shootsAfter !== undefined ? `, после: ${report.shootsAfter}` : ''}.{report.dryRun && !report.toInsert ? ' Добавлять нечего.' : ''}</p></div>}
    </>}
  </section>;
}
