/**
 * AI file storage: pure checks (no runtime imports, unit-tested in scripts/test-v28.mjs).
 * Files live in a private R2 bucket and are served only through /api/ai/files after a server-side permission check.
 */
export const FILE_TYPES: Record<string, { kind: 'image' | 'video'; ext: string; max: number }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg', max: 20 * 1024 * 1024 },
  'image/png': { kind: 'image', ext: 'png', max: 20 * 1024 * 1024 },
  'image/webp': { kind: 'image', ext: 'webp', max: 20 * 1024 * 1024 },
  'video/mp4': { kind: 'video', ext: 'mp4', max: 95 * 1024 * 1024 },
  'video/quicktime': { kind: 'video', ext: 'mov', max: 95 * 1024 * 1024 },
  'video/webm': { kind: 'video', ext: 'webm', max: 95 * 1024 * 1024 },
};
export const MAX_FILE = Math.max(...Object.values(FILE_TYPES).map(t => t.max));
export const storageKeyFor = (assetId: string) => `ai/${assetId}`;

/** Detects the real type from the first bytes; the declared type and file name are never trusted alone. */
export function sniff(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  const ascii = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (ascii(4, 'ftyp')) {
    // ISO media: HEIC/AVIF images share the container and are not accepted as video.
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1', 'avif', 'avis'].some(brand => ascii(8, brand))) return null;
    return ascii(8, 'qt  ') ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

/** Accepts a file only when its bytes match an allowed type and its size fits that type. */
export function checkFile(head: Uint8Array, size: number, declared?: string | null): { ok: true; mime: string; kind: 'image' | 'video' } | { ok: false; error: string } {
  if (!size) return { ok: false, error: 'Файл пустой' };
  const mime = sniff(head);
  if (!mime) return { ok: false, error: 'Тип не поддерживается: JPEG, PNG, WebP, MP4, MOV или WebM' };
  const declaredBase = (declared ?? '').split(';')[0].trim().toLowerCase();
  // Declared type must agree on the media kind (image vs video) when it is given; the sniffed type wins.
  if (declaredBase && declaredBase !== 'application/octet-stream' && FILE_TYPES[declaredBase]?.kind !== FILE_TYPES[mime].kind) return { ok: false, error: 'Содержимое файла не совпадает с его типом' };
  if (size > FILE_TYPES[mime].max) return { ok: false, error: `Файл больше ${Math.round(FILE_TYPES[mime].max / 1024 / 1024)} МБ` };
  return { ok: true, mime, kind: FILE_TYPES[mime].kind };
}

export function safeFileName(name: unknown, mime: string) {
  const base = typeof name === 'string' ? name.normalize('NFC').replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, '_').replace(/^[.\s]+/, '').trim().slice(0, 120) : '';
  const ext = FILE_TYPES[mime]?.ext ?? 'bin';
  if (!base) return `file.${ext}`;
  // The extension always follows the detected type.
  return base.replace(/\.[a-z0-9]{1,5}$/i, '') + '.' + ext;
}
export function contentDisposition(kind: 'inline' | 'attachment', name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Outbound fetch guard (SSRF): https on port 443 only, no credentials, no IP literals, no local or internal names.
 * Applied to the first URL and to every redirect target.
 */
export function safeFetchUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || host.includes(':')) return null;
  if (/^\d+(\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+/i.test(host) || /^[0-9.]+$/.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa)$/.test(host)) return null;
  if (/^(metadata|instance-data)(\.|$)/.test(host) || host === 'metadata.google.internal') return null;
  return u;
}

/** Range header → R2 range. Only one simple range is supported. */
export function parseRange(h: string | null, size: number): { offset: number; length: number } | null | 'invalid' {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (!m[1] && !m[2])) return 'invalid';
  let start: number, end: number;
  if (!m[1]) { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start > end || start >= size) return 'invalid';
  return { offset: start, length: end - start + 1 };
}

/** Signed short-lived link for one stored image, used only to hand an approved frame to the video provider. */
export async function signLink(secret: string, assetId: string, exp: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${assetId}.${exp}`)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function verifyLink(secret: string, assetId: string, exp: number, sig: string, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Number.isInteger(exp) || exp < nowSec || exp > nowSec + 3600 || typeof sig !== 'string') return false;
  const want = await signLink(secret, assetId, exp);
  if (want.length !== sig.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
