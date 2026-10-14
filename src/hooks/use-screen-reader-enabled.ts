import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// Включён ли скринридер (TalkBack, VoiceOver). Одна подписка на всё
// приложение: строк переписки много, и каждой своя подписка ни к чему.

let enabled = false;
const listeners = new Set<() => void>();
let started = false;

function start() {
  if (started) return;

  started = true;
  AccessibilityInfo.isScreenReaderEnabled()
    .then((value) => {
      enabled = value;
      listeners.forEach((listener) => listener());
    })
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('screenReaderChanged', (value: boolean) => {
    enabled = value;
    listeners.forEach((listener) => listener());
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function useScreenReaderEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}
