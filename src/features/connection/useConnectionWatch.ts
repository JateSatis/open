import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  isRealtimeConnected,
  probeServer,
  reconnectRealtime,
  watchDeviceNetwork,
  watchRealtimeConnection,
} from '@/api/connection';
import {
  getConnectionStatus,
  reportDeviceNetwork,
  reportRealtimeDown,
  reportRealtimeJoined,
  reportRequestFailed,
  reportRequestSucceeded,
} from '@/features/connection/connectionStore';

// Раз в секунду: состояние сокета читается локально и ничего не стоит, а
// запрос наружу уходит только когда сокета нет. Реже — и возвращение связи
// замечается с задержкой, которая на глаз читается как «приложение тормозит».
const CHECK_INTERVAL_MS = 1000;
/** Во сколько раз реже стучимся на сервер, когда связь при этом жива. */
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
    // Пробы не должны накладываться: медленная попытка иначе тянет за собой
    // очередь таких же, и каждая следующая отвечает всё позже.
    let probing = false;

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

      ticks += 1;

      // Сокета нет, но и бить тревогу рано: если связь на месте, проверяем
      // редко, чтобы не гонять запросы впустую.
      const calm = getConnectionStatus() === 'online' && ticks % CALM_FACTOR !== 0;

      if (calm || probing) return;

      // Состояние тут намеренно не сбрасывается в «подключаемся»: такой сброс
      // на каждой проверке заставлял TanStack Query считать, что связь то
      // появляется, то пропадает, и список дёргался обновлением каждые
      // несколько секунд.

      probing = true;

      // Сокет пробуем поднять на каждой попытке: если сеть уже вернулась, он
      // встанет за доли секунды и сообщит об этом раньше пробы.
      reconnectRealtime();

      const reachable = await probeServer().finally(() => {
        probing = false;
      });

      if (cancelled) return;

      if (reachable) {
        reportRequestSucceeded();
        // Сеть есть — незачем ждать, пока клиент сам доберётся до следующей
        // попытки: события Realtime должны пойти сразу.
        reconnectRealtime();
        recover();
      } else {
        reportRequestFailed();
        wasDown = true;
      }
    };

    // Система сообщает о сети мгновенно — это и даёт реакцию быстрее любой
    // пробы. Но её «сеть есть» означает лишь наличие подключения, а не
    // доступность сервера, поэтому следом сразу проверяем по-настоящему.
    const stopDeviceWatch = watchDeviceNetwork((connected) => {
      reportDeviceNetwork(connected);

      if (connected) {
        void check();
      } else {
        wasDown = true;
      }
    });

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
      stopDeviceWatch();
      stopHeartbeat();
    };
  }, [queryClient]);
}
