'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { api } from './workspace-types';

export type NoteItem = { key: string; level: 'urgent' | 'warn' | 'info'; title: string; detail: string; target: { type: 'task' | 'content' | 'ai' | 'settings' | 'shoot'; id?: string }; mine: boolean; read: boolean };

/** In-app notifications. Read from our own server only; no browser permission, no messages sent. */
export function NotificationBell({ onOpen, refreshKey }: { onOpen: (n: NoteItem) => void; refreshKey: unknown }) {
  const [data, setData] = useState<{ items: NoteItem[]; unread: number } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => { try { setData(await api('/api/notifications')); } catch { setData(null); } }, []);
  useEffect(() => { Promise.resolve().then(load); const t = window.setInterval(load, 5 * 60_000); return () => window.clearInterval(t); }, [load, refreshKey]);
  async function markRead(keys: string[]) {
    if (!keys.length) return;
    setData(d => d && { items: d.items.map(n => keys.includes(n.key) ? { ...n, read: true } : n), unread: d.items.filter(n => !n.read && !keys.includes(n.key)).length });
    await api('/api/notifications', { method: 'POST', json: { keys } }).catch(() => load());
  }
  const items = data?.items ?? [];
  return <div className="bell">
    <button className="nav" aria-expanded={open} onClick={() => setOpen(!open)} title="Уведомления">
      <span className="nav-icon" aria-hidden><Bell size={17} strokeWidth={1.8} /></span><span className="nav-label">Уведомления</span>{!!data?.unread && <em>{data.unread}</em>}</button>
    {open && <div className="bell-panel" role="dialog" aria-label="Уведомления">
      <div className="bell-head"><b>Уведомления</b>
        <button className="small" disabled={!items.some(n => !n.read)} onClick={() => markRead(items.filter(n => !n.read).map(n => n.key))}>Прочитано всё</button>
        <button className="icon-btn" aria-label="Закрыть" onClick={() => setOpen(false)}><X size={16} /></button></div>
      {data === null ? <p className="hint">Уведомления недоступны.</p> : !items.length ? <p className="hint">Ничего срочного.</p> :
        <ul>{items.map(n => <li key={n.key} className={'note l-' + n.level + (n.read ? ' read' : '')}>
          <button onClick={() => { markRead([n.key]); setOpen(false); onOpen(n); }}><b>{n.title}</b><small>{n.detail}</small></button></li>)}</ul>}
      <p className="hint">Только внутри сайта: письма и push не отправляются.</p>
    </div>}
  </div>;
}
