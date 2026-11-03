export const SHOOT_STATUSES = ['Идея', 'Запланировано', 'Снято', 'Отменено'];

// Previously saved post-production stages are still completed shoots.
export function normalizeShootStatus(status: string): string {
  return status === 'Монтаж' || status === 'Опубликовано' ? 'Снято' : status;
}
