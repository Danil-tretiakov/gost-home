import type { PlanSettings } from './plan-settings';

export type PlanItem = {
  id: string; revision?: number; type: 'reel' | 'youtube'; title: string; primaryMember: string;
  plannedPublishDate: string | null; publishedAt: string | null; productionStatus: string;
};

export type ProposedSlot = {
  date: string; member: string;
  kind: 'assign' | 'new' | 'empty';
  itemId: string | null; itemRevision?: number; title: string;
  note?: string;
};

export type AutoplanResult = {
  month: string; from: string; to: string;
  slots: ProposedSlot[];
  conflicts: string[];
  /** Per member: target, already counted this month (dated or published), proposed now. */
  members: { member: string; target: number; existing: number; proposed: number }[];
};

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(iso + 'T00:00:00Z').getTime();
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const STATUS_PREF = ['approved', 'awaiting_feedback', 'changes_requested', 'editing', 'shot', 'planned'];

/**
 * Preliminary Reels schedule for one month. Never moves already dated or published items and never assigns an item twice.
 * Юля is placed about every `yuliaIntervalDays`, counting from her last date even if it is in the previous month; when that cannot fit her remaining quota before month end,
 * a conflict is reported and the remaining dates use the widest interval that fits (marked in `note`).
 */
export function autoplan(items: PlanItem[], month: string, today: string, plan: PlanSettings, opts: { fillEmpty: boolean }): AutoplanResult {
  const first = month + '-01';
  const lastT = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getTime();
  const to = toIso(lastT);
  const from = today > first ? today : first;
  const conflicts: string[] = [];
  if (from > to) return { month, from, to, slots: [], conflicts: ['Месяц уже закончился: планировать можно только будущие даты.'], members: [] };

  const days: string[] = [];
  for (let t = toDate(from); t <= lastT; t += DAY) days.push(toIso(t));
  const reels = items.filter(i => i.type === 'reel' && i.productionStatus !== 'cancelled');
  const inMonth = (d: string | null) => !!d && d.slice(0, 7) === month;
  const counted = reels.filter(i => i.productionStatus === 'published' ? inMonth(i.publishedAt) : inMonth(i.plannedPublishDate));

  const occupancy = new Map<string, number>(days.map(d => [d, 0]));
  const memberDays = new Map<string, Set<string>>();
  for (const i of counted) {
    const d = i.productionStatus === 'published' ? i.publishedAt! : i.plannedPublishDate!;
    if (occupancy.has(d)) occupancy.set(d, occupancy.get(d)! + 1);
    if (!memberDays.has(i.primaryMember)) memberDays.set(i.primaryMember, new Set());
    memberDays.get(i.primaryMember)!.add(d);
  }
  const members = Object.entries(plan.members).map(([member, target]) => ({ member, target, existing: counted.filter(i => i.primaryMember === member).length, proposed: 0 }));
  const need = new Map(members.map(m => [m.member, Math.max(0, m.target - m.existing)]));
  const totalTarget = plan.reelsPerMonth;
  const memberSum = members.reduce((a, m) => a + m.target, 0);
  if (memberSum !== totalTarget) conflicts.push(`Сумма планов участников (${memberSum}) не равна плану месяца (${totalTarget}). Распределяю по планам участников.`);

  const slots: { date: string; member: string; note?: string }[] = [];
  const place = (member: string, date: string, note?: string) => {
    slots.push({ date, member, note });
    occupancy.set(date, (occupancy.get(date) ?? 0) + 1);
    if (!memberDays.has(member)) memberDays.set(member, new Set());
    memberDays.get(member)!.add(date);
  };

  // 1. Юля on a regular interval, continuing from her latest date this month.
  const yulia = 'Юля';
  let yNeed = need.get(yulia) ?? 0;
  if (yNeed > 0) {
    const interval = Math.max(1, plan.yuliaIntervalDays);
    // The rhythm continues across the month boundary: her latest date before `from` may be in the previous month.
    const before = reels.filter(i => i.primaryMember === yulia)
      .map(i => (i.productionStatus === 'published' ? i.publishedAt : i.plannedPublishDate))
      .filter((d): d is string => !!d && d < from).sort();
    let next = before.length ? Math.max(toDate(before.at(-1)!) + interval * DAY, toDate(from)) : toDate(from);
    const fits = Math.floor((lastT - next) / (interval * DAY)) + 1;
    let step = interval;
    if (fits < yNeed) {
      const remainingDays = Math.floor((lastT - next) / DAY) + 1;
      step = yNeed > 1 ? Math.max(1, Math.floor((remainingDays - 1) / (yNeed - 1))) : interval;
      conflicts.push(`Юля: при интервале ${interval} дн. до ${to.split('-').reverse().join('.')} помещается ${Math.max(0, fits)} из ${yNeed} нужных роликов. Предлагаю интервал ${step} дн${step === 1 && remainingDays < yNeed ? `. и всё равно не хватает ${yNeed - remainingDays} дат: их нужно перенести на следующий месяц.` : '.'}`);
    }
    if (!memberDays.has(yulia)) memberDays.set(yulia, new Set());
    const taken = memberDays.get(yulia)!;
    while (yNeed > 0 && next <= lastT) {
      const d = toIso(next);
      if (!taken.has(d)) { place(yulia, d, step !== interval ? `интервал ${step} дн.` : undefined); yNeed--; }
      next += step * DAY;
    }
    // Dates already taken by her dated items can swallow interval positions; place the rest on free days farthest from her other dates.
    while (yNeed > 0) {
      const own = [...taken].map(toDate);
      const free = days.filter(d => !taken.has(d));
      if (!free.length) break;
      const best = free.map(d => ({ d, gap: own.length ? Math.min(...own.map(t => Math.abs(toDate(d) - t))) : Infinity })).sort((x, y) => y.gap - x.gap || x.d.localeCompare(y.d))[0];
      place(yulia, best.d, 'дата вне ритма: остальные дни заняты');
      yNeed--;
    }
    need.set(yulia, yNeed);
  }

  // 2. Everyone else, spread evenly; each slot goes to the least busy free day nearest its ideal position.
  const others = members.filter(m => m.member !== yulia && (need.get(m.member) ?? 0) > 0).sort((a, b) => (need.get(b.member)! - need.get(a.member)!) || a.member.localeCompare(b.member));
  const queue: { member: string; ideal: number }[] = [];
  for (const m of others) {
    const k = need.get(m.member)!;
    for (let i = 0; i < k; i++) queue.push({ member: m.member, ideal: (i + 0.5) * days.length / k });
  }
  queue.sort((a, b) => a.ideal - b.ideal);
  for (const q of queue) {
    const mine = memberDays.get(q.member) ?? new Set<string>();
    let best = -1; let bestScore = Infinity;
    days.forEach((d, idx) => {
      if (mine.has(d)) return;
      const score = (occupancy.get(d)! * 1000) + Math.abs(idx + 0.5 - q.ideal);
      if (score < bestScore) { bestScore = score; best = idx; }
    });
    if (best < 0) { conflicts.push(`${q.member}: не хватает свободных дней до конца месяца.`); continue; }
    place(q.member, days[best]);
    need.set(q.member, need.get(q.member)! - 1);
  }

  // 3. Fill slots with undated videos of the same presenter from the bank (most ready first), never twice.
  const bank = reels.filter(i => !i.plannedPublishDate && i.productionStatus !== 'published')
    .sort((a, b) => STATUS_PREF.indexOf(a.productionStatus) - STATUS_PREF.indexOf(b.productionStatus) || a.title.localeCompare(b.title));
  const used = new Set<string>();
  const result: ProposedSlot[] = slots.sort((a, b) => a.date.localeCompare(b.date) || a.member.localeCompare(b.member)).map(s => {
    const item = bank.find(i => i.primaryMember === s.member && !used.has(i.id));
    if (item) { used.add(item.id); return { ...s, kind: 'assign', itemId: item.id, itemRevision: item.revision, title: item.title }; }
    return { ...s, kind: opts.fillEmpty ? 'new' : 'empty', itemId: null, title: `Reels: ${s.member}` };
  });
  for (const m of members) m.proposed = result.filter(s => s.member === m.member).length;
  return { month, from, to, slots: result, conflicts, members };
}
