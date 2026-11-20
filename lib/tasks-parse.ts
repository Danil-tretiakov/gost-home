import type { TaskPriority } from './tasks';

/**
 * Smart quick add for the task planner: "Позвонить Лизе завтра в 15:00 !" → title, date, time, priority.
 * Pure and timezone-free: `today` is the Bangkok date (YYYY-MM-DD) supplied by the caller.
 */
export type QuickToken = { kind: 'date' | 'time' | 'priority'; text: string };
export type QuickTask = { title: string; dueDate: string | null; dueTime: string | null; priority: TaskPriority; tokens: QuickToken[] };

const B = '(?<=^|[\\s,(])';           // start of a word (JS \b does not work with Cyrillic)
const E = '(?=$|[\\s,.;:!?)])';       // end of a word
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (d: string) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0 = Monday
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

const WEEKDAYS: [RegExp, number][] = [
  [/пн|пон|понедельник|понедельника/, 0], [/вт|вторник|вторника/, 1], [/ср|среду|среда|среды/, 2], [/чт|четверг|четверга/, 3],
  [/пт|пятницу|пятница|пятницы/, 4], [/сб|субботу|суббота|субботы/, 5], [/вс|воскресенье|воскресенья/, 6],
];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTH_RE = '(январ[яь]|янв|феврал[яь]|фев|марта?|мар|апрел[яь]|апр|ма[яй]|июн[яь]|июн|июл[яь]|июл|августа?|авг|сентябр[яь]|сен|октябр[яь]|окт|ноябр[яь]|ноя|декабр[яь]|дек)\\.?';
const monthIndex = (w: string) => { const l = w.toLowerCase(); const i = MONTHS.findIndex((m, n) => n === 4 ? /^ма[яй]/.test(l) : l.startsWith(m)); return i + 1; };

/** Next date (from today) with that day and month; this year if not passed, otherwise next year. */
function nextDayMonth(today: string, d: number, m: number, y?: number): string | null {
  const [ty] = parts(today);
  if (y !== undefined) return valid(y, m, d) ? iso(y, m, d) : null;
  if (valid(ty, m, d) && iso(ty, m, d) >= today) return iso(ty, m, d);
  return valid(ty + 1, m, d) ? iso(ty + 1, m, d) : null;
}

/** `skip` turns off recognition of some kinds, so the words stay in the title (the user tapped the chip). */
export function parseQuickTask(input: string, today: string, skip: ReadonlySet<QuickToken['kind']> = new Set()): QuickTask {
  let text = ` ${input} `;
  const tokens: QuickToken[] = [];
  let dueDate: string | null = null, dueTime: string | null = null;
  let priority: TaskPriority = 'normal';
  /** Finds the first match, removes it from the text and records the token. */
  const take = (re: RegExp, kind: QuickToken['kind'], f: (m: RegExpMatchArray) => boolean) => {
    if (skip.has(kind)) return false;
    const m = text.match(re);
    if (!m || m.index === undefined || !f(m)) return false;
    tokens.push({ kind, text: m[0].trim() });
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return true;
  };
  const r = (src: string) => new RegExp(src, 'iu');

  // Priority: "!" or "!!" as a separate word, or "срочно" / "важно".
  take(r(`${B}(!{1,3}|срочно|важно)${E}`), 'priority', () => { priority = 'high'; return true; });

  // Time first, so "в 10:30" is not read as a date: "в 10:30", "к 9:00", "10:30".
  take(r(`${B}(?:(?:в|к|до)\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)${E}`), 'time', m => { dueTime = `${pad(Number(m[1]))}:${m[2]}`; return true; });

  const dateRules: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [r(`${B}(?:на\\s+)?послезавтра${E}`), () => addDays(today, 2)],
    [r(`${B}(?:на\\s+)?завтра${E}`), () => addDays(today, 1)],
    [r(`${B}(?:на\\s+)?сегодня${E}`), () => today],
    [r(`${B}через\\s+(\\d{1,3})\\s+(?:дн(?:я|ей)|день)${E}`), m => addDays(today, Number(m[1]))],
    [r(`${B}через\\s+(?:(\\d{1,2})\\s+)?(?:недел[юиь]|нед)${E}`), m => addDays(today, 7 * Number(m[1] ?? 1))],
    [r(`${B}через\\s+день${E}`), () => addDays(today, 2)],
    [r(`${B}(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{4}|\\d{2}))?${E}`), m => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
      return nextDayMonth(today, Number(m[1]), Number(m[2]), y);
    }],
    [r(`${B}(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?${E}`), m => nextDayMonth(today, Number(m[1]), monthIndex(m[2]), m[3] ? Number(m[3]) : undefined)],
    ...WEEKDAYS.map(([w, n]) => [r(`${B}(?:в[о]?\\s+|к\\s+)?(?:следующ(?:ий|ую|ее)\\s+)?(?:${w.source})${E}`), (m: RegExpMatchArray) => {
      const diff = (n - weekday(today) + 7) % 7;
      return addDays(today, diff === 0 && /следующ/i.test(m[0]) ? 7 : diff);
    }] as [RegExp, (m: RegExpMatchArray) => string | null]),
  ];
  for (const [re, f] of dateRules) {
    if (take(re, 'date', m => { const d = f(m); if (!d) return false; dueDate = d; return true; })) break;
  }
  if (dueTime && !dueDate) dueDate = today;

  const cleaned = text.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '').trim();
  const title = cleaned.charAt(0).toLocaleUpperCase('ru') + cleaned.slice(1);
  return { title, dueDate, dueTime, priority, tokens };
}
