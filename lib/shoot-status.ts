export const SHOOT_STATUSES = ['Запланировано', 'Снято', 'Перенесено', 'Отменено'];
/** Not happening on its date: cancelled, or postponed with the new date not chosen yet. */
export const isOffSchedule = (status: string) => status === 'Отменено' || status === 'Перенесено';

// Previously saved post-production stages are still completed shoots.
export function normalizeShootStatus(status: string): string {
  if (status === 'Идея') return 'Запланировано';
  return status === 'Монтаж' || status === 'Опубликовано' ? 'Снято' : status;
}
