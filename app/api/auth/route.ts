import { authMode, ownerPassword, sessionSecret, setupToken } from '../../../lib/auth-mode';
import { checkStoredPassword, clearFailures, lockedMinutes, recordFailure, savePassword, setupTokenUsable } from '../../../lib/owner-login';
import { clearSessionCookie, PASSWORD_RULE, passwordMatches, sessionCookie, signSession, strongPassword, strongSecret } from '../../../lib/session';
import { OWNER_EMAIL } from '../../permissions';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
const slow = () => new Promise(r => setTimeout(r, 900)); // slows down guessing

/** Owner sign-in with a password, only when the site runs outside ChatGPT Sites (AUTH_MODE=password). */
export async function POST(req: Request) {
  if (authMode() !== 'password') return json({ error: 'Вход выполняется через ChatGPT' }, 404);
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json({ error: 'Недостаточно прав для этого действия' }, 403);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return json({ error: 'Неверный запрос' }, 400); }
  if (x.action === 'logout') return json({ ok: true }, 200, clearSessionCookie());

  const secret = sessionSecret();
  if (!strongSecret(secret)) return json({ error: 'Вход ещё не настроен на сервере.' }, 503);
  const locked = await lockedMinutes();
  if (locked) return json({ error: `Слишком много неверных попыток. Попробуйте через ${locked} мин.` }, 429);
  const signedIn = async () => { await clearFailures(); return json({ ok: true }, 200, sessionCookie(await signSession(secret, OWNER_EMAIL))); };

  if (x.action === 'setup') {
    const token = setupToken();
    if (!token || token.length < 32 || !(await setupTokenUsable(secret, x.token, token))) {
      await recordFailure(); await slow();
      return json({ error: 'Ссылка для задания пароля устарела. Попросите новую.' }, 403);
    }
    if (!strongPassword(x.password)) return json({ error: PASSWORD_RULE }, 400);
    await savePassword(secret, x.password, token);
    return signedIn();
  }

  const stored = await checkStoredPassword(secret, x.password);
  const envPassword = ownerPassword();
  const ok = stored ?? (strongPassword(envPassword) ? await passwordMatches(secret, x.password, envPassword) : null);
  if (ok === null) return json({ error: 'Пароль владельца ещё не задан.' }, 503);
  if (!ok) { await recordFailure(); await slow(); return json({ error: 'Неверный пароль' }, 401); }
  return signedIn();
}
