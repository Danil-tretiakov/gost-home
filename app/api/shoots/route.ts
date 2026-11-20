import { SHOOT_STATUSES, normalizeShootStatus } from '../../../lib/shoot-status';
import { SHOOT_TEAM } from '../../../lib/shoot-team';
import { normalizeShootValues, storeShootValues } from '../../../lib/shoot-values';
import { canEditCalendar, getAccess } from '../../permissions';
import { drainThen } from '../../../lib/actor';
import { getDb } from '../../../db';
import { shoots } from '../../../db/schema';
import { and, eq } from 'drizzle-orm';
export const dynamic='force-dynamic';
const people=SHOOT_TEAM.map(member=>member[0]);
type ShootInput={id?:string;revision?:number;title:string;date:string;time:string;duration:number;format:string;status:string;project:string;location:string;participants:string[];notes:string;preparation?:string};
function valid(input:unknown):input is ShootInput{const x=input as ShootInput&Record<string,string>;return !!x && typeof x.title==='string' && x.title.trim().length>0 && x.title.length<=200 && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && !isNaN(Date.parse(x.date)) && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) && Number.isInteger(x.duration)&&x.duration>0&&x.duration<=720 && ['Reels','YouTube'].includes(x.format) && SHOOT_STATUSES.includes(x.status) && Array.isArray(x.participants)&&x.participants.length>0&&x.participants.every((p:string)=>people.includes(p)) && ['project','location','notes'].every(k=>typeof x[k]==='string'&&x[k].length<=5000) && (x.preparation===undefined || (typeof x.preparation==='string'&&x.preparation.length<=5000));}
function deny(req:Request){return drainThen(req,Response.json({error:'Редактировать календарь может только редактор'},{status:403}));}
function safe(req:Request){return !req.headers.get('origin') || req.headers.get('origin')===new URL(req.url).origin;}
// Visitors without a team role get the schedule only: internal notes and residential project names are left out.
export async function GET(){try{const internal=(await getAccess()).caps.internal;return Response.json((await getDb().select().from(shoots)).map(row=>({...row,status:normalizeShootStatus(row.status),...(internal?{}:{notes:'',project:''})})),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Не удалось загрузить календарь'},{status:503});}}
export async function POST(req:Request){
 if(!safe(req)||!(await canEditCalendar()))return deny(req);
 try{const x=await req.json() as Record<string,unknown>|null;if(x&&typeof x==='object')x.status=normalizeShootStatus(String(x.status));if(!valid(x)||(x.id!==undefined&&(typeof x.id!=='string'||!Number.isInteger(x.revision))))return Response.json({error:'Проверьте поля съёмки'},{status:400});
 const values={title:x.title.trim(),date:x.date,time:x.time,duration:x.duration,format:x.format,status:x.status,project:storeShootValues(normalizeShootValues(x.project)),location:storeShootValues(normalizeShootValues(x.location)),participants:[...new Set<string>(x.participants)],notes:x.notes,...(x.preparation!==undefined?{preparation:x.preparation}:{})};
 if(x.id){const rows=await getDb().update(shoots).set({...values,revision:x.revision!+1}).where(and(eq(shoots.id,x.id),eq(shoots.revision,x.revision!))).returning();if(!rows.length)return Response.json({error:'Запись уже изменена. Обновите календарь и откройте её снова.'},{status:409});return Response.json(rows[0]);}
 const [row]=await getDb().insert(shoots).values({...values,preparation:x.preparation??'',id:crypto.randomUUID()}).returning();return Response.json(row,{status:201});
 }catch{return Response.json({error:'Не удалось сохранить. Повторите попытку.'},{status:503});}}
export async function DELETE(req:Request){if(!safe(req)||!(await canEditCalendar()))return deny(req);try{const x=await req.json() as {id?:unknown;revision?:unknown};if(typeof x?.id!=='string'||!Number.isInteger(x.revision))return Response.json({error:'Неверный запрос'},{status:400});const rows=await getDb().delete(shoots).where(and(eq(shoots.id,x.id),eq(shoots.revision,x.revision as number))).returning();if(!rows.length)return Response.json({error:'Запись уже изменена. Обновите календарь.'},{status:409});return Response.json({ok:true});}catch{return Response.json({error:'Не удалось удалить запись'},{status:503});}}
