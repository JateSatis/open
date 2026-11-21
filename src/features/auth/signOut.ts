import { markDeviceSignedOut, signOutLocally } from '@/api/account';

import { getInstallationId } from './installationId';
import { withSessionChange } from './sessionChange';
import { signOutOfGoogle } from './signIn';
import { isCurrentSession, type SessionOwner } from './sessionOwner';

/**
 * Выход из аккаунта на этом устройстве — только этот сеанс, остальные
 * телефоны остаются в аккаунте. Кеш и сторы чистит прежний AccountLayout.
 */
export async function signOut(owner: SessionOwner): Promise<void> {
  if (!isCurrentSession(owner)) return;
  try {
    // Пока сессия ещё есть — после выхода отметить устройство будет нечем.
    const installation = await getInstallationId();
    await withSessionChange(async () => {
      if (isCurrentSession(owner)) await markDeviceSignedOut(installation, owner);
    });
  } catch {
    // Без сети отметку поставит сама база: сеанс удалится при выходе, и
    // устройство перестанет числиться активным.
  }

  await signOutQuietly(owner);
}

/**
 * Выход без вопросов и без ошибок на экране: сеанс уже мёртв на сервере
 * (завершён с другого устройства или аккаунт удалён). Для человека это
 * просто экран входа.
 */
export async function signOutQuietly(owner: SessionOwner): Promise<void> {
  if (!isCurrentSession(owner)) return;
  await signOutOfGoogle();
  if (isCurrentSession(owner)) await signOutLocally(owner);
}
