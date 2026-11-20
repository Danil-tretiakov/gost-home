import { env } from 'cloudflare:workers';

/**
 * Where identity comes from. On ChatGPT Sites (default) the platform signs people in and sets oai-authenticated-* headers.
 * Elsewhere (Cloudflare) set AUTH_MODE=password: those headers are then ignored and only our signed session cookie counts.
 */
const vars = () => env as unknown as Record<string, string | undefined>;
export const authMode = (): 'sites' | 'password' => (vars().AUTH_MODE === 'password' ? 'password' : 'sites');
export const sessionSecret = () => vars().SESSION_SECRET;
export const ownerPassword = () => vars().OWNER_PASSWORD;
export const setupToken = () => vars().SETUP_TOKEN;
export const signInPath = () => (authMode() === 'password' ? '/login' : '/signin-with-chatgpt?return_to=%2F');
