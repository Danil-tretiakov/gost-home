/** AES-GCM encryption for tokens stored in D1. Key: 32 random bytes, base64, from the TOKEN_ENCRYPTION_KEY secret. */
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function key(raw: string) {
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptToken(plain: string, rawKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(rawKey), new TextEncoder().encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
export async function decryptToken(cipher: string, rawKey: string): Promise<string> {
  const [v, iv, ct] = cipher.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('bad token cipher');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(rawKey), unb64(ct));
  return new TextDecoder().decode(pt);
}
