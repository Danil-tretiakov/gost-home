/** AI studio settings in app_settings['ai']. The default limit is 0: paid launches stay off until the owner sets a limit. */
export const AI_SETTINGS_KEY = 'ai';
export type AiSettings = { monthlyJobLimit: number };
export const DEFAULT_AI: AiSettings = { monthlyJobLimit: 0 };
export function parseAiSettings(v: unknown): AiSettings | null {
  const x = v as Record<string, unknown> | null;
  if (!x || !Number.isInteger(x.monthlyJobLimit) || (x.monthlyJobLimit as number) < 0 || (x.monthlyJobLimit as number) > 1000) return null;
  return { monthlyJobLimit: x.monthlyJobLimit as number };
}
