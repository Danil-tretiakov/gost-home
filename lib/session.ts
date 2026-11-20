/**
 * Own sign-in for hosting outside ChatGPT Sites (Cloudflare). Sites identity headers are NOT trusted there:
 * a browser could send them itself. Identity comes only from a session cookie signed with SESSION_SECRET.
 * Token: v1.<base64url(email)>.<expires unix seconds>.<base64url(HMAC-SHA256)>
 */
export const SESSION_COOKIE = 'gh_session';
export const SESSION_DAYS = 30;
const enc = new TextEncoder();

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** A secret is usable only when it is long enough; otherwise sign-in stays off. */
export const strongSecret = (s: string | undefined): s is string => typeof s === 'string' && s.length >= 32;
/** Owner password rule (Данил's choice): at least 8 characters with at least one Latin letter and one digit. */
export const PASSWORD_RULE = 'Не короче 8 символов, английские буквы и цифры';
export const strongPassword = (s: unknown): s is string =>
  typeof s === 'string' && s.length >= 8 && s.length <= 200 && /[A-Za-z]/.test(s) && /\d/.test(s);

export async function signSession(secret: string, email: string, now = Date.now(), days = SESSION_DAYS): Promise<string> {
  const body = `v1.${b64url(enc.encode(email))}.${Math.floor(now / 1000) + days * 86_400}`;
  return `${body}.${b64url(await hmac(secret, body))}`;
}

/** Returns the signed email, or null for a missing, malformed, forged or expired token. */
export async function verifySession(secret: string, token: string | undefined | null, now = Date.now()): Promise<string | null> {
  if (!token || token.length > 1000) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d{1,12}$/.test(parts[2])) return null;
  try {
    const body = parts.slice(0, 3).join('.');
    if (!sameBytes(await hmac(secret, body), fromB64url(parts[3]))) return null;
    if (Number(parts[2]) * 1000 <= now) return null;
    return new TextDecoder().decode(fromB64url(parts[1]));
  } catch { return null; }
}

/** Constant-time password check: both sides are hashed with the session secret first, so lengths never leak. */
export async function passwordMatches(secret: string, input: unknown, expected: string): Promise<boolean> {
  if (typeof input !== 'string' || input.length > 500) return false;
  return sameBytes(await hmac(secret, 'pw:' + input), await hmac(secret, 'pw:' + expected));
}

/** Stored form of a password: HMAC with the server-only session secret and a per-password salt. */
export async function hashPassword(secret: string, salt: string, password: string): Promise<string> {
  return b64url(await hmac(secret, `pwh:${salt}:${password}`));
}
export const newSalt = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
/** Constant-time check of a password against its stored hash. */
export async function storedPasswordMatches(secret: string, input: unknown, salt: string, hash: string): Promise<boolean> {
  if (typeof input !== 'string' || input.length > 500) return false;
  try { return sameBytes(fromB64url(await hashPassword(secret, salt, input)), fromB64url(hash)); } catch { return false; }
}
/** Constant-time comparison of two strings of any length (hashed first). */
export async function sameSecret(secret: string, a: unknown, b: string): Promise<boolean> {
  if (typeof a !== 'string' || a.length > 500) return false;
  return sameBytes(await hmac(secret, 'cmp:' + a), await hmac(secret, 'cmp:' + b));
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const sessionCookie = (token: string, days = SESSION_DAYS) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86_400}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
