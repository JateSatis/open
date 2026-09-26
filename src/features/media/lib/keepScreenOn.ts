import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const TAG = 'voice-recording';

/** Не даёт экрану погаснуть; возвращает отмену — удобно прямо из `useEffect`. */
export function keepScreenOn(): () => void {
  activateKeepAwakeAsync(TAG).catch(() => undefined);

  return () => {
    deactivateKeepAwake(TAG).catch(() => undefined);
  };
}
