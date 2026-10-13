import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { registerDevice, touchDevice } from '@/api/account';
import { markSeen } from '@/api/chatInfo';
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
/**
 * Пока приложение открыто, отметка «был(а) в …» освежается так часто: если
 * приложение умрёт, не уйдя в фон, отметка отстанет не больше чем на это.
 */
const SEEN_INTERVAL_MS = 4 * 60 * 1000;

function markSeenQuietly() {
  markSeen().catch((error: unknown) => {
    if (!isNetworkError(error) && __DEV__) console.warn('mark_seen:', error);
  });
}

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
 * - сессия пропала или сменился пользователь — кеш и сторы очищаются;
 * - отметка «был(а) в …»: при входе, при уходе в фон и при возврате, и
 *   изредка, пока приложение открыто.
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

  useEffect(() => {
    if (!sessionId) return;

    markSeenQuietly();
    let timer: ReturnType<typeof setInterval> | null = setInterval(
      markSeenQuietly,
      SEEN_INTERVAL_MS,
    );

    // Уход в фон — главная точка: «был(а) в 16:10» — это когда свернули.
    // Запрос уходит сразу, пока JS ещё не заморожен; не успел — останется
    // отметка возврата или последняя из открытого приложения.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        markSeenQuietly();
        timer ??= setInterval(markSeenQuietly, SEEN_INTERVAL_MS);
        return;
      }

      if (state === 'background') {
        markSeenQuietly();
        if (timer) clearInterval(timer);
        timer = null;
      }
    });

    return () => {
      subscription.remove();
      if (timer) clearInterval(timer);
    };
  }, [sessionId]);
}
