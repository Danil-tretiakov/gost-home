import { SHOOT_TEAM } from './shoot-team';

/** Monthly targets. Stored in app_settings under PLAN_SETTINGS_KEY; these are only the starting values from the brief. */
export type PlanSettings = {
  reelsPerMonth: number;
  youtubePerMonth: number;
  /** Reels per month by primary presenter. 0 means paused. */
  members: Record<string, number>;
  /** Approximate interval between Юля's publications, in calendar days. */
  yuliaIntervalDays: number;
};

export const PLAN_SETTINGS_KEY = 'plan';

export const DEFAULT_PLAN: PlanSettings = {
  reelsPerMonth: 30,
  youtubePerMonth: 2,
  members: { 'Юля': 10, 'Лиза': 10, 'Марк': 5, 'Андрей': 3, 'Лада': 2, 'Александр': 0 },
  yuliaIntervalDays: 3,
};

const NAMES = SHOOT_TEAM.map(m => m[0]);
const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Returns a clean PlanSettings or null when the input is not acceptable. Unknown members are rejected. */
export function parsePlanSettings(input: unknown): PlanSettings | null {
  if (!input || typeof input !== 'object') return null;
  const x = input as Record<string, unknown>;
  if (!int(x.reelsPerMonth, 0, 200) || !int(x.youtubePerMonth, 0, 50) || !int(x.yuliaIntervalDays, 1, 15)) return null;
  if (!x.members || typeof x.members !== 'object') return null;
  const members: Record<string, number> = {};
  for (const [name, value] of Object.entries(x.members as Record<string, unknown>)) {
    if (!NAMES.includes(name) || !int(value, 0, 200)) return null;
    members[name] = value as number;
  }
  for (const name of NAMES) members[name] ??= 0;
  return { reelsPerMonth: x.reelsPerMonth as number, youtubePerMonth: x.youtubePerMonth as number, yuliaIntervalDays: x.yuliaIntervalDays as number, members };
}

export function mergePlan(stored: unknown): PlanSettings {
  return parsePlanSettings(stored) ?? DEFAULT_PLAN;
}
