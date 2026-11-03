'use client';
import { useId, useState, type MouseEvent } from 'react';
import { conflictingShoots, suggestRescheduleDates, validateRescheduleDate, type RescheduleShoot } from '../lib/reschedule-shoot';

export default function ReschedulePanel({ shoot, rows, now, busy, onMove }: { shoot: RescheduleShoot; rows: RescheduleShoot[]; now: Date; busy: boolean; onMove: (date: string) => void }) {
  const [customDate, setCustomDate] = useState('');
  const fieldId = useId();
  const suggestions = suggestRescheduleDates(shoot, rows, now);
  const error = customDate ? validateRescheduleDate(customDate, shoot, now) : null;
  const overlaps = customDate && !error ? conflictingShoots({ ...shoot, date: customDate }, rows) : [];
  const dateLabel = (date: string) => new Intl.DateTimeFormat('ru', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00+07:00`));
  function choose(date: string, event: MouseEvent<HTMLButtonElement>) {
    if (event.currentTarget.form && !event.currentTarget.form.reportValidity()) return;
    onMove(date);
  }
  return <section className="reschedule-panel" aria-labelledby={fieldId + '-heading'}>
    <h3 id={fieldId + '-heading'}>Перенести съёмку на другой день?</h3>
    <p>Выберите новую дату. Время {shoot.time}, участники и подготовка сохранятся, статус станет «Запланировано».</p>
    {suggestions.length ? <><span className="reschedule-label">Нет пересечений с другими съёмками участников</span><div className="reschedule-suggestions">{suggestions.map(date => <button type="button" key={date} disabled={busy} onClick={event => choose(date, event)}><b>{dateLabel(date)}</b><span>Перенести на этот день →</span></button>)}</div></> : <p>В ближайшие 30 дней не удалось подобрать свободный день. Можно выбрать дату вручную или изменить время съёмки.</p>}
    <div className="reschedule-custom"><label htmlFor={fieldId}>Или выберите другую дату<input id={fieldId} type="date" value={customDate} disabled={busy} onChange={event => setCustomDate(event.target.value)} /></label><button type="button" className="primary" disabled={busy || !customDate || !!error} onClick={event => choose(customDate, event)}>{busy ? 'Сохраняем…' : overlaps.length ? 'Всё равно перенести' : 'Перенести на выбранную дату'}</button></div>
    {error && <p className="reschedule-warning" role="status">{error}</p>}
    {!error && overlaps.length > 0 && <p className="reschedule-warning" role="status">В это время у участников уже есть другие съёмки. При переносе расписание будет пересекаться.</p>}
    <p className="reschedule-note">Если перенос не нужен, нажмите «Отменить без переноса» внизу формы.</p>
  </section>;
}
