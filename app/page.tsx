import Workspace from './workspace';
import { getAccess } from './permissions';
import { ROLE_LABELS } from '../lib/rbac';
import { authMode, signInPath } from '../lib/auth-mode';
export const dynamic='force-dynamic';
export default async function Page(){const a=await getAccess();return <Workspace access={{...a,roleLabel:a.role?ROLE_LABELS[a.role]:null,signInHref:signInPath(),canSignOut:authMode()==='password'&&!!a.email}}/>}
