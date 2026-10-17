import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

export type ScrollTapProps = ViewProps & {
  /**
   * Порог скорости списка, dp/с: едет медленнее (хвост инерции, отскок от
   * края) — касание сразу достаётся тому, что под пальцем, а не только
   * останавливает список.
   */
  slowVelocity?: number;
};

// Только Android: на iOS касание по замедляющемуся списку и так доходит до
// содержимого. Необязательный: в сборке без модуля — обычная обёртка.
const available =
  Platform.OS === 'android' && requireOptionalNativeModule('ScrollTap') !== null;
const NativeScrollTap: ComponentType<ScrollTapProps> | null = available
  ? requireNativeViewManager<ScrollTapProps>('ScrollTap')
  : null;

/** Порог по умолчанию: хвост инерции, который глазу уже кажется остановкой. */
export const SLOW_SCROLL_VELOCITY = 500;

/**
 * Обёртка над списком: тап по содержимому медленно едущего или отскакивающего
 * списка срабатывает с первого касания, быстрый полёт первое касание по-прежнему
 * только останавливает. См. `ScrollTapView.kt`.
 */
export function ScrollTap({ slowVelocity = SLOW_SCROLL_VELOCITY, ...props }: ScrollTapProps) {
  if (!NativeScrollTap) return <View {...props} />;

  return <NativeScrollTap collapsable={false} slowVelocity={slowVelocity} {...props} />;
}
