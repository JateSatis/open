// RN-пакет устанавливает собственные полифилы перед транзитивным импортом клиента.
// ESM-импорт клиента здесь и в RN-пакете даёт одну копию Room и CriticalTimers.
import { AndroidAudioTypePresets, AudioSession, registerGlobals } from '@livekit/react-native';
import { CriticalTimers, DisconnectReason, Room, RoomEvent } from 'livekit-client';

import { backgroundTimers } from '../../../modules/call-service';

export function loadLiveKit() {
  registerGlobals();
  // На Android сигнальные пинги должны продолжаться при сворачивании звонка.
  if (backgroundTimers) Object.assign(CriticalTimers, backgroundTimers);
  return { AudioSession, AndroidAudioTypePresets, DisconnectReason, Room, RoomEvent };
}
