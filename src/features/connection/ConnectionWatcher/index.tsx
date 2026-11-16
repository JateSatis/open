import { useEffect } from 'react';

import { syncQueryOnlineState } from '@/features/connection/syncQueryOnlineState';
import { useConnectionWatch } from '@/features/connection/useConnectionWatch';

/**
 * Ничего не рисует — только держит наблюдение за связью живым. Отдельный
 * компонент нужен, чтобы хук оказался внутри провайдера запросов: ему нужен
 * доступ к кешу, чтобы перечитать данные после возвращения сети.
 */
export function ConnectionWatcher() {
  useEffect(syncQueryOnlineState, []);
  useConnectionWatch();

  return null;
}
