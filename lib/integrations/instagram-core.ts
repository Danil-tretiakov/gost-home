/**
 * Instagram API with Instagram Login (Business Login). Sources checked 2026-11-19:
 * developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login and
 * …/reference/instagram-media. Authorize: https://www.instagram.com/oauth/authorize (client_id, redirect_uri,
 * response_type=code, scope=instagram_business_basic, state). Code → POST https://api.instagram.com/oauth/access_token.
 * Long-lived: GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token (≈60 days),
 * refresh: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token.
 */
export const IG_GRAPH = 'https://graph.instagram.com';
export const IG_VERSION = 'v25.0';
export const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count';

export function authorizeUrl(appId: string, redirectUri: string, state: string) {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'instagram_business_basic');
  u.searchParams.set('state', state);
  return u.toString();
}

export type IgMedia = { mediaId: string; permalink: string | null; caption: string | null; mediaType: string | null; mediaProductType: string | null; timestamp: string; likeCount: number | null; commentsCount: number | null };
/** Maps one API object. Missing metrics stay null: never replaced by zero. */
export function mapMedia(m: Record<string, unknown>): IgMedia | null {
  if (typeof m.id !== 'string' || typeof m.timestamp !== 'string') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  return { mediaId: m.id, permalink: s(m.permalink), caption: s(m.caption), mediaType: s(m.media_type), mediaProductType: s(m.media_product_type), timestamp: m.timestamp, likeCount: n(m.like_count), commentsCount: n(m.comments_count) };
}
/** Reels are VIDEO media; media_product_type is REELS when the API returns it. */
export const isReel = (m: IgMedia) => m.mediaProductType ? m.mediaProductType === 'REELS' : m.mediaType === 'VIDEO';
/** Publication day in Bangkok for an ISO timestamp like 2026-11-19T15:30:00+0000. */
export function bangkokDay(ts: string) {
  const t = Date.parse(ts.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(t)) : null;
}
/** Candidate items for a media: unpublished Reels planned within ±3 days. Suggestions only; the user confirms. */
export function candidates<T extends { id: string; type: string; productionStatus: string; plannedPublishDate: string | null }>(day: string, items: T[]): T[] {
  const d = Date.parse(day + 'T00:00:00Z');
  return items.filter(i => i.type === 'reel' && i.productionStatus !== 'published' && i.productionStatus !== 'cancelled' && i.plannedPublishDate
    && Math.abs(Date.parse(i.plannedPublishDate + 'T00:00:00Z') - d) <= 3 * 86_400_000)
    .sort((a, b) => Math.abs(Date.parse(a.plannedPublishDate! + 'T00:00:00Z') - d) - Math.abs(Date.parse(b.plannedPublishDate! + 'T00:00:00Z') - d));
}
