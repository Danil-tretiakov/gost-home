'use client';
import { useState } from 'react';

export default function ShareEvent({ id, title }: { id: string; title: string }) {
  const [show, setShow] = useState(false);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [sharing, setSharing] = useState(false);
  function showLink() {
    const link = new URL(`/events/${encodeURIComponent(id)}`, window.location.origin).href;
    setUrl(link);
    setShow(true);
    setMessage('');
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Ссылка скопирована — можно отправить её в чат.');
    } catch {
      setMessage('Выделите ссылку ниже и скопируйте её вручную.');
    }
  }
  async function shareLink() {
    if (!navigator.share) return copyLink();
    setSharing(true);
    try {
      await navigator.share({ title: `Gost Home · ${title}`, text: 'Приглашение на съёмку Gost Home. Добавьте событие в свой календарь.', url });
      setMessage('');
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setMessage('Не удалось открыть меню. Можно скопировать ссылку ниже.');
    } finally { setSharing(false); }
  }
  return <div className="share-event">
    <button type="button" className="share-open" onClick={showLink} aria-expanded={show}>↗ Поделиться событием</button>
    {show && <div className="share-panel">
      <p>По ссылке откроются детали съёмки и кнопка подписки в Apple Календаре.</p>
      <label>Ссылка на событие<input readOnly value={url} onFocus={e => e.currentTarget.select()} /></label>
      <div className="share-actions"><button type="button" onClick={copyLink}>Копировать ссылку</button><button type="button" disabled={sharing} onClick={shareLink}>Отправить…</button><a href={`/events/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer">Открыть</a></div>
      <p role="status" aria-live="polite">{message}</p>
    </div>}
  </div>;
}
