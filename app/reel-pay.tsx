'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, RotateCcw, Wallet, X } from 'lucide-react';
import { SHOOT_TEAM } from '../lib/shoot-team';
import { emptyReelPay, reelPayRows, reelPayTotal, type ReelPayStore } from '../lib/reel-pay';
import { Finance } from './workspace-panels';
import { api, type ContentItem } from './workspace-types';

type Data = { store: ReelPayStore; revision: number; updatedAt: string | null; updatedBy: string | null };
const color = (name: string) => SHOOT_TEAM.find(t => t[0] === name)?.[2] ?? '#9b9a97';

/**
 * Small side card in the content plan: «Осталось оплатить N рилс». Finance permission only (the API checks again).
 * Counts are kept by hand: shot is counted from the plan and can be corrected, paid is entered by the owner.
 */
export function ReelPayWidget({ items, canEdit }: { items: ContentItem[]; canEdit: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api<Data>('/api/finance?view=reels')); setError(''); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  const rows = useMemo(() => reelPayRows(items, data?.store ?? emptyReelPay()), [items, data]);
  const total = reelPayTotal(rows);
  const owed = rows.filter(r => r.remaining > 0);

  return <section className="pay-card" aria-label="Оплата рилс">
    <div className="pay-head"><Wallet size={15} aria-hidden /><span>Оплата съёмок</span></div>
    {error ? <p className="hint">{error}</p> : !data ? <p className="hint">Считаем…</p> : <>
      <div className="pay-big"><strong>{total}</strong><span>{total === 0 ? 'всё оплачено' : 'рилс осталось оплатить'}</span></div>
      {owed.length > 0 && <ul className="pay-mini">{owed.map(r => <li key={r.member}><i className="dot" style={{ background: color(r.member) }} />{r.member}<b>{r.remaining}</b></li>)}</ul>}
    </>}
    <button type="button" className="pay-more" onClick={() => setOpen(true)} disabled={!data}>Подробнее <ChevronRight size={14} /></button>
    {open && data && <ReelPayDrawer data={data} items={items} canEdit={canEdit} onClose={() => setOpen(false)} onSaved={d => setData(d)} />}
  </section>;
}

function ReelPayDrawer({ data, items, canEdit, onClose, onSaved }: { data: Data; items: ContentItem[]; canEdit: boolean; onClose: () => void; onSaved: (d: Data) => void }) {
  const [store, setStore] = useState<ReelPayStore>(data.store);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const rows = reelPayRows(items, store);
  const dirty = JSON.stringify(store) !== JSON.stringify(data.store);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const num = (v: string) => Math.max(0, Math.min(100_000, Math.round(Number(v) || 0)));
  const setPaid = (m: string, v: string) => setStore(s => ({ ...s, paid: { ...s.paid, [m]: num(v) } }));
  const setShot = (m: string, v: string) => setStore(s => ({ ...s, shotOverride: { ...s.shotOverride, [m]: num(v) } }));
  const resetShot = (m: string) => setStore(s => { const o = { ...s.shotOverride }; delete o[m]; return { ...s, shotOverride: o }; });
  async function save() {
    setBusy(true); setMsg('');
    try {
      const r = await api<{ store: ReelPayStore; revision: number }>('/api/finance', { method: 'POST', json: { action: 'reels.save', store, revision: data.revision } });
      onSaved({ ...data, store: r.store, revision: r.revision }); setMsg('Сохранено');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const sum = (k: 'shot' | 'paid' | 'remaining') => rows.reduce((a, r) => a + r[k], 0);
  return <div className="drawer-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="drawer wide" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <div className="drawer-head"><div><div className="eyebrow">Оплата съёмок</div><h2 id="pay-title">Осталось оплатить: {sum('remaining')}</h2></div>
        <button className="icon-btn" aria-label="Закрыть" disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <p className="hint">«Снято» считается само: Reels основного ведущего на этапе «Снято» и дальше, за всё время, без отменённых. Если считаете иначе, впишите своё число. «Оплачено» вы ведёте сами. Деньги здесь не записываются.</p>
      <div className="table-wrap"><table className="ntable pay-table">
        <thead><tr><th>Участник</th><th>Снято</th><th>Оплачено</th><th>Осталось</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.member}>
          <td><i className="dot" style={{ background: color(r.member) }} />{r.member}</td>
          <td>{canEdit ? <span className="num-edit"><input type="number" min={0} aria-label={`Снято, ${r.member}`} value={r.shot} onChange={e => setShot(r.member, e.target.value)} />
            {r.overridden && <button type="button" className="icon-btn" title={`Вернуть автоподсчёт: ${r.shotAuto}`} aria-label="Вернуть автоподсчёт" onClick={() => resetShot(r.member)}><RotateCcw size={13} /></button>}</span> : r.shot}
            {r.overridden && <small className="auto"> авто {r.shotAuto}</small>}</td>
          <td>{canEdit ? <input type="number" min={0} aria-label={`Оплачено, ${r.member}`} value={r.paid} onChange={e => setPaid(r.member, e.target.value)} /> : r.paid}</td>
          <td className={r.remaining ? 'due' : ''}>{r.remaining}</td></tr>)}</tbody>
        <tfoot><tr><td>Всего</td><td>{sum('shot')}</td><td>{sum('paid')}</td><td>{sum('remaining')}</td></tr></tfoot>
      </table></div>
      {canEdit && <div className="form-actions"><span className="hint">{msg || (data.updatedAt ? `Изменено ${new Date(data.updatedAt).toLocaleString('ru', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${data.updatedBy}` : '')}</span>
        <button type="button" disabled={busy} onClick={onClose}>Закрыть</button><button type="button" className="primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</button></div>}
      <details className="money"><summary>Тарифы и выплаты в деньгах</summary><Finance /></details>
    </section>
  </div>;
}
