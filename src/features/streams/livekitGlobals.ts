import type { loadLiveKit } from './livekitSdk';

export type LiveKit = ReturnType<typeof loadLiveKit>;
let preparation: Promise<LiveKit> | undefined;

export function prepareLiveKit(): Promise<LiveKit> {
  if (!preparation) {
    preparation = Promise.resolve().then(() => {
      const sdk = require('./livekitSdk') as typeof import('./livekitSdk');
      return sdk.loadLiveKit();
    });
    // Фоновый вызов может остаться без ожидающего. Обработчик освобождает
    // кеш для следующей попытки, а текущий вход получает исходную ошибку.
    void preparation.catch(() => {
      preparation = undefined;
    });
  }
  return preparation;
}
