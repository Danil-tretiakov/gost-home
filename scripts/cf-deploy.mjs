// Deploys GOST HOME to Данил's own free Cloudflare account (Workers + D1, no R2, no paid resources).
// Run on the Mac from the project folder after `npm run build`:
//   node scripts/cf-deploy.mjs            does everything that is safe to repeat
//   node scripts/cf-deploy.mjs --check    only shows what is already set up
//   node scripts/cf-deploy.mjs --setup-link   makes a new one-time SETUP_TOKEN and opens <site>/login?setup#setup=<token>
//                                             in Chrome, where the owner types his password (it is never printed)
// Steps: check sign-in (`npx wrangler login` first), find or create the D1 database «gost-home», write the
// config (scripts/cf-config.mjs), apply migrations from drizzle/ (only new ones), deploy, create SESSION_SECRET
// once (random, never printed). The owner password is typed only by the owner: on the setup link page (stored hashed in D1),
// or as the OWNER_PASSWORD secret with `npx wrangler secret put OWNER_PASSWORD --config dist/server/wrangler.cloudflare.json`.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const SETUP_LINK = process.argv.includes('--setup-link');
const CONFIG = 'dist/server/wrangler.cloudflare.json';
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';
const DB_NAME = 'gost-home';
const SITE_URL = 'https://gost-home.gosthomegpt.workers.dev'; // first deploy 2026-11-19; override with CF_SITE_URL
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

function wrangler(args, { input, quiet } = {}) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { encoding: 'utf8', env, input, stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'] });
  if (!quiet && r.stdout) process.stdout.write(r.stdout);
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}
function fail(msg, r) {
  console.error('\nОстановлено: ' + msg);
  if (r) console.error((r.err || r.out).split('\n').filter(Boolean).slice(-15).join('\n'));
  process.exit(1);
}
const json = text => { const i = text.search(/[[{]/); return JSON.parse(text.slice(i)); };

if (!existsSync('dist/server/wrangler.json')) fail('нет сборки. Сначала: npm run build');

// 1. Sign-in
const who = wrangler(['whoami'], { quiet: true });
if (!who.ok || /not authenticated|You are not/i.test(who.out + who.err)) fail('нет входа в Cloudflare. Выполните: npx wrangler login', who);
console.log('Вход в Cloudflare: есть');

// 2. D1 database
const list = wrangler(['d1', 'list', '--json'], { quiet: true });
if (!list.ok) fail('не удалось получить список баз D1', list);
let db = json(list.out).find(d => d.name === DB_NAME);
if (!db && CHECK) console.log('База D1 «gost-home»: ещё нет');
if (!db && !CHECK) {
  const made = wrangler(['d1', 'create', DB_NAME], { quiet: true });
  if (!made.ok) fail('не удалось создать базу D1', made);
  db = json(wrangler(['d1', 'list', '--json'], { quiet: true }).out).find(d => d.name === DB_NAME);
  if (!db) fail('база создана, но не найдена в списке');
  console.log('База D1 «gost-home»: создана');
} else if (db) console.log('База D1 «gost-home»: есть');
if (CHECK && !db) process.exit(0);

// 3. Config
const cfg = spawnSync(process.execPath, ['scripts/cf-config.mjs', db.uuid], { encoding: 'utf8', stdio: 'inherit' });
if (cfg.status !== 0) fail('не удалось записать настройки');

async function openSetupLink() {
  const url = (process.env.CF_SITE_URL || SITE_URL).replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) fail('неверный адрес сайта в CF_SITE_URL');
  const token = randomBytes(32).toString('base64url');
  const s = wrangler(['secret', 'put', 'SETUP_TOKEN', '--config', CONFIG], { input: token + '\n', quiet: true });
  if (!s.ok) fail('не удалось создать ссылку', s);
  spawnSync('open', ['-a', 'Google Chrome', `${url}/login?setup#setup=${token}`]);
  console.log('Открыта страница задания пароля в Chrome (ссылка одноразовая, здесь не показывается). Новый секрет вступает в силу за несколько секунд: если страница скажет «ссылка устарела», обновите её.');
  process.exit(0);
}
if (SETUP_LINK) await openSetupLink();

// 4. Migrations (wrangler applies only the ones not applied yet)
if (CHECK) {
  const m = wrangler(['d1', 'migrations', 'list', 'DB', '--remote', '--config', CONFIG], { quiet: true });
  console.log('Неприменённые миграции:\n' + (m.out.trim() || m.err.trim()));
} else {
  const m = wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', CONFIG], { input: 'y\n' });
  if (!m.ok) fail('миграции не применились', m);
}

// 5. Secrets present?
const sl = wrangler(['secret', 'list', '--config', CONFIG, '--format', 'json'], { quiet: true });
const names = sl.ok ? json(sl.out).map(s => s.name) : [];
if (CHECK) {
  console.log('Сайт уже выложен: ' + (sl.ok ? 'да' : 'нет'));
  console.log('SESSION_SECRET: ' + (names.includes('SESSION_SECRET') ? 'задан' : 'нет'));
  console.log('OWNER_PASSWORD: ' + (names.includes('OWNER_PASSWORD') ? 'задан' : 'нет'));
  process.exit(0);
}

// 6. Deploy
const d = wrangler(['deploy', '--config', CONFIG]);
if (!d.ok) fail('выкладка не прошла' + (/workers\.dev subdomain/i.test(d.err + d.out) ? '. Откройте dash.cloudflare.com → Workers & Pages один раз, чтобы получить адрес workers.dev' : ''), d);
const url = (d.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0];

// 7. SESSION_SECRET once, never printed
if (!names.includes('SESSION_SECRET')) {
  const s = wrangler(['secret', 'put', 'SESSION_SECRET', '--config', CONFIG], { input: randomBytes(48).toString('base64url') + '\n', quiet: true });
  if (!s.ok) fail('не удалось задать SESSION_SECRET', s);
  console.log('SESSION_SECRET: создан');
} else console.log('SESSION_SECRET: уже был');

console.log('\nГотово. Адрес сайта: ' + (url ?? 'см. вывод выше'));
const stored = wrangler(['d1', 'execute', 'DB', '--remote', '--config', CONFIG, '--json', '--command', "SELECT COUNT(*) AS n FROM auth_credentials WHERE id = 'owner'"], { quiet: true });
const hasStored = stored.ok && JSON.stringify(json(stored.out)).includes('"n":1');
if (!hasStored && !names.includes('OWNER_PASSWORD')) console.log('Пароль владельца ещё не задан. Откройте страницу задания пароля: ' + (url ? `CF_SITE_URL=${url} ` : '') + 'node scripts/cf-deploy.mjs --setup-link');
