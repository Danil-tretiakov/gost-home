'use client';
import { appleCalendarSubscriptionUrl } from '../lib/calendar-links';

export default function AddToCalendar({ id }: { id: string }) {
  function openCalendar() {
    window.location.assign(appleCalendarSubscriptionUrl(window.location.origin, id));
  }
  return <section className="invite-add">
    <button type="button" className="primary invite-button" onClick={openCalendar}>＋ ДОБАВИТЬ В КАЛЕНДАРЬ</button>
    <p className="invite-calendar-type">Apple Календарь · подписка на эту съёмку</p>
    <p className="invite-reminder">◷ Напоминание за 24 часа при включённых уведомлениях календаря</p>
    <a className="invite-download" href={`/events/${encodeURIComponent(id)}/calendar.ics`}>Скачать событие (.ics)</a>
  </section>;
}
