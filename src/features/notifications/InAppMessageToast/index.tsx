import { ToastCard } from './ToastCard';

import { useInAppAlerts } from '@/features/notifications/useInAppAlerts';

/**
 * Карточка о новом сообщении, заявке или короткий ответ на действие («Скопировано»)
 * поверх любого экрана. Живёт в корневом layout,
 * потому что уведомление не принадлежит ни одной вкладке.
 */
export function InAppMessageToast() {
  const { alert, dismiss } = useInAppAlerts();

  return <ToastCard alert={alert} dismiss={dismiss} />;
}
