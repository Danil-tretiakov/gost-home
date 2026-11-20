import { secret } from './env';
import { HIGGSFIELD_BASE, parseResponse, safeStatusUrl, type JobUpdate } from './higgsfield-core';

export function higgsfieldConfigured() { return !!(secret('HF_API_KEY_ID') && secret('HF_API_KEY_SECRET')); }
function auth() {
  const id = secret('HF_API_KEY_ID'); const sec = secret('HF_API_KEY_SECRET');
  if (!id || !sec) throw new Error('not_configured');
  return `Key ${id}:${sec}`;
}

export async function submit(endpoint: string, body: Record<string, unknown>, idempotencyKey: string): Promise<JobUpdate> {
  const r = await fetch(`${HIGGSFIELD_BASE}/${endpoint}`, {
    method: 'POST', headers: { Authorization: auth(), 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { status: 'error', resultUrls: [], error: `HTTP ${r.status}: ${JSON.stringify(data).slice(0, 300)}` };
  return parseResponse(data);
}

export async function poll(statusUrl: string): Promise<JobUpdate> {
  if (!safeStatusUrl(statusUrl)) return { status: 'error', resultUrls: [], error: 'unsafe status url' };
  const r = await fetch(statusUrl, { headers: { Authorization: auth() } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { status: 'error', resultUrls: [], error: `HTTP ${r.status}` };
  return parseResponse(data);
}
