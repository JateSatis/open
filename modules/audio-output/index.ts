import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/** Громкость медиа и куда идёт звук. */
export type AudioOutputState = {
  /** 0…1. */
  volume: number;
  /** Звук выключен: громкость медиа 0 или поток приглушён. */
  muted: boolean;
  route: 'speaker' | 'wired' | 'bluetooth' | 'airplay' | 'other';
};

type AudioOutputModule = {
  getState(): AudioOutputState;
  addListener(event: 'onChange', listener: (state: AudioOutputState) => void): EventSubscription;
};

// Необязательный: в сборке без модуля журнал просто не знает про звук.
const native = requireOptionalNativeModule<AudioOutputModule>('AudioOutput');

/** Есть ли в сборке модуль звука. */
export const audioOutputAvailable = native !== null;

export function getAudioOutputState(): AudioOutputState | null {
  try {
    return native?.getState() ?? null;
  } catch {
    return null;
  }
}

/** Громкость или маршрут поменялись. Без модуля — ничего не приходит. */
export function addAudioOutputListener(listener: (state: AudioOutputState) => void): () => void {
  const subscription = native?.addListener('onChange', listener);

  return () => subscription?.remove();
}
