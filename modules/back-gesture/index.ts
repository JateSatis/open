import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

export type BackGestureEvent = {
  /** 0…1 — насколько далеко увели палец, по оценке системы. */
  progress: number;
  /** Где палец сейчас, в dp от левого края. */
  touchX: number;
  edge: 'left' | 'right';
};

type BackGestureModule = {
  setEnabled(enabled: boolean): Promise<void>;
  addListener(
    event: 'onBackStarted' | 'onBackProgressed',
    listener: (event: BackGestureEvent) => void,
  ): EventSubscription;
  addListener(event: 'onBackCancelled' | 'onBackInvoked', listener: () => void): EventSubscription;
};

// Только Android: на iOS «назад» — свайп от края, который экран ведёт сам.
// Необязательный: в сборке без модуля экран закрывается обычным «назад».
const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<BackGestureModule>('BackGesture') : null;

export type BackGestureHandlers = {
  onStart: (event: BackGestureEvent) => void;
  onProgress: (event: BackGestureEvent) => void;
  onCancel: () => void;
  /** Жест доведён до конца или нажата кнопка «назад». */
  onBack: () => void;
};

/** Есть ли в сборке перехват жеста. Без него «назад» идёт обычным путём. */
export const backGestureAvailable = native !== null;

// Перехватчиков может быть несколько (страница поверх страницы) — жест
// достаётся последнему, то есть верхнему экрану.
const stack: BackGestureHandlers[] = [];
let listening = false;

function top(): BackGestureHandlers | undefined {
  return stack[stack.length - 1];
}

function listen(module: BackGestureModule) {
  if (listening) return;

  listening = true;
  module.addListener('onBackStarted', (event) => top()?.onStart(event));
  module.addListener('onBackProgressed', (event) => top()?.onProgress(event));
  module.addListener('onBackCancelled', () => top()?.onCancel());
  module.addListener('onBackInvoked', () => top()?.onBack());
}

/**
 * Перехватить системное «назад» с ходом жеста. Пока перехват стоит, «назад»
 * не доходит до навигации: закрыть экран — дело `onBack`. Отдаёт отписку.
 */
export function interceptBackGesture(handlers: BackGestureHandlers): () => void {
  if (!native) return () => {};

  listen(native);
  stack.push(handlers);
  if (stack.length === 1) void native.setEnabled(true).catch(() => {});

  return () => {
    const index = stack.lastIndexOf(handlers);

    if (index === -1) return;

    stack.splice(index, 1);
    if (stack.length === 0) void native.setEnabled(false).catch(() => {});
  };
}
