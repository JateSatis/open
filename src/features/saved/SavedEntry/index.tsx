import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type SavedEntryProps = {
  /** Невыполненные «Посмотреть позже»; 0 — счётчика нет. */
  watchLaterCount: number;
  onPress: () => void;
};

/** Закреплённая строка вверху «Чатов»: ведёт в «Сохранённые сообщения», видна всегда. */
export function SavedEntry({ watchLaterCount, onPress }: SavedEntryProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="saved-entry"
      accessibilityRole="button"
      accessibilityLabel={
        watchLaterCount > 0
          ? `Сохранённые сообщения, посмотреть позже: ${watchLaterCount}`
          : 'Сохранённые сообщения'
      }
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.border }]}
    >
      <View style={[styles.star, { backgroundColor: theme.primary }]}>
        <SymbolView
          name={{ ios: 'star.fill', android: 'star', web: 'star' }}
          size={Sizes.savedStarIcon}
          tintColor={theme.primaryText}
        />
      </View>

      <Text variant="bodyBold" numberOfLines={1} style={styles.title}>
        Сохранённые сообщения
      </Text>

      {watchLaterCount > 0 ? (
        <View testID="saved-entry-count" style={[styles.badge, { backgroundColor: theme.primary }]}>
          <Text variant="smallBold" style={{ color: theme.primaryText }}>
            {watchLaterCount}
          </Text>
        </View>
      ) : null}

      <Text variant="body" color="textSecondary">
        ›
      </Text>
    </Pressable>
  );
}
