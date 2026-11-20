import { secret } from './env';
import { decryptToken, encryptToken } from './crypto';
import { IG_GRAPH, IG_VERSION, MEDIA_FIELDS, mapMedia, type IgMedia } from './instagram-core';

/** Configured = app credentials and the encryption key exist on the server. Says nothing about a connected account. */
export function instagramConfigured() { return !!(secret('IG_APP_ID') && secret('IG_APP_SECRET') && secret('TOKEN_ENCRYPTION_KEY')); }
export const appId = () => secret('IG_APP_ID');
export const redirectUri = (origin: string) => `${origin}/api/integrations/instagram/callback`;

async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) {
    const e = data.error as { message?: string } | string | undefined;
    throw new Error(`Instagram ${r.status}: ${typeof e === 'string' ? e : e?.message ?? data.error_message ?? 'ошибка'}`.slice(0, 300));
  }
  return data;
}

/** Code → short-lived token → long-lived token (≈60 days). Returns the encrypted token only. */
export async function exchangeCode(code: string, origin: string) {
  const id = secret('IG_APP_ID'), sec = secret('IG_APP_SECRET'), key = secret('TOKEN_ENCRYPTION_KEY');
  if (!id || !sec || !key) throw new Error('not_configured');
  const form = new URLSearchParams({ client_id: id, client_secret: sec, grant_type: 'authorization_code', redirect_uri: redirectUri(origin), code });
  const short = await getJson('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
  const row = (Array.isArray(short.data) ? short.data[0] : short) as Record<string, unknown>;
  if (typeof row?.access_token !== 'string') throw new Error('Instagram не вернул токен');
  const u = new URL(`${IG_GRAPH}/access_token`);
  u.searchParams.set('grant_type', 'ig_exchange_token'); u.searchParams.set('client_secret', sec); u.searchParams.set('access_token', row.access_token);
  const long = await getJson(u.toString());
  if (typeof long.access_token !== 'string') throw new Error('Instagram не выдал долгосрочный токен');
  const expiresAt = typeof long.expires_in === 'number' ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;
  const me = await getJson(`${IG_GRAPH}/${IG_VERSION}/me?fields=user_id,username&access_token=${encodeURIComponent(long.access_token)}`).catch(() => ({} as Record<string, unknown>));
  return {
    cipher: await encryptToken(long.access_token, key), expiresAt,
    accountId: typeof me.user_id === 'string' ? me.user_id : String(row.user_id ?? ''),
    accountName: typeof me.username === 'string' ? me.username : null,
  };
}

/** Decrypts, refreshes when less than 7 days remain, and returns a usable token plus an updated cipher if refreshed. */
export async function usableToken(cipher: string, expiresAt: string | null) {
  const key = secret('TOKEN_ENCRYPTION_KEY');
  if (!key) throw new Error('not_configured');
  let token = await decryptToken(cipher, key);
  if (expiresAt && Date.parse(expiresAt) < Date.now()) throw new Error('Токен Instagram истёк. Подключите аккаунт заново.');
  if (expiresAt && Date.parse(expiresAt) - Date.now() < 7 * 86_400_000) {
    const r = await getJson(`${IG_GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    if (typeof r.access_token === 'string') {
      token = r.access_token;
      return { token, refreshed: { cipher: await encryptToken(token, key), expiresAt: typeof r.expires_in === 'number' ? new Date(Date.now() + r.expires_in * 1000).toISOString() : expiresAt } };
    }
  }
  return { token, refreshed: null };
}

/** Reads the account's media (newest first), up to `pages` pages of 50. */
export async function fetchMedia(token: string, pages = 6): Promise<IgMedia[]> {
  const out: IgMedia[] = [];
  let url: string | null = `${IG_GRAPH}/${IG_VERSION}/me/media?fields=${MEDIA_FIELDS}&limit=50&access_token=${encodeURIComponent(token)}`;
  for (let i = 0; url && i < pages; i++) {
    const page = await getJson(url);
    for (const m of (Array.isArray(page.data) ? page.data : [])) { const x = mapMedia(m as Record<string, unknown>); if (x) out.push(x); }
    const next = (page.paging as { next?: unknown } | undefined)?.next;
    url = typeof next === 'string' && next.startsWith(IG_GRAPH + '/') ? next : null;
  }
  return out;
}
