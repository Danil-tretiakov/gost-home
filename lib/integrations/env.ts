import { env } from 'cloudflare:workers';

/** Server-only secrets. Values come from the hosting secret store / environment, never from the repository or browser. */
export function secret(name: string): string | null {
  const v = (env as unknown as Record<string, unknown>)[name];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
