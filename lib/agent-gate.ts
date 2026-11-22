import { OWNER_EMAIL } from '../app/permissions';
import { authMode, sessionSecret } from './auth-mode';
import { sameSecret, SESSION_COOKIE, signSession, strongSecret } from './session';

/**
 * Access for the assistant (Claude in chat) when Данил's computer is off.
 * A request with `Authorization: Bearer <AGENT_TOKEN>` gets a short-lived owner session, but ONLY for a fixed list of
 * content endpoints. No token configured or a wrong token: the request goes on untouched and stays anonymous.
 * Never allowed: DELETE, finance, team, settings, backup, integrations, AI, sign-in.
 */
const ALLOWED: Record<string, string[]> = {
  GET: ['/api/tasks', '/api/tasks/folders', '/api/content', '/api/shoots'],
  POST: ['/api/tasks', '/api/content', '/api/content/status', '/api/shoots'],
};
export const AGENT_TOKEN_MIN = 32;

/** Returns the request to hand to the app: with the owner session cookie when the bearer token is valid, else as it came. */
export async function withAgentSession(request: Request, vars: Record<string, string | undefined>): Promise<Request | Response> {
  const header = request.headers.get('authorization');
  if (!header || !/^Bearer\s/i.test(header)) return request;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/')) return request;
  const token = vars.AGENT_TOKEN;
  const secret = sessionSecret();
  if (authMode() !== 'password' || !strongSecret(secret) || typeof token !== 'string' || token.length < AGENT_TOKEN_MIN) {
    return Response.json({ error: 'Доступ помощника не настроен' }, { status: 503 });
  }
  if (!(await sameSecret(secret, header.replace(/^Bearer\s+/i, '').trim(), token))) {
    return Response.json({ error: 'Неверный токен' }, { status: 401 });
  }
  if (!(ALLOWED[request.method] ?? []).includes(path)) {
    return Response.json({ error: 'Это действие помощнику недоступно' }, { status: 403 });
  }
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('origin');
  headers.set('cookie', `${SESSION_COOKIE}=${await signSession(secret, OWNER_EMAIL, Date.now(), 1)}`);
  return new Request(request, { headers });
}
