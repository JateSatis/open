import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

const FADE_MS = 150;

/**
 * Состояние воспроизведения поверх видео: значок по центру, пока на паузе,
 * и плашка «2×» сверху, пока держат палец. Касаний не принимают.
 */
export function PlaybackBadges({ paused, fast }: { paused: boolean; fast: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <>
      {paused ? (
        <Animated.View
          testID="pop-paused"
          entering={FadeIn.duration(FADE_MS)}
          exiting={FadeOut.duration(FADE_MS)}
          style={styles.center}
          pointerEvents="none"
        >
          <SymbolView
            name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
            size={Sizes.popPauseIcon}
            tintColor={theme.textOnMediaSecondary}
          />
        </Animated.View>
      ) : null}

      {fast ? (
        <View
          testID="pop-fast"
          style={[styles.fastBadge, { top: insets.top, backgroundColor: theme.mediaScrim }]}
          pointerEvents="none"
        >
          <Text variant="smallBold" color="textOnMedia">
            2×
          </Text>
        </View>
      ) : null}
    </>
  );
}
