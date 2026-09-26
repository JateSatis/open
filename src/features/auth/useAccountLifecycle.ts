import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { registerDevice, touchDevice } from '@/api/account';
import { sessionIdOf } from '@/lib/jwt';
import { isNetworkError } from '@/lib/network';

import { currentDeviceInfo } from './deviceInfo';
import { getInstallationId } from './installationId';
import { resetClientState } from './resetClientState';
import { signOutQuietly } from './signOut';
import { useSession } from './useSession';

/**
 * Жив ли ещё сеанс. Выданный access-токен работает до истечения, даже когда
 * сеанс завершили с другого устройства, поэтому спрашиваем базу. Сетевой сбой
 * — не повод выкидывать человека из аккаунта: ответа просто нет.
 */
async function sessionIsAlive(): Promise<boolean> {
  try {
    return await touchDevice(await getInstallationId());
  } catch (error) {
    if (!isNetworkError(error) && __DEV__) console.warn('touch_device:', error);

    return true;
  }
}

/**
 * Жизнь аккаунта на устройстве, в одном месте:
 * - новый сеанс (вход, привязка способа входа) — устройство регистрирует себя;
 * - возврат в приложение — отметка активности и проверка, что сеанс жив;
 *   мёртвый сеанс — тихий выход;
 * - сессия пропала или сменился пользователь — кеш и сторы очищаются.
 */
export function useAccountLifecycle() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const sessionId = session ? sessionIdOf(session.access_token) : null;
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;

    if (previous !== null && previous !== userId) resetClientState(queryClient);
  }, [queryClient, userId]);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    void (async () => {
      if (!(await sessionIsAlive())) {
        if (!cancelled) await signOutQuietly();
        return;
      }

      try {
        if (!cancelled) await registerDevice(await currentDeviceInfo());
      } catch (error) {
        if (!isNetworkError(error) && __DEV__) console.warn('register_device:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;

      void sessionIsAlive().then((alive) => {
        if (!alive) void signOutQuietly();
      });
    });

    return () => subscription.remove();
  }, [sessionId]);
}
