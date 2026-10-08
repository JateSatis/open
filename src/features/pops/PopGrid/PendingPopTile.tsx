import { memo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { PopCover } from '@/features/pops/PopCover';
import type { PendingPop } from '@/features/pops/pendingPops';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

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
