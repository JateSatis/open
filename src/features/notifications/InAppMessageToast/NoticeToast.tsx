import { ToastCard } from './ToastCard';

import { dismissAlert, useInAppAlert } from '@/features/notifications/alertsStore';

/**
 * Короткие ответы на действие внутри своего окна (`Modal`), которое закрывает
 * корневую карточку, — например, панели комментариев. Только из хранилища:
 * личный канал Realtime держит корневая карточка, и вторая подписка на тот же
 * топик оборвала бы её. Карточки о сообщениях здесь не показываются: переход
 * в чат по ним увёл бы экран у окна из-под ног.
 */
export function InAppNoticeToast() {
  const alert = useInAppAlert((state) => state.alert);

  return <ToastCard alert={alert?.kind === 'notice' ? alert : null} dismiss={dismissAlert} />;
}
