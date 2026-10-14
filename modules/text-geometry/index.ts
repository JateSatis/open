import { requireOptionalNativeModule } from 'expo-modules-core';
import { findNodeHandle, type Text } from 'react-native';

/** Строка отрисованного текста. Смещения — UTF-16, координаты — dp от угла вью. */
export type TextLine = {
  start: number;
  /** Конец строки, не включая: перенос и пробел перед ним — ещё эта строка. */
  end: number;
  top: number;
  bottom: number;
  baseline: number;
  /** Края глифов строки, без пробелов в конце. */
  left: number;
  right: number;
};

/** Геометрия отрисованного текста — из того layout, которым он нарисован. */
export type TextGeometry = {
  /** Текст, как его разложил layout: сверять с тем, что выделяем. */
  text: string;
  width: number;
  height: number;
  lines: TextLine[];
  /** Левый край каждого символа (UTF-16) на его строке. */
  xs: number[];
};

type TextGeometryModule = {
  measure(viewTag: number): Promise<TextGeometry | null>;
};

// Необязательный: в сборке без модуля своего выделения нет — режим
// фрагментов не начинает выделение, а долгое нажатие открывает меню.
const native = requireOptionalNativeModule<TextGeometryModule>('TextGeometry');

export const textGeometryAvailable = native !== null;

/** Геометрия текста под ref. `null` — модуля нет, вью уже нет или это не текст. */
export async function measureText(text: Text | null): Promise<TextGeometry | null> {
  if (!native || !text) return null;

  const tag = findNodeHandle(text);

  if (tag === null) return null;

  try {
    return await native.measure(tag);
  } catch {
    return null;
  }
}
