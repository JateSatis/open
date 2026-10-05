import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import type { DeliveryStatus } from '@/features/chats/messages/types';
import { useTheme } from '@/hooks/use-theme';

export type IslandHeaderProps = {
  /** Чат, откуда пересылали. `null` — его удалили. */
  sourceName: string | null;
  /** Островок ещё едет на сервер или упал. */
  status: DeliveryStatus;
  /** Тап по плашке — чат, откуда пересылали. */
  onPress?: () => void;
  onRetry?: () => void;
};

/**
 * Плашка над облачками островка: из какого чата переслали. Маленькая, но
 * заметная — островок сам по себе не сообщение, и эта строка объясняет, что
 * облачки под ней живут в другом месте.
 */
export function IslandHeader({ sourceName, status, onPress, onRetry }: IslandHeaderProps) {
  const theme = useTheme();
  const name = sourceName ?? 'удалённый чат';

  return (
    <View testID="island-header" style={styles.header}>
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={`Переслано из чата «${name}»`}
        disabled={!onPress}
        onPress={onPress}
        style={[styles.plate, { backgroundColor: theme.islandPlate }]}
      >
        <Text variant="smallBold" numberOfLines={1} style={{ color: theme.primary }}>
          {`↪ ${name}`}
        </Text>
      </Pressable>

      {status === 'sending' ? (
        <View accessible accessibilityLabel="Отправляется" style={styles.spinnerBox}>
          <ActivityIndicator
            testID="island-sending"
            size="small"
            color={theme.textSecondary}
            style={styles.spinner}
          />
        </View>
      ) : status === 'failed' ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text variant="caption" color="danger">
            Не отправлено. Повторить
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
