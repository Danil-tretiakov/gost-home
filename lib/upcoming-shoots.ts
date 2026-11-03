import { eventTimes } from './event-calendar';

type UpcomingShoot = {
  id?: string;
  date: string;
  time: string;
  duration: number;
  status: string;
};

const plannedStatuses = new Set(['Идея', 'Запланировано']);
const bangkokDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});
const shortDate = new Intl.DateTimeFormat('ru', {
  timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short',
});

/** The nearest planned shoots, including a shoot that is still in progress. */
export function getUpcomingShoots<T extends UpcomingShoot>(shoots: T[], now: Date, limit = 3): T[] {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime) || !Number.isFinite(limit) || limit < 1) return [];
  return shoots.flatMap((shoot, index) => {
    if (!plannedStatuses.has(shoot.status)) return [];
    try {
      const { start, end } = eventTimes(shoot);
      return end.getTime() > nowTime ? [{ shoot, start: start.getTime(), index }] : [];
    } catch { return []; }
  }).sort((a, b) => a.start - b.start || (a.shoot.id ?? '').localeCompare(b.shoot.id ?? '') || a.index - b.index)
    .slice(0, Math.floor(limit)).map(item => item.shoot);
}

/** Relative days are based on Bangkok, independently of the device timezone. */
export function upcomingDayLabel(date: string, now: Date): string {
  if (!Number.isFinite(now.getTime())) return '';
  try {
    const { start } = eventTimes({ date, time: '00:00', duration: 1 });
    const today = bangkokDate.format(now);
    if (date === today) return 'Сегодня';
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (date === tomorrow.toISOString().slice(0, 10)) return 'Завтра';
    return shortDate.format(start);
  } catch { return ''; }
}
