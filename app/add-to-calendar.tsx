import { headers } from 'next/headers';
import { calendarOpeningLink } from '../lib/calendar-opening';

export default async function AddToCalendar({ id }: { id: string }) {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host')?.split(',')[0].trim() || requestHeaders.get('host');
  const origin = host ? `https://${host}` : 'https://gost-home-shoots.danil-tretiakov.chatgpt.site';
  const action = calendarOpeningLink(id, origin, requestHeaders.get('user-agent') || '');
  return <section className="invite-add">
    <a className="primary invite-button" href={action.href}>＋ ДОБАВИТЬ В КАЛЕНДАРЬ</a>
    {action.viaSafari && <p className="invite-help">Откроется в Safari для добавления в Apple Календарь.</p>}
    <p className="invite-reminder">◷ Напоминание за 24 часа до начала</p>
  </section>;
}
