import type { View } from 'react-native';

/** Замер приходит в следующем кадре; дольше — значит, его не будет. */
const MEASURE_WAIT_MS = 300;

export type WindowRect = { x: number; y: number; width: number; height: number };

/**
 * Угол и размер вью в координатах окна. Отсоединённая вью на замер не
 * отвечает вовсе — тогда `null` по таймауту, а не вечное ожидание.
 */
export function measureInWindow(node: View | null | undefined): Promise<WindowRect | null> {
  if (!node?.measureInWindow) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), MEASURE_WAIT_MS);

    node.measureInWindow((x, y, width, height) => {
      clearTimeout(timer);
      resolve(width > 0 || height > 0 ? { x, y, width, height } : null);
    });
  });
}
