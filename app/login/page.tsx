import { redirect } from 'next/navigation';
import { authMode, ownerPassword } from '../../lib/auth-mode';
import { hasStoredPassword } from '../../lib/owner-login';
import { strongPassword } from '../../lib/session';
import { getChatGPTUser } from '../chatgpt-auth';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

/** Sign-in page. On ChatGPT Sites it hands over to the platform sign-in. */
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (authMode() !== 'password') redirect('/signin-with-chatgpt?return_to=%2F');
  // ?setup marks a setup link (token in #setup=…): stay here even when signed in, so the password can be replaced.
  if (!('setup' in (await searchParams)) && await getChatGPTUser()) redirect('/');
  const configured = strongPassword(ownerPassword()) || await hasStoredPassword().catch(() => false);
  return <LoginForm configured={configured} />;
}
