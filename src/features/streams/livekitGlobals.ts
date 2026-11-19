import { backgroundTimers } from '../../../modules/call-service';

function loadLiveKit() {
  // У RN-пакета собственный порядок полифилов и транзитивный импорт клиента.
  const { registerGlobals, AudioSession, AndroidAudioTypePresets } =
    require('@livekit/react-native') as typeof import('@livekit/react-native');
  registerGlobals();

  const { CriticalTimers, DisconnectReason, Room, RoomEvent } =
    require('livekit-client') as typeof import('livekit-client');
  // На Android сигнальные пинги должны продолжаться при сворачивании звонка.
  if (backgroundTimers) Object.assign(CriticalTimers, backgroundTimers);

  return { AudioSession, AndroidAudioTypePresets, DisconnectReason, Room, RoomEvent };
}

export type LiveKit = ReturnType<typeof loadLiveKit>;
let preparation: Promise<LiveKit> | undefined;

export function prepareLiveKit(): Promise<LiveKit> {
  if (!preparation) {
    preparation = Promise.resolve().then(loadLiveKit);
    // Фоновый вызов может остаться без ожидающего. Обработчик освобождает
    // кеш для следующей попытки, а текущий вход получает исходную ошибку.
    void preparation.catch(() => {
      preparation = undefined;
    });
  }
  return preparation;
}
