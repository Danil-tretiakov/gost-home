/** Safari has native event preview support that many iPhone web views omit. */
export function calendarOpeningLink(id: string, origin: string, userAgent: string): { href: string; viaSafari: boolean } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Некорректная съёмка');
  const path = `/events/${id}/calendar.ics`;
  const viaSafari = /iPhone|iPad|iPod/i.test(userAgent);
  if (!viaSafari) return { href: path, viaSafari: false };
  const site = new URL(origin);
  if (site.protocol !== 'https:' || site.username || site.password) throw new Error('Некорректный адрес календаря');
  const event = new URL(path, site.origin);
  // Replace only the protocol, never embedded text or query values.
  return { href: `x-safari-https:${event.href.slice(event.protocol.length)}`, viaSafari: true };
}
