/** Pay accounting. Amounts are integers in minor units (satang). Rates are always entered by the user. */
export const RATE_MODELS = ['per_reel', 'per_shoot_day', 'fixed_monthly', 'one_off'] as const;
export type RateModel = typeof RATE_MODELS[number];
export const RATE_MODEL_LABELS: Record<RateModel, string> = {
  per_reel: 'За опубликованный Reels', per_shoot_day: 'За съёмочный день', fixed_monthly: 'Фикс в месяц', one_off: 'Разовая работа',
};
const BASIS: Record<RateModel, string> = { per_reel: 'reel', per_shoot_day: 'shoot_day', fixed_monthly: 'fixed_monthly', one_off: 'one_off' };

export type RateRule = { id: string; member: string; model: string; amountMinor: number; currency: string; validFrom: string; validTo: string | null; active: number };
export type Unit = { id?: string; member: string; basis: string; basisKey: string; contentId: string | null; shootDate: string | null; period: string; rateRuleId: string | null; amountMinor: number; currency: string; description: string; voidedAt?: string | null };
export type Payment = { member: string; amountMinor: number; voidedAt: string | null };
type Item = { id: string; type: string; title: string; primaryMember: string; productionStatus: string; publishedAt: string | null };
type Shoot = { id?: string; date: string; status: string; participants: string[]; title: string };

/** The rule of a model that applies on a date: active, within validity; the latest valid_from wins. */
export function ruleFor(rules: RateRule[], member: string, model: RateModel, date: string): RateRule | null {
  return rules.filter(r => r.active && r.member === member && r.model === model && r.validFrom <= date && (!r.validTo || r.validTo >= date))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;
}

/**
 * Accruals the data supports for one period (YYYY-MM), minus those already recorded.
 * - per_reel: each published Reels in the period, for its primary presenter only (joint videos are not doubled);
 * - per_shoot_day: one unit per member per calendar day with a shoot marked «Снято», however many shoots or videos that day;
 * - fixed_monthly: one unit per member per period.
 * Production status alone never creates a payment; payments are recorded separately.
 */
export function suggestAccruals(period: string, rules: RateRule[], items: Item[], shoots: Shoot[], existing: Unit[]): Unit[] {
  const out: Unit[] = [];
  const have = new Set(existing.map(u => `${u.member}|${u.basis}|${u.basisKey}`));
  const push = (u: Unit) => { const k = `${u.member}|${u.basis}|${u.basisKey}`; if (!have.has(k)) { have.add(k); out.push(u); } };
  const lastDay = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);

  for (const i of items) {
    if (i.type !== 'reel' || i.productionStatus !== 'published' || !i.publishedAt?.startsWith(period)) continue;
    const r = ruleFor(rules, i.primaryMember, 'per_reel', i.publishedAt);
    if (r) push({ member: i.primaryMember, basis: BASIS.per_reel, basisKey: i.id, contentId: i.id, shootDate: null, period, rateRuleId: r.id, amountMinor: r.amountMinor, currency: r.currency, description: `Reels: ${i.title}` });
  }
  const days = new Map<string, Set<string>>();
  for (const s of shoots) {
    if (s.status !== 'Снято' || !s.date.startsWith(period)) continue;
    for (const m of s.participants) { if (!days.has(m)) days.set(m, new Set()); days.get(m)!.add(s.date); }
  }
  for (const [member, set] of days) for (const date of [...set].sort()) {
    const r = ruleFor(rules, member, 'per_shoot_day', date);
    if (r) push({ member, basis: BASIS.per_shoot_day, basisKey: date, contentId: null, shootDate: date, period, rateRuleId: r.id, amountMinor: r.amountMinor, currency: r.currency, description: `Съёмочный день ${date}` });
  }
  const members = [...new Set(rules.filter(r => r.model === 'fixed_monthly').map(r => r.member))];
  for (const member of members) {
    const r = ruleFor(rules, member, 'fixed_monthly', lastDay);
    if (r) push({ member, basis: BASIS.fixed_monthly, basisKey: period, contentId: null, shootDate: null, period, rateRuleId: r.id, amountMinor: r.amountMinor, currency: r.currency, description: `Фикс за ${period}` });
  }
  return out;
}

/** Totals per member: accrued (non-voided units), paid (non-voided payments), balance. */
export function balances(units: Unit[], pays: Payment[]) {
  const map = new Map<string, { member: string; units: number; accruedMinor: number; paidMinor: number; balanceMinor: number }>();
  const row = (m: string) => { if (!map.has(m)) map.set(m, { member: m, units: 0, accruedMinor: 0, paidMinor: 0, balanceMinor: 0 }); return map.get(m)!; };
  for (const u of units) if (!u.voidedAt) { const r = row(u.member); r.units++; r.accruedMinor += u.amountMinor; }
  for (const p of pays) if (!p.voidedAt) row(p.member).paidMinor += p.amountMinor;
  for (const r of map.values()) r.balanceMinor = r.accruedMinor - r.paidMinor;
  return [...map.values()].sort((a, b) => a.member.localeCompare(b.member));
}

/** "1 234,50" → 123450. Accepts comma or dot, at most 2 decimals, positive, up to 100 000 000. */
export function parseMoney(input: unknown): number | null {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const minor = Math.round(Number(s) * 100);
  return minor > 0 && minor <= 10_000_000_000 ? minor : null;
}
export const formatMoney = (minor: number, currency = 'THB') => `${(minor / 100).toLocaleString('ru', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })} ${currency === 'THB' ? '฿' : currency}`;
