import { normalizeShootValues } from './shoot-values';

export type CalendarShoot = {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  format: string;
  status: string;
  project: string;
  location: string;
  participants: string[];
  notes: string;
  revision: number;
};

/** The schedule stores local Bangkok times and durations in minutes. */
export function eventTimes(shoot: Pick<CalendarShoot, 'date' | 'time' | 'duration'>): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shoot.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(shoot.time) || !Number.isInteger(shoot.duration) || shoot.duration < 1) {
    throw new Error('Некорректная дата или длительность съёмки');
  }
  const start = new Date(`${shoot.date}T${shoot.time}:00+07:00`);
  if (!Number.isFinite(start.getTime()) || new Date(start.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16) !== `${shoot.date}T${shoot.time}`) {
    throw new Error('Некорректная дата съёмки');
  }
  const end = new Date(start.getTime() + shoot.duration * 60 * 1000);
  if (!Number.isFinite(end.getTime())) throw new Error('Некорректная длительность съёмки');
  return { start, end };
}

function utc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** RFC 5545 TEXT escaping also prevents user text from injecting properties. */
function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\u0000/g, '');
}

/** A folded physical line is at most 75 UTF-8 octets, including its leading space. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const physical: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      physical.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  physical.push(current);
  return physical.join('\r\n');
}

/** A one-event import, never a meeting invitation or a calendar subscription. */
export function eventCalendar(shoot: CalendarShoot, eventUrl: string, now: Date = new Date()): string {
  const { start, end } = eventTimes(shoot);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(shoot.id) || !Number.isInteger(shoot.revision) || shoot.revision < 0) throw new Error('Некорректный идентификатор съёмки');
  if (/[\r\n\u0000]/.test(eventUrl)) throw new Error('Некорректная ссылка на съёмку');
  const url = new URL(eventUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Некорректная ссылка на съёмку');

  const projects = normalizeShootValues(shoot.project);
  const locations = normalizeShootValues(shoot.location);
  const cancelled = shoot.status === 'Отменено';
  const description = [
    `Формат: ${shoot.format}`,
    `Статус: ${shoot.status}`,
    shoot.participants.length ? `Участники: ${shoot.participants.join(', ')}` : '',
    projects.length ? `Проекты: ${projects.join(', ')}` : '',
    shoot.notes ? `Заметки: ${shoot.notes}` : '',
    'Время съёмки указано по Бангкоку (UTC+7).',
    `Актуальные детали: ${url.href}`,
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gost Home//Shoot Calendar//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${shoot.id}@gost-home-calendar`,
    `DTSTAMP:${utc(now)}`,
    `SEQUENCE:${shoot.revision}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${text(`Gost Home · ${shoot.title}`)}`,
    `DESCRIPTION:${text(description)}`,
    ...(locations.length ? [`LOCATION:${text(locations.join('; '))}`] : []),
    `URL:${url.href}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `TRANSP:${cancelled ? 'TRANSPARENT' : 'OPAQUE'}`,
    ...(!cancelled && start.getTime() > now.getTime() ? [
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-P1D',
      `DESCRIPTION:${text(`Завтра съёмка Gost Home: ${shoot.title}`)}`,
      'END:VALARM',
    ] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
