/**
 * Owner password stored on the site (Cloudflare hosting). Set once through a setup link that only the Mac can open:
 * the link carries SETUP_TOKEN (random secret made by scripts/cf-deploy.mjs --setup-link); each token works once.
 * Falls back to the OWNER_PASSWORD secret when nothing is stored. Lockout: 10 failures in 15 minutes lock sign-in for 15 minutes.
 */
import { getD1 } from '../db';
import { hashPassword, newSalt, sameSecret, storedPasswordMatches } from './session';

type Db = ReturnType<typeof getD1>;
const WINDOW = 15 * 60_000, MAX_FAILURES = 10, LOCK = 15 * 60_000;

type Cred = { salt: string; hash: string };
async function cred(db: Db, id: string) {
  return (await db.prepare('SELECT salt, hash FROM auth_credentials WHERE id = ?').bind(id).first<Cred>()) ?? null;
}

export async function hasStoredPassword(db = getD1()) { return !!(await cred(db, 'owner')); }

export async function checkStoredPassword(secret: string, input: unknown, db = getD1()): Promise<boolean | null> {
  const c = await cred(db, 'owner');
  return c ? storedPasswordMatches(secret, input, c.salt, c.hash) : null;
}

/** true when the token matches SETUP_TOKEN and was not used before. */
export async function setupTokenUsable(secret: string, token: unknown, setupToken: string, db = getD1()) {
  if (!(await sameSecret(secret, token, setupToken))) return false;
  const used = await cred(db, 'setup');
  return !used || used.hash !== (await hashPassword(secret, used.salt, setupToken));
}

/** Saves the owner password and marks the setup token as used, in one batch. */
export async function savePassword(secret: string, password: string, setupToken: string, db = getD1()) {
  const now = new Date().toISOString(), salt = newSalt(), tSalt = newSalt();
  const up = 'INSERT INTO auth_credentials (id, salt, hash, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, updated_at = excluded.updated_at';
  await db.batch([
    db.prepare(up).bind('owner', salt, await hashPassword(secret, salt, password), now),
    db.prepare(up).bind('setup', tSalt, await hashPassword(secret, tSalt, setupToken), now),
    db.prepare("INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) VALUES (?, 'auth', 'owner', 'password.set', 'owner', ?, NULL, NULL)").bind(crypto.randomUUID(), now),
  ]);
}

type Attempts = { failures: number; window_start: number; locked_until: number };
/** Minutes left while sign-in is locked, else 0. */
export async function lockedMinutes(db = getD1(), now = Date.now()) {
  const a = await db.prepare("SELECT failures, window_start, locked_until FROM auth_attempts WHERE id = 'site'").first<Attempts>();
  return a && a.locked_until > now ? Math.ceil((a.locked_until - now) / 60_000) : 0;
}
export async function recordFailure(db = getD1(), now = Date.now()) {
  const a = await db.prepare("SELECT failures, window_start, locked_until FROM auth_attempts WHERE id = 'site'").first<Attempts>();
  const fresh = !a || now - a.window_start > WINDOW;
  const failures = fresh ? 1 : a.failures + 1, start = fresh ? now : a.window_start;
  const locked = failures >= MAX_FAILURES ? now + LOCK : (a?.locked_until ?? 0);
  await db.prepare("INSERT INTO auth_attempts (id, failures, window_start, locked_until) VALUES ('site', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET failures = excluded.failures, window_start = excluded.window_start, locked_until = excluded.locked_until")
    .bind(failures >= MAX_FAILURES ? 0 : failures, failures >= MAX_FAILURES ? now : start, locked).run();
}
export async function clearFailures(db = getD1()) {
  await db.prepare("UPDATE auth_attempts SET failures = 0, locked_until = 0 WHERE id = 'site'").run();
}
