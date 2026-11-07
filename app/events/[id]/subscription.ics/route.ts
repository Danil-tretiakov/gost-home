import { getShootById } from '../../../../lib/get-shoot';
import { eventSubscriptionCalendar } from '../../../../lib/event-calendar';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response('Событие не найдено', { status: 404, headers });
  }
  try {
    const shoot = await getShootById(id);
    const link = new URL(`/events/${id}`, request.url).href;
    return new Response(eventSubscriptionCalendar(shoot, link), {
      headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8' },
    });
  } catch {
    return new Response('Не удалось загрузить событие. Попробуйте позже.', { status: 503, headers });
  }
}
