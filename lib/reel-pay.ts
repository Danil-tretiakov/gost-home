import { isShotStatus, type ContentStatus } from './content-status';
import { SHOOT_TEAM } from './shoot-team';
import { DEFAULT_PLAN } from './plan-settings';

/**
 * «Осталось оплатить N рилс»: a simple counter the owner keeps by hand.
 * Shot = Reels at «Снято» or later for the primary presenter (all time, cancelled and paused excluded); the owner may correct it.
 * Paid = a count the owner enters. Nothing here creates or changes payments. Stored in app_settings[REEL_PAY_KEY], finance-only.
 */
export const REEL_PAY_KEY = 'reel_pay_counts';
export type ReelPayStore = { paid: Record<string, number>; shotOverride: Record<string, number> };
export type ReelPayRow = { member: string; shotAuto: number; shot: number; overridden: boolean; paid: number; remaining: number };
type Item = { type: string; primaryMember: string; productionStatus: ContentStatus | string };

/** Team names in plan order (Юля, Лиза, Марк, …), then anyone else from the team list. */
export const REEL_PAY_MEMBERS = [...new Set([...Object.keys(DEFAULT_PLAN.members), ...SHOOT_TEAM.map(m => m[0])])].filter(n => SHOOT_TEAM.some(m => m[0] === n));
export const emptyReelPay = (): ReelPayStore => ({ paid: {}, shotOverride: {} });
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000;

/** Validates a store from the browser or the database. Unknown names and bad numbers are rejected, not dropped. */
export function parseReelPay(x: unknown): ReelPayStore | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out = emptyReelPay();
  for (const key of ['paid', 'shotOverride'] as const) {
    const v = (x as Record<string, unknown>)[key] ?? {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    for (const [name, n] of Object.entries(v as Record<string, unknown>)) {
      if (!REEL_PAY_MEMBERS.includes(name) || !count(n)) return null;
      out[key][name] = n as number;
    }
  }
  return out;
}

export function reelPayRows(items: Item[], store: ReelPayStore): ReelPayRow[] {
  const names = [...REEL_PAY_MEMBERS];
  for (const i of items) if (i.type === 'reel' && isShotStatus(i.productionStatus as ContentStatus) && !names.includes(i.primaryMember)) names.push(i.primaryMember);
  return names.map(member => {
    const shotAuto = items.filter(i => i.type === 'reel' && i.primaryMember === member && isShotStatus(i.productionStatus as ContentStatus)).length;
    const overridden = store.shotOverride[member] !== undefined;
    const shot = overridden ? store.shotOverride[member] : shotAuto;
    const paid = store.paid[member] ?? 0;
    return { member, shotAuto, shot, overridden, paid, remaining: Math.max(0, shot - paid) };
  });
}

export const reelPayTotal = (rows: ReelPayRow[]) => rows.reduce((a, r) => a + r.remaining, 0);
