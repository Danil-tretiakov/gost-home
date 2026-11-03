export const SHOOT_STATUSES = ['Запланировано', 'Снято', 'Отменено'];

// Previously saved post-production stages are still completed shoots.
export function normalizeShootStatus(status: string): string {
  if (status === 'Идея') return 'Запланировано';
  return status === 'Монтаж' || status === 'Опубликовано' ? 'Снято' : status;
}
