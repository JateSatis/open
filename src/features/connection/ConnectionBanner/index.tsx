import { useEffect, useState } from 'react';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import {
  useConnectionStatus,
  type ConnectionStatus,
} from '@/features/connection/useConnectionStatus';
import { useTheme } from '@/hooks/use-theme';
import { Motion, Sizes } from '@/theme';

const LABELS = {
  offline: 'Нет сети',
  connecting: 'Подключение…',
} as const;

/**
 * Тонкая полоска под статус-баром корневых вкладок, пока связи нет. При
 * нормальной связи её нет и место не занято.
 *
 * Полоска, а не всплывающая плашка поверх, — сознательное решение: так
 * видно, что приложение не зависло, и при этом ничего не перекрывается.
 * Появляясь и пропадая, она плавно сдвигает экран, а не дёргает его.
 */
export function ConnectionBanner({ style: outer }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const status = useConnectionStatus();
  const offline = status !== 'online';
  // Что написано в полоске. Связь вернулась — текст остаётся, пока полоска
  // сворачивается, и уходит, когда она свернулась: иначе она съезжала бы пустой.
  const [shown, setShown] = useState<Exclude<ConnectionStatus, 'online'> | null>(
    offline ? status : null,
  );
  const height = useSharedValue(offline ? Sizes.connectionBanner : 0);

  if (offline && status !== shown) setShown(status);

  useEffect(() => {
    if (offline) {
      height.set(withTiming(Sizes.connectionBanner, { duration: Motion.connectionBannerMs }));
      return;
    }

    height.set(
      withTiming(0, { duration: Motion.connectionBannerMs }, (finished) => {
        if (finished) runOnJS(setShown)(null);
      }),
    );
  }, [height, offline]);

  const style = useAnimatedStyle(() => ({ height: height.value }));

  return (
    <Animated.View
      testID="connection-banner"
      accessibilityElementsHidden={!offline}
      importantForAccessibility={offline ? 'auto' : 'no-hide-descendants'}
      style={[styles.banner, { backgroundColor: theme.backgroundElement }, outer, style]}
    >
      {shown ? (
        <View style={styles.row} accessible accessibilityRole="text">
          {shown === 'connecting' ? <ActivityIndicator size="small" /> : null}
          <Text variant="small" color="textSecondary" numberOfLines={1}>
            {LABELS[shown]}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
