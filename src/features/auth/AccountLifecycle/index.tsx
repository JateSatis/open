import { useAccountLifecycle } from '@/features/auth/useAccountLifecycle';

/**
 * Ничего не рисует. Отдельный компонент нужен, чтобы хук оказался внутри
 * провайдера запросов: при выходе он чистит кеш.
 */
export function AccountLifecycle() {
  useAccountLifecycle();

  return null;
}
