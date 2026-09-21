import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { isRealtimeConnected, probeServer, watchRealtimeConnection } from '@/api/connection';
import {
  getConnectionStatus,
  reportRealtimeDown,
  reportRealtimeJoined,
  reportRequestFailed,
  reportRequestSucceeded,
} from '@/features/connection/connectionStore';

/** Как часто проверяем связь, когда её нет. */
const CHECK_INTERVAL_MS = 5000;
/** Во сколько раз реже стучимся на сервер, когда всё в порядке. */
const CALM_FACTOR = 6;

/**
 * Следит за связью и, как только она возвращается, перезапрашивает всё
 * устаревшее. Живёт в корне приложения в одном экземпляре.
 *
 * Пока сокет держится, наружу не ходим вообще: он сам и есть доказательство
 * связи. Ходим, только когда сокета нет — иначе приложение узнавало бы об
 * обрыве лишь в тот момент, когда пользователь сам что-то запросит.
 */
export function useConnectionWatch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let wasDown = getConnectionStatus() !== 'online';
    let ticks = 0;

    const recover = () => {
      // Пока связи не было, данные успели устареть, а события Realtime
      // потерялись — после возвращения перечитываем всё, что на экранах.
      if (wasDown) void queryClient.invalidateQueries();

      wasDown = false;
    };

    const check = async () => {
      if (cancelled || AppState.currentState !== 'active') return;

      if (isRealtimeConnected()) {
        reportRealtimeJoined();
        recover();
        return;
      }

      reportRealtimeDown();
      wasDown = true;

      ticks += 1;

      // Сокета нет, но и бить тревогу рано: если связь на месте, проверяем
      // редко, чтобы не гонять запросы впустую.
      const calm = getConnectionStatus() === 'online' && ticks % CALM_FACTOR !== 0;

      if (calm) return;

      const reachable = await probeServer();

      if (cancelled) return;

      if (reachable) {
        reportRequestSucceeded();
        recover();
      } else {
        reportRequestFailed();
        wasDown = true;
      }
    };

    const stopHeartbeat = watchRealtimeConnection((state) => {
      if (state === 'joined') {
        reportRealtimeJoined();
        recover();
        return;
      }

      reportRealtimeDown();
      wasDown = true;
    });

    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    // Приложение вернулось на передний план — состояние связи могло измениться,
    // пока оно было свёрнуто, и ждать целый интервал незачем.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });

    void check();

    return () => {
      cancelled = true;
      clearInterval(interval);
      appState.remove();
      stopHeartbeat();
    };
  }, [queryClient]);
}
