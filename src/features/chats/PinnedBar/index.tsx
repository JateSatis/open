import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { PinnedMessage } from '@/api/pins';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type PinnedBarProps = {
  /** От самого старого сообщения к самому новому. */
  pins: PinnedMessage[];
  /** Какой из закрепов сейчас в полосе. */
  index: number;
  onPress: (pin: PinnedMessage) => void;
};

/** Что написать о сообщении, у которого нет текста. */
export function pinnedSnippet(pin: PinnedMessage): string {
  if (pin.text?.trim()) return pin.text;
  if (pin.kind === 'voice') return '🎤 Голосовое';
  if (pin.kind === 'media' || pin.kind === 'photo' || pin.kind === 'video') return '📷 Медиа';

  return 'Сообщение';
}

/**
 * Полоса под шапкой чата: закреплённое сообщение и, если их несколько, его
 * номер. Тап ведёт к сообщению — что при этом происходит с полосой, решает
 * экран (переключает на предыдущее закреплённое, как в Telegram).
 */
export function PinnedBar({ pins, index, onPress }: PinnedBarProps) {
  const theme = useTheme();
  const pin = pins[index];

  if (!pin) return null;

  const title =
    pins.length > 1 ? `Закреплённое сообщение ${index + 1} из ${pins.length}` : 'Закреплённое сообщение';

  return (
    <Pressable
      testID="pinned-bar"
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${pinnedSnippet(pin)}`}
      onPress={() => onPress(pin)}
      style={[styles.bar, { backgroundColor: theme.background, borderBottomColor: theme.border }]}
    >
      <View style={[styles.accent, { backgroundColor: theme.primary }]} />

      {pin.thumbnailUrl ? (
        <Image
          source={{ uri: pin.thumbnailUrl }}
          style={[styles.thumbnail, { backgroundColor: theme.backgroundSelected }]}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View style={styles.body}>
        <Text variant="smallBold" color="primary" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {pinnedSnippet(pin)}
        </Text>
      </View>
    </Pressable>
  );
}
