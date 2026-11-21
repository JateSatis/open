import { markDeviceSignedOut, signOutLocally } from '@/api/account';

import { getInstallationId } from './installationId';
import { withSessionChange } from './sessionChange';
import { signOutOfGoogle } from './signIn';
import { isCurrentSession, type SessionOwner } from './sessionOwner';
import { useSessionStore } from './sessionState';

/**
 * Выход из аккаунта на этом устройстве — только этот сеанс, остальные
 * телефоны остаются в аккаунте. Кеш и сторы чистит прежний AccountLayout.
 */
export async function signOut(owner: SessionOwner): Promise<void> {
  if (isCurrentSession(owner)) {
    try {
      const installation = await getInstallationId();
      await withSessionChange(async () => {
        if (isCurrentSession(owner)) await markDeviceSignedOut(installation, owner);
      });
    } catch {
      // Отзыв сеанса также убирает устройство из списка активных.
    }
  }

  await signOutQuietly(owner);
}

/**
 * Выход без вопросов и без ошибок на экране: сеанс уже мёртв на сервере
 * (завершён с другого устройства или аккаунт удалён). Для человека это
 * просто экран входа.
 */
export async function signOutQuietly(owner: SessionOwner): Promise<void> {
  if (isCurrentSession(owner)) await signOutOfGoogle();
  // Пока был открыт лист провайдера, пользователь мог выбрать другой аккаунт.
  // Удаляем исходный сеанс; повторный вход того же пользователя имеет другой session_id.
  if (useSessionStore.getState().localAccountId === owner.userId && !isCurrentSession(owner)) return;
  await signOutLocally(owner);
}
