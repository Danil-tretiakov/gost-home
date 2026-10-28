import { getChatGPTUser } from './chatgpt-auth';
// Explicit owner allowlist. Visitor identity is supplied by Sites, never by browser state.
const OWNER_EMAIL = "4q7h7cbdpm@privaterelay.appleid.com";
export async function canEditCalendar(){
 const user=await getChatGPTUser();
 return !!user && user.email.toLowerCase()===OWNER_EMAIL.toLowerCase();
}
