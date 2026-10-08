import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import type { Pop } from '@/api/pops';
import { Text } from '@/components/Text';
import { PopCover } from '@/features/pops/PopCover';
import type { PendingPop } from '@/features/pops/publishing';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

/** Плитка «+»: новый поп. `label` — подпись под знаком, в шите она нужна. */
export const AddPopTile = memo(function AddPopTile({
  label,
  onPress,
}: {
  label?: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      testID="pop-add-tile"
      accessibilityRole="button"
      accessibilityLabel="Новый поп"
      onPress={onPress}
      style={({ pressed }) => [
        styles.add,
        { backgroundColor: theme.backgroundElement },
        pressed && { opacity: Opacity.pressed },
      ]}
    >
      <SymbolView
        name={{ ios: 'plus', android: 'add', web: 'add' }}
        size={Sizes.popAddIcon}
        tintColor={theme.text}
      />
      {label ? (
        <Text variant="small" style={styles.addLabel}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
});

type PublishedTileProps = {
  pop: Pop;
  /** Нет — тап ничего не делает (просмотр попа — следующий этап). */
  onPress?: (pop: Pop) => void;
  /** Взять нельзя: притушена и не нажимается. */
  disabled?: boolean;
  showDuration?: boolean;
};

export const PublishedPopTile = memo(function PublishedPopTile({
  pop,
  onPress,
  disabled = false,
  showDuration = false,
}: PublishedTileProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="pop-tile"
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel="Поп"
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={() => onPress?.(pop)}
      style={styles.fill}
    >
      <PopCover
        posterUri={pop.posterUrl}
        durationMs={showDuration ? pop.durationMs : null}
        showLabel={false}
        recyclingKey={pop.id}
      />
      {disabled ? (
        <View
          testID="pop-tile-unavailable"
          style={[styles.fill, { backgroundColor: theme.background, opacity: Opacity.unavailable }]}
        />
      ) : null}
    </Pressable>
  );
});

/** Поп в пути: локальный кадр и крутилка, а при сбое — значок с повтором. */
export const PendingPopTile = memo(function PendingPopTile({
  pending,
  onRetry,
  onDiscard,
}: {
  pending: PendingPop;
  onRetry: (pending: PendingPop) => void;
  onDiscard: (pending: PendingPop) => void;
}) {
  const theme = useTheme();
  const failed = pending.status === 'failed';

  return (
    <View testID="pop-pending-tile" style={styles.fill}>
      <PopCover posterUri={pending.posterUri} showLabel={false} />
      <View style={[styles.fill, styles.center, { backgroundColor: theme.mediaScrim }]}>
        {failed ? (
          <Pressable
            testID="pop-retry"
            accessibilityRole="button"
            accessibilityLabel="Не опубликовано. Повторить"
            accessibilityHint="Долгое нажатие — убрать"
            hitSlop={Sizes.popEditorButton}
            onPress={() => onRetry(pending)}
            onLongPress={() => onDiscard(pending)}
            style={[styles.retry, { backgroundColor: theme.danger }]}
          >
            <Text variant="bodyBold" color="textOnMedia">
              !
            </Text>
          </Pressable>
        ) : (
          <ActivityIndicator accessibilityLabel="Публикуется" color={theme.textOnMedia} />
        )}
      </View>
    </View>
  );
});
