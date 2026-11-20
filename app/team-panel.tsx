'use client';
import { useCallback, useEffect, useState } from 'react';
import { SHOOT_TEAM } from '../lib/shoot-team';
import { api, type ClientAccess } from './workspace-types';

type Member = {
  id: string; email: string | null; displayName: string; memberName: string | null; role: 'admin' | 'reviewer' | 'viewer'; finance: number;
  status: 'invited' | 'active' | 'disabled'; note: string; firstSeenAt: string | null; lastSeenAt: string | null; updatedAt: string; updatedBy: string; revision: number;
};
type TeamData = { owner: { email: string; label: string }; members: Member[]; roles: Record<string, string>; hints: Record<string, string>; canGrantFinance: boolean };
type Draft = { id: string; revision?: number; displayName: string; email: string; memberName: string; role: Member['role']; finance: boolean; note: string };

const STATUS: Record<Member['status'], string> = { invited: 'Подготовлено, доступ не выдан', active: 'Доступ действует', disabled: 'Отключён' };
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('ru', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const blank = (): Draft => ({ id: crypto.randomUUID(), displayName: '', email: '', memberName: '', role: 'viewer', finance: false, note: '' });

/**
 * Team access (Settings). An entry is prepared without granting anything; access starts only after "Выдать доступ",
 * and only for someone Sites signs in with exactly that email. Sites' own access settings are not changed here.
 */
export function TeamPanel({ access }: { access: ClientAccess }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await api<TeamData>('/api/team')); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function post(json: Record<string, unknown>) {
    setBusy(true); setError('');
    try { await api('/api/team', { method: 'POST', json }); await load(); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!draft) return;
    const { revision, ...rest } = draft;
    if (await post({ action: revision === undefined ? 'create' : 'update', revision, ...rest, memberName: rest.memberName || null })) setDraft(null);
  }
  const edit = (m: Member) => setDraft({ id: m.id, revision: m.revision, displayName: m.displayName, email: m.email ?? '', memberName: m.memberName ?? '', role: m.role, finance: m.finance === 1, note: m.note });
  const self = (m: Member) => !!m.email && m.email === access.email;

  return <section className="panel team"><div className="panel-head"><h2>Команда и доступ</h2>
    {!draft && <button className="small" onClick={() => setDraft(blank())}>＋ Подготовить доступ</button>}</div>
    <p className="hint">Роль действует, только когда человек входит через Sites с этой же почтой и запись включена. Назначение ответственным в задачах доступа не даёт. Настройки доступа самого Sites здесь не меняются: если сайт закрыт, человека нужно отдельно пустить в Sites.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {data && <ul className="ledger team-list">
      <li><span className="grow"><b>Владелец</b><small> · {data.owner.email}</small></span><span className="pill s-approved">Полный доступ, всегда</span></li>
      {data.members.map(m => <li key={m.id}>
        <span className="grow"><b>{m.displayName}</b>{m.memberName && <small> · {m.memberName}</small>}<br />
          <small>{data.roles[m.role]}{m.finance ? ' · выплаты' : ''} · {m.email ?? 'адрес не подтверждён'}{m.email && (m.firstSeenAt ? ` · вход через Sites ${fmt(m.firstSeenAt)}` : ' · ещё не входил')}</small>
          {m.note && <><br /><small>{m.note}</small></>}</span>
        <span className={'pill ' + (m.status === 'active' ? 's-approved' : m.status === 'disabled' ? 's-cancelled' : '')}>{STATUS[m.status]}</span>
        {!self(m) || access.role === 'owner' ? <>
          <button className="small" disabled={busy} onClick={() => edit(m)}>Изменить</button>
          {m.status !== 'active'
            ? <button className="small primary" disabled={busy || !m.email} title={m.email ? undefined : 'Сначала укажите подтверждённую почту'}
              onClick={() => { if (window.confirm(`Выдать доступ «${data.roles[m.role]}»${m.finance ? ' с выплатами' : ''} для ${m.email}? Он начнёт действовать при входе через Sites с этой почтой.`)) post({ action: 'activate', id: m.id, revision: m.revision }); }}>Выдать доступ</button>
            : <button className="small" disabled={busy} onClick={() => post({ action: 'disable', id: m.id, revision: m.revision })}>Отключить</button>}
        </> : <small className="hint">это вы</small>}
      </li>)}
      {!data.members.length && <li><span className="hint">Других участников с доступом нет. Можно подготовить запись заранее: без почты и без «Выдать доступ» она ничего не открывает.</span></li>}
    </ul>}
    {draft && data && <form className="edit-fields team-form" onSubmit={save}>
      <div className="fields two">
        <label>Имя<input required maxLength={100} value={draft.displayName} onChange={e => setDraft({ ...draft, displayName: e.target.value })} /></label>
        <label>Участник команды (для «мои задачи»)<select value={draft.memberName} onChange={e => setDraft({ ...draft, memberName: e.target.value })}>
          <option value="">Не связан</option>{SHOOT_TEAM.map(([n]) => <option key={n}>{n}</option>)}</select></label>
      </div>
      <label>Почта, с которой человек входит в Sites (необязательно)<input type="email" maxLength={254} placeholder="Оставьте пустым, если адрес не подтверждён" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} /></label>
      {!draft.email.trim() && <p className="hint warn">Адрес не подтверждён: запись сохранится как подготовленная, доступ по ней выдать нельзя.</p>}
      <fieldset className="chips"><legend>Роль</legend>
        {(['admin', 'reviewer', 'viewer'] as const).map(r => <label key={r} className={'chip ' + (draft.role === r ? 'on' : '')} title={data.hints[r]}>
          <input type="radio" name="role" checked={draft.role === r} onChange={() => setDraft({ ...draft, role: r })} />{data.roles[r]}</label>)}
      </fieldset>
      <p className="hint">{data.hints[draft.role]}</p>
      <label className="check"><input type="checkbox" checked={draft.finance} disabled={!data.canGrantFinance} onChange={e => setDraft({ ...draft, finance: e.target.checked })} /> Доступ к выплатам (отдельное разрешение)</label>
      <label>Заметка<input maxLength={1000} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
      {draft.revision !== undefined && <p className="hint">Если сменить почту, действующий доступ будет приостановлен до повторной выдачи.</p>}
      <div className="form-actions"><button type="button" disabled={busy} onClick={() => setDraft(null)}>Отмена</button><button className="primary" disabled={busy}>{draft.revision === undefined ? 'Сохранить без выдачи доступа' : 'Сохранить'}</button></div>
    </form>}
  </section>;
}
