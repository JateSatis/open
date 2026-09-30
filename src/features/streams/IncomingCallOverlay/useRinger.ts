import { createAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { Vibration } from 'react-native';

import RINGTONE from '../../../../assets/sounds/ringtone.wav';

/** Вибрация в такт звонку: две трели и пауза. */
const VIBRATION_PATTERN = [0, 400, 200, 400, 3000];

/** Звук и вибрация, пока звонит входящий. */
export function useRinger(active: boolean) {
  useEffect(() => {
    if (!active) return;

    let player: ReturnType<typeof createAudioPlayer> | null = null;

    try {
      player = createAudioPlayer(RINGTONE);
      player.loop = true;
      player.play();
    } catch {
      // Без звука входящий всё равно виден и вибрирует.
    }

    Vibration.vibrate(VIBRATION_PATTERN, true);

    return () => {
      Vibration.cancel();

      try {
        player?.pause();
        player?.remove();
      } catch {
        // Плеер уже освобождён.
      }
    };
  }, [active]);
}
