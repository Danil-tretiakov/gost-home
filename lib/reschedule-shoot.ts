import { eventTimes } from './event-calendar';
import { normalizeShootStatus } from './shoot-status';

export type RescheduleShoot = {
  id?: string;
  date: string;
  time: string;
  duration: number;
  status: string;
  participants: string[];
};

const bangkokDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Existing planned shoots that overlap this time for at least one participant. */
export function conflictingShoots<T extends RescheduleShoot>(shoot: RescheduleShoot, rows: readonly T[]): T[] {
  if (!shoot.participants.length) return [];
  let candidate: ReturnType<typeof eventTimes>;
  try { candidate = eventTimes(shoot); } catch { return []; }
  return rows.filter(row => {
    if (shoot.id !== undefined && row.id === shoot.id) return false;
    if (normalizeShootStatus(row.status) !== 'Запланировано' || !row.participants.some(person => shoot.participants.includes(person))) return false;
    try {
      const other = eventTimes(row);
      return candidate.start.getTime() < other.end.getTime() && other.start.getTime() < candidate.end.getTime();
    } catch { return false; }
  });
}

/** Validation for a deliberate move; the current date is never a new day. */
export function validateRescheduleDate(date: string, shoot: RescheduleShoot, now: Date): string | null {
  if (!Number.isFinite(now.getTime())) return 'Не удалось определить текущее время. Обновите страницу.';
  let candidate: ReturnType<typeof eventTimes>;
  try { candidate = eventTimes({ ...shoot, date }); }
  catch { return 'Выберите корректную дату и время съёмки.'; }
  if (date === shoot.date) return 'Выберите другой день — дата не должна совпадать с текущей.';
  if (candidate.start.getTime() <= now.getTime()) return 'Выберите дату и время в будущем.';
  return null;
}

/** Up to three free days, at the same time, within thirty candidate days. */
export function suggestRescheduleDates(shoot: RescheduleShoot, rows: readonly RescheduleShoot[], now: Date, count = 3): string[] {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(count) || count < 1) return [];
  try { eventTimes(shoot); } catch { return []; }
  const today = bangkokDate.format(now);
  const nextOriginalDay = addDays(shoot.date, 1);
  const base = nextOriginalDay > today ? nextOriginalDay : today;
  const results: string[] = [];
  for (let offset = 0; offset < 30 && results.length < Math.floor(count); offset++) {
    const date = addDays(base, offset);
    if (validateRescheduleDate(date, shoot, now) !== null) continue;
    if (!conflictingShoots({ ...shoot, date }, rows).length) results.push(date);
  }
  return results;
}
