import { env } from 'cloudflare:workers';
import { checkFile, MAX_FILE, safeFetchUrl, safeFileName, storageKeyFor } from './files-core';

type Bucket = {
  put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string, opts?: { range?: { offset: number; length: number } }): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
};
/** The private R2 bucket (hosting.json "r2": "BUCKET"), or null when the project has no storage. */
export function bucket(): Bucket | null {
  const b = (env as unknown as { BUCKET?: Bucket }).BUCKET;
  return b && typeof b.put === 'function' ? b : null;
}

export type Stored = { storageKey: string; mime: string; size: number; fileName: string; kind: 'image' | 'video' };

/** Validates bytes and writes them under the asset's key. */
export async function storeBytes(b: Bucket, assetId: string, bytes: Uint8Array, declared: string | null, name: unknown): Promise<Stored | { error: string }> {
  const check = checkFile(bytes.subarray(0, 32), bytes.byteLength, declared);
  if (!check.ok) return { error: check.error };
  const key = storageKeyFor(assetId);
  const fileName = safeFileName(name, check.mime);
  await b.put(key, bytes, { httpMetadata: { contentType: check.mime }, customMetadata: { assetId, fileName } });
  return { storageKey: key, mime: check.mime, size: bytes.byteLength, fileName, kind: check.kind };
}

/**
 * Downloads a provider or https link into storage with SSRF, redirect, size and type checks.
 * Redirects are followed manually (max 3) and each target is re-checked.
 */
export async function fetchToBucket(b: Bucket, assetId: string, rawUrl: string, fetcher: typeof fetch = fetch): Promise<Stored | { error: string }> {
  let url = safeFetchUrl(rawUrl);
  if (!url) return { error: 'Ссылка не разрешена: только https на публичный адрес' };
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetcher(url.toString(), { redirect: 'manual', headers: { Accept: 'image/*,video/*' } });
    if (res.status >= 300 && res.status < 400) {
      const next = safeFetchUrl(new URL(res.headers.get('location') ?? '', url).toString());
      if (!next) return { error: 'Перенаправление на запрещённый адрес' };
      url = next; res = null; continue;
    }
    break;
  }
  if (!res) return { error: 'Слишком много перенаправлений' };
  if (!res.ok || !res.body) return { error: `Источник ответил ${res.status}` };
  const declaredLen = Number(res.headers.get('content-length') ?? 0);
  if (declaredLen > MAX_FILE) return { error: 'Файл слишком большой' };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE) { await reader.cancel(); return { error: 'Файл слишком большой' }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.byteLength; }
  const name = decodeURIComponent(url.pathname.split('/').pop() ?? '') || 'result';
  return storeBytes(b, assetId, bytes, res.headers.get('content-type'), name);
}
