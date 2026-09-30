import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

type CallServiceModule = {
  start(title: string, text: string, microphone: boolean): boolean;
  stop(): void;
  setTimer(id: number, delayMs: number, repeat: boolean): void;
  clearTimer(id: number): void;
  addListener(event: 'onTimer', listener: (event: { id: number }) => void): EventSubscription;
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

type TimerCallback = (...args: unknown[]) => void;

export type BackgroundTimers = {
  setTimeout: (callback: TimerCallback, delay?: number, ...args: unknown[]) => number;
  setInterval: (callback: TimerCallback, delay?: number, ...args: unknown[]) => number;
  clearTimeout: (id: number | undefined) => void;
  clearInterval: (id: number | undefined) => void;
};

function createBackgroundTimers(module: CallServiceModule): BackgroundTimers {
  const callbacks = new Map<number, { run: () => void; repeat: boolean }>();
  let nextId = 1;

  module.addListener('onTimer', ({ id }) => {
    const timer = callbacks.get(id);

    if (!timer) return;
    if (!timer.repeat) callbacks.delete(id);

    timer.run();
  });

  const schedule =
    (repeat: boolean) =>
    (callback: TimerCallback, delay = 0, ...args: unknown[]) => {
      const id = nextId++;

      callbacks.set(id, { run: () => callback(...args), repeat });
      module.setTimer(id, Math.max(0, delay), repeat);

      return id;
    };

  const clear = (id: number | undefined) => {
    if (id === undefined || !callbacks.delete(id)) return;

    module.clearTimer(id);
  };

  return {
    setTimeout: schedule(false),
    setInterval: schedule(true),
    clearTimeout: clear,
    clearInterval: clear,
  };
}

/**
 * Таймеры, которые идут и у свёрнутого приложения. Нужны пингу LiveKit:
 * таймеры JS Android приостанавливает в фоне, и без пинга сервер выкидывает
 * участника из звонка. `null` — не Android или сборка без модуля.
 */
export const backgroundTimers: BackgroundTimers | null =
  // Сборка до появления таймеров в модуле: обходимся таймерами JS.
  native && typeof native.setTimer === 'function' ? createBackgroundTimers(native) : null;
