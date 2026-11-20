// Writes dist/server/wrangler.cloudflare.json: the built worker config for Данил's own free Cloudflare account.
// Differences from the ChatGPT Sites config: own name, real D1 id, migrations folder, no R2 (it needs billing),
// and AUTH_MODE=password so identity comes only from the signed session cookie (lib/session.ts).
// Usage: node scripts/cf-config.mjs [d1-database-id]   (id can also come from CF_D1_ID; without it a placeholder stays for local runs)
import { readFileSync, writeFileSync } from 'node:fs';

const src = new URL('../dist/server/wrangler.json', import.meta.url);
const dst = new URL('../dist/server/wrangler.cloudflare.json', import.meta.url);
const id = process.argv[2] || process.env.CF_D1_ID || '00000000-0000-4000-8000-000000000000';
if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('D1 id должен выглядеть как 01234567-89ab-cdef-0123-456789abcdef');

const c = JSON.parse(readFileSync(src, 'utf8'));
delete c.topLevelName;
c.name = 'gost-home';
c.workers_dev = true;
c.r2_buckets = [];
c.d1_databases = [{ binding: 'DB', database_name: 'gost-home', database_id: id, migrations_dir: '../../drizzle' }];
c.vars = { ...(c.vars || {}), AUTH_MODE: 'password' };
if (c.dev) c.dev.enable_containers = false;
writeFileSync(dst, JSON.stringify(c, null, 2) + '\n');
console.log('Записано', dst.pathname, 'D1', id === '00000000-0000-4000-8000-000000000000' ? '(заглушка)' : id);
