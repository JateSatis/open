import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { repliesLabel } from '@/features/interactions/CommentsPanel/RepliesButton';

export type ChatThreadActionRowProps =
  | { type: 'gap'; hidden: number; loading: boolean; onPress: () => void }
  | { type: 'loading'; failed: boolean; onRetry: () => void };

/** Служебная строка шторки: разрыв «Показать ещё N ответов» или загрузка треда. */
export function ChatThreadActionRow(props: ChatThreadActionRowProps) {
  if (props.type === 'gap') {
    return (
      <Pressable
        testID="chat-thread-gap"
        accessibilityRole="button"
        onPress={props.onPress}
        style={styles.action}
      >
        {props.loading ? (
          <ActivityIndicator accessibilityLabel="Загрузка ответов" />
        ) : (
          <Text variant="smallBold" color="primary">
            {`Показать ещё ${repliesLabel(props.hidden)}`}
          </Text>
        )}
      </Pressable>
    );
  }

  return props.failed ? (
    <Pressable testID="chat-thread-retry" onPress={props.onRetry} style={styles.action}>
      <Text variant="small" color="danger">
        Не удалось загрузить тред. Повторить
      </Text>
    </Pressable>
  ) : (
    <View style={styles.action}>
      <ActivityIndicator accessibilityLabel="Загрузка треда" />
    </View>
  );
}
