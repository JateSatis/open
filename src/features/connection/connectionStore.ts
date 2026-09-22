import { onlineManager } from '@tanstack/react-query';
import { create } from 'zustand';

// Состояние связи с сервером — одно на всё приложение.
//
// Оно намеренно не спрашивает у системы, есть ли Wi-Fi: подключённая сеть без
// доступа наружу — обычное дело, и пользователю от такой «связи» толку нет.
// Судим по тому, что видим сами: держится ли сокет Realtime и проходят ли
// запросы. Это же и определяет, когда можно всё дозагрузить.

export type ConnectionStatus = 'online' | 'connecting' | 'offline';

type RealtimeState = 'joined' | 'down';
type RequestState = 'ok' | 'failed' | 'unknown';

type ConnectionStoreState = {
  realtime: RealtimeState;
  requests: RequestState;
  deviceOffline: boolean;
  status: ConnectionStatus;
};

const initialState: ConnectionStoreState = {
  realtime: 'down',
  requests: 'unknown',
  deviceOffline: false,
  status: 'connecting',
};

function derive(state: Pick<ConnectionStoreState, 'realtime' | 'requests' | 'deviceOffline'>): ConnectionStatus {
  // Система говорит, что подключения нет вообще. Это единственный сигнал,
  // который приходит мгновенно, и спорить с ним бессмысленно: без сети не
  // поможет ни живой сокет из прошлого, ни удачный запрос минуту назад.
  if (state.deviceOffline) return 'offline';

  // Сокет живёт — связь точно есть.
  if (state.realtime === 'joined') return 'online';
  // Сокет ещё поднимается, но запросы проходят: данные ходят, значит связь есть.
  if (state.requests === 'ok') return 'online';

  // Сеть на устройстве есть, а сервер не отвечает — это «подключение», а не
  // «нет сети». Разница не косметическая: раньше каждая неудачная проба
  // роняла состояние в «нет сети», и после возвращения сети оно прыгало
  // туда-сюда, ни разу не дойдя до рабочего.
  return 'connecting';
}

const useConnectionStore = create<ConnectionStoreState>(() => initialState);

function apply(patch: Partial<Pick<ConnectionStoreState, 'realtime' | 'requests' | 'deviceOffline'>>) {
  const prev = useConnectionStore.getState();
  const status = derive({ ...prev, ...patch });

  if (status !== prev.status) {
    // Пока связи нет, TanStack Query не должен долбиться в сеть; как только
    // она появляется, он сам перезапрашивает всё, что успело устареть.
    onlineManager.setOnline(status !== 'offline');
  }

  useConnectionStore.setState({ ...patch, status });
}

export function getConnectionStatus(): ConnectionStatus {
  return useConnectionStore.getState().status;
}

export function subscribeToConnectionStatus(listener: () => void): () => void {
  return useConnectionStore.subscribe((state, prevState) => {
    if (state.status !== prevState.status) listener();
  });
}

export function useConnectionStatus(): ConnectionStatus {
  return useConnectionStore((state) => state.status);
}

/**
 * Сеть на устройстве пропала или появилась — по данным системы.
 *
 * Появление сети не означает, что сервер доступен, поэтому «онлайн» отсюда не
 * объявляется: состояние возвращается к тому, что известно из сокета и
 * запросов, а проба уточнит остальное.
 */
export function reportDeviceNetwork(connected: boolean) {
  apply({
    deviceOffline: !connected,
    ...(connected ? {} : { realtime: 'down', requests: 'failed' }),
  });
}

export function reportRealtimeJoined() {
  apply({
    realtime: 'joined',
    requests: 'ok',
    // Живой сокет — прямое доказательство связи, оно сильнее мнения системы:
    // та может сообщить о появлении сети с заметной задержкой.
    deviceOffline: false,
  });
}

/**
 * Сокет отвалился. Про запросы в этот момент ничего не известно: сеть могла
 * пропасть, а могло упасть только соединение — поэтому не «нет сети», а
 * «подключаемся», пока что-нибудь не прояснится.
 */
export function reportRealtimeDown() {
  apply({ realtime: 'down', requests: 'unknown' });
}

export function reportRequestSucceeded() {
  apply({
    requests: 'ok',
    // Запрос дошёл до сервера — значит сеть есть, что бы ни считала система.
    deviceOffline: false,
  });
}

/**
 * Запрос не дошёл до сервера. Сокет при этом считаем упавшим, даже если он
 * ещё не успел это заметить: сеть общая. «Нет сети» из этого не следует —
 * недоступен может быть и один сервер.
 */
export function reportRequestFailed() {
  apply({ realtime: 'down', requests: 'failed' });
}

/** Только для тестов: вернуть состояние к исходному. */
export function resetConnectionState() {
  useConnectionStore.setState(initialState);
  onlineManager.setOnline(true);
}
