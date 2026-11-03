import { getShootById } from '../../../../lib/get-shoot';
import { eventCalendar, eventTimes } from '../../../../lib/event-calendar';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  try {
    const shoot = await getShootById((await params).id);
    if (!shoot) return new Response('Событие не найдено', { status: 404, headers });
    if (shoot.status === 'Отменено' || eventTimes(shoot).start.getTime() <= Date.now()) return new Response('Эта съёмка отменена или уже началась.', { status: 410, headers });
    const link = new URL(`/events/${shoot.id}`, request.url).href;
    return new Response(eventCalendar(shoot, link), { headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `inline; filename="gost-home-${shoot.id}.ics"`, 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('Не удалось загрузить событие. Попробуйте позже.', { status: 503, headers }); }
}
