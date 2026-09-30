import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type CallServiceModule = {
  start(title: string, text: string, microphone: boolean): boolean;
  stop(): void;
};

// Только Android: на iOS звонок в фоне держит аудиосессия (UIBackgroundModes).
// Необязательный: в сборке без модуля звонок просто не держится в фоне.
const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<CallServiceModule>('CallService') : null;

/** Запускает службу звонка с уведомлением. `microphone` — я говорю, а не только слушаю. */
export function startCallService(title: string, text: string, microphone: boolean): boolean {
  try {
    return native?.start(title, text, microphone) ?? false;
  } catch {
    return false;
  }
}

export function stopCallService(): void {
  try {
    native?.stop();
  } catch {
    // Службы уже нет.
  }
}
