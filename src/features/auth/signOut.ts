import { markDeviceSignedOut, signOutLocally } from '@/api/account';

import { getInstallationId } from './installationId';
import { signOutOfGoogle } from './signIn';
import { confirmedAccountId, useSessionStore } from './sessionState';

/**
 * Выход из аккаунта на этом устройстве — только этот сеанс, остальные
 * телефоны остаются в аккаунте. Кеш и сторы чистит `AccountLifecycle`,
 * заметив, что сессии больше нет: так одинаково обрабатывается и этот
 * выход, и принудительный.
 */
export async function signOut(owner: string): Promise<void> {
  const isCurrent = () => confirmedAccountId(useSessionStore.getState()) === owner;
  if (!isCurrent()) return;
  try {
    // Пока сессия ещё есть — после выхода отметить устройство будет нечем.
    const installation = await getInstallationId();
    if (!isCurrent()) return;
    await markDeviceSignedOut(installation);
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
export async function signOutQuietly(owner: string | null | undefined): Promise<void> {
  const isCurrent = () => !owner || confirmedAccountId(useSessionStore.getState()) === owner;
  if (!isCurrent()) return;
  await signOutOfGoogle();
  if (isCurrent()) await signOutLocally(owner ?? undefined);
}
