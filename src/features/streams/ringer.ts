import type { AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';

import RINGTONE from '../../../assets/sounds/ringtone.wav';

/** Вибрация в такт звонку: две трели и пауза. */
const VIBRATION_PATTERN = [0, 400, 200, 400, 3000];

/** Звук и вибрация, пока звонит входящий. */
export function startRinger() {
  let player: AudioPlayer | null = null;

  try {
    // Загружаем нативный аудиомодуль только при первом входящем.
    const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
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
      // В SDK 57 remove снимает регистрацию Android, release освобождает AudioTrack.
      player?.remove();
    } catch {
      // Даже если аудиосессия уже остановилась, освобождаем свою ссылку.
    }
    player?.release();
  };
}
