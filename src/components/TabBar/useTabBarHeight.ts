import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarSizes } from '@/theme';

/** Высота панели вкладок без дымки над значками — от нижнего края экрана до верха значков. */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();

  return (
    TabBarSizes.icon + TabBarSizes.labelGap + TabBarSizes.label + TabBarSizes.bottom + insets.bottom
  );
}
