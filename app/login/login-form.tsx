'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';

const RULE = 'Не короче 8 символов, английские буквы и цифры';
const okPassword = (s: string) => s.length >= 8 && /[A-Za-z]/.test(s) && /\d/.test(s);
const readSetup = () => new URLSearchParams(window.location.hash.slice(1)).get('setup') ?? '';
const noop = () => () => {};

/** Password sign-in. With #setup=<token> in the address (opened on the Mac) it sets the owner password first. */
export default function LoginForm({ configured }: { configured: boolean }) {
  const token = useSyncExternalStore(noop, readSetup, () => '');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = !!token;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (setup && !okPassword(password)) { setError(RULE); return; }
    if (setup && password !== repeat) { setError('Пароли не совпадают'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setup ? { action: 'setup', token, password } : { action: 'login', password }) });
      const d = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(d.error || 'Не удалось войти');
      window.location.replace('/'); // full reload so the page is rendered with the new cookie; also drops the setup token from the address
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <span className="logo" aria-hidden>G</span>
    <h1>GOST HOME</h1>
    <p className="hint">{setup ? 'Придумайте пароль владельца' : 'Вход для владельца'}</p>
    {!setup && !configured && <p className="hint">Пароль ещё не задан. Ссылку для первого входа откроет Claude на вашем Mac.</p>}
    <label>Пароль<input type="password" autoComplete={setup ? 'new-password' : 'current-password'} required autoFocus value={password} onChange={e => setPassword(e.target.value)} /></label>
    {setup && <label>Ещё раз<input type="password" autoComplete="new-password" required value={repeat} onChange={e => setRepeat(e.target.value)} /></label>}
    {setup && <p className="hint">{RULE}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <button className="primary" disabled={busy || !password}>{busy ? 'Сохраняем…' : setup ? 'Сохранить и войти' : 'Войти'}</button>
    <Link className="link-button" href="/">← На сайт без входа</Link>
  </form></main>;
}
