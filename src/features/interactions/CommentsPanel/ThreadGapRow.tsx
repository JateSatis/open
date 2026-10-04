import { ActivityIndicator, Pressable, View } from 'react-native';

import type { ThreadPlace } from './rows';
import { styles } from './styles';
import { ThreadBackground } from './ThreadBackground';
import { repliesLabel } from './ThreadToggle';

import { Text } from '@/components/Text';


export type ThreadGapRowProps = {
  thread: ThreadPlace;
  /** Сколько ответов за разрывом; `null` — тред ещё грузится, на месте ответов — колесо. */
  hidden: number | null;
  isLoading: boolean;
  onPress?: () => void;
};

/** Разрыв длинного треда — «Показать ещё N ответов» — или загрузка его начала. */
export function ThreadGapRow({ thread, hidden, isLoading, onPress }: ThreadGapRowProps) {
  return (
    <View style={[styles.row, styles.reply]}>
      <ThreadBackground first={thread.first} last={thread.last} />
      {hidden === null || isLoading ? (
        <View style={styles.threadAction}>
          <ActivityIndicator accessibilityLabel="Загрузка ответов" />
        </View>
      ) : (
        <Pressable
          testID="thread-gap"
          accessibilityRole="button"
          onPress={onPress}
          style={styles.threadAction}
        >
          <Text variant="smallBold" color="primary">
            {`Показать ещё ${repliesLabel(hidden)}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
