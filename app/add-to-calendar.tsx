import { headers } from 'next/headers';
import { appleCalendarSubscriptionUrl } from '../lib/calendar-links';

export default async function AddToCalendar({ id }: { id: string }) {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host')?.split(',')[0].trim() || requestHeaders.get('host');
  const origin = host ? `https://${host}` : 'https://gost-home-shoots.danil-tretiakov.chatgpt.site';
  const subscriptionUrl = appleCalendarSubscriptionUrl(origin, id);
  return <section className="invite-add">
    <a className="primary invite-button" href={subscriptionUrl}>＋ ДОБАВИТЬ В КАЛЕНДАРЬ</a>
    <p className="invite-calendar-type">Apple Календарь · подписка на эту съёмку</p>
    <p className="invite-reminder">◷ Напоминание за 24 часа при включённых уведомлениях календаря</p>
    <a className="invite-download" href={`/events/${encodeURIComponent(id)}/calendar.ics`}>Скачать событие (.ics)</a>
  </section>;
}
