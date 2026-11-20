/**
 * Higgsfield API adapter (pure part, testable without the runtime).
 * Source: https://docs.higgsfield.ai (checked 2026-11-19): base https://api.higgsfield.ai, header
 * `Authorization: Key <KEY_ID>:<KEY_SECRET>`, POST /<model endpoint>, optional `Idempotency-Key`;
 * response {status, request_id, status_url, cancel_url}; statuses queued | in_progress | completed | failed | nsfw | canceled;
 * completed images → images[].url, video → video.url, files expire (expires_at). The docs give no cost fields.
 */
export const HIGGSFIELD_BASE = 'https://api.higgsfield.ai';
export const TERMINAL = ['completed', 'failed', 'nsfw', 'canceled'];

export type Preset = { endpoint: string; kind: 'image' | 'video'; label: string; fields: Record<string, { type: 'string' | 'int' | 'enum' | 'url'; required?: boolean; values?: (string | number)[]; default?: string | number }> };
/** Only models whose request schema was read in the official docs. Others can be added as a custom endpoint. */
export const PRESETS: Preset[] = [
  { endpoint: 'higgsfield-ai/soul/v2/standard', kind: 'image', label: 'Higgsfield SOUL v2 (изображение по тексту)', fields: { prompt: { type: 'string', required: true } } },
  { endpoint: 'wan/v2.6/image-to-video', kind: 'video', label: 'Wan 2.6 image-to-video', fields: {
    prompt: { type: 'string', required: true }, image_url: { type: 'url', required: true },
    duration: { type: 'enum', values: [5, 10, 15], default: 5 }, resolution: { type: 'enum', values: ['480p', '720p', '1080p'], default: '720p' },
    negative_prompt: { type: 'string' },
  } },
];

const ENDPOINT = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*){1,5}$/;
export function validEndpoint(e: unknown): e is string { return typeof e === 'string' && ENDPOINT.test(e) && !e.includes('..'); }

/** Validates params against a preset; custom endpoints accept a flat JSON object of strings/numbers/booleans. */
export function buildBody(endpoint: string, params: Record<string, unknown>): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const preset = PRESETS.find(p => p.endpoint === endpoint);
  const body: Record<string, unknown> = {};
  if (!preset) {
    for (const [k, v] of Object.entries(params)) {
      if (!/^[a-z_][a-z0-9_]{0,40}$/.test(k) || !['string', 'number', 'boolean'].includes(typeof v)) return { ok: false, error: `Параметр ${k} не поддерживается` };
      body[k] = v;
    }
    return { ok: true, body };
  }
  for (const [k, f] of Object.entries(preset.fields)) {
    let v = params[k] ?? f.default;
    if (v === undefined || v === '') { if (f.required) return { ok: false, error: `Нужно поле ${k}` }; continue; }
    if (f.type === 'enum') { const hit = f.values!.find(x => String(x) === String(v)); if (hit === undefined) return { ok: false, error: `${k}: допустимо ${f.values!.join(', ')}` }; v = hit; }
    if (f.type === 'url') { try { if (new URL(String(v)).protocol !== 'https:') throw 0; } catch { return { ok: false, error: `${k}: нужна публичная ссылка https://` }; } }
    if (f.type === 'string' && (typeof v !== 'string' || v.length > 4000)) return { ok: false, error: `${k}: текст до 4000 символов` };
    body[k] = v;
  }
  return { ok: true, body };
}

export type JobUpdate = { status: string; requestId?: string; statusUrl?: string; resultUrls: string[]; expiresAt?: string; error?: string };
export function parseResponse(data: unknown): JobUpdate {
  const d = (data ?? {}) as Record<string, unknown>;
  const urls: string[] = [];
  if (Array.isArray(d.images)) for (const i of d.images) if (typeof (i as { url?: unknown }).url === 'string') urls.push((i as { url: string }).url);
  const video = d.video as { url?: unknown } | undefined;
  if (video && typeof video.url === 'string') urls.push(video.url);
  return {
    status: typeof d.status === 'string' ? d.status : 'error',
    requestId: typeof d.request_id === 'string' ? d.request_id : undefined,
    statusUrl: typeof d.status_url === 'string' ? d.status_url : undefined,
    resultUrls: urls,
    expiresAt: typeof d.expires_at === 'string' ? d.expires_at : typeof d.expires_at === 'number' ? new Date(d.expires_at * 1000).toISOString() : undefined,
    error: typeof d.error === 'string' ? d.error : d.error ? JSON.stringify(d.error).slice(0, 500) : undefined,
  };
}
/** Status URLs are only followed on the provider host. */
export function safeStatusUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try { const x = new URL(u); return x.origin === HIGGSFIELD_BASE && x.pathname.startsWith('/requests/'); } catch { return false; }
}
