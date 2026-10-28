import Calendar from './calendar';
import { canEditCalendar } from './permissions';
export const dynamic='force-dynamic';
export default async function Page(){return <Calendar canEdit={await canEditCalendar()}/>}
