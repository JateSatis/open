import { markDeviceSignedOut, signOutLocally } from '@/api/account';

import { getInstallationId } from './installationId';
import { signOutOfGoogle } from './signIn';

/**
 * Выход из аккаунта на этом устройстве — только этот сеанс, остальные
 * телефоны остаются в аккаунте. Кеш и сторы чистит `AccountLifecycle`,
 * заметив, что сессии больше нет: так одинаково обрабатывается и этот
 * выход, и принудительный.
 */
export async function signOut(): Promise<void> {
  try {
    // Пока сессия ещё есть — после выхода отметить устройство будет нечем.
    await markDeviceSignedOut(await getInstallationId());
  } catch {
    // Без сети отметку поставит сама база: сеанс удалится при выходе, и
    // устройство перестанет числиться активным.
  }

  await signOutOfGoogle();
  await signOutLocally();
}

/**
 * Выход без вопросов и без ошибок на экране: сеанс уже мёртв на сервере
 * (завершён с другого устройства или аккаунт удалён). Для человека это
 * просто экран входа.
 */
export async function signOutQuietly(): Promise<void> {
  await signOutOfGoogle();
  await signOutLocally();
}
