/**
 * Week view helpers for the shoot calendar. Works on Bangkok calendar dates as YYYY-MM-DD strings,
 * using UTC arithmetic only, so the browser's own time zone never shifts a day.
 */
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

const toUtc = (d: string) => new Date(d + 'T00:00:00Z');
const fromUtc = (t: Date) => t.toISOString().slice(0, 10);

export function addDays(date: string, n: number) { const t = toUtc(date); t.setUTCDate(t.getUTCDate() + n); return fromUtc(t); }
/** Monday of the week containing the date. */
export function weekStart(date: string) { const t = toUtc(date); return addDays(date, -((t.getUTCDay() + 6) % 7)); }
export function weekDays(start: string) { return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }
export const weekdayShort = (i: number) => WEEKDAYS[i];

/** "17–23 ноября 2026", "29 декабря 2025 – 4 января 2026", "30 ноября – 6 декабря 2026". */
export function weekLabel(start: string) {
  const end = addDays(start, 6);
  const [y1, m1, d1] = start.split('-').map(Number), [y2, m2, d2] = end.split('-').map(Number);
  if (y1 !== y2) return `${d1} ${MONTHS_GEN[m1 - 1]} ${y1} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
  return `${d1}–${d2} ${MONTHS_GEN[m1 - 1]} ${y1}`;
}

/** End time of a shoot as HH:MM, with a +1 day flag when it runs past midnight. */
export function endTime(time: string, durationMin: number) {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + durationMin;
  const days = Math.floor(total / 1440), m = total % 1440;
  return { time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, nextDay: days > 0 };
}

/** First day of the month a week belongs to for the month view: the month of its Thursday (ISO rule). */
export const monthOfWeek = (start: string) => addDays(start, 3).slice(0, 7);
export const shiftWeek = (start: string, n: number) => addDays(start, 7 * n);
