/** webcal hands the feed to Apple's Calendar subscription flow. */
export function appleCalendarSubscriptionUrl(origin: string, id: string): string {
  const site = new URL(origin);
  if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password) throw new Error('Некорректный адрес календаря');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Некорректная съёмка');
  const feed = new URL(`/events/${id}/subscription.ics`, site.origin);
  return `webcal:${feed.href.slice(feed.protocol.length)}`;
}
