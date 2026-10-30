import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { ChatThreadSummary } from '@/api/chats';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { formatChatTimestamp } from '@/features/chats/chatDisplay';
import { describePreview } from '@/features/chats/messageQuote';
import { repliesLabel } from '@/features/interactions/CommentsPanel/RepliesButton';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type ChatThreadPlateProps = {
  summary: ChatThreadSummary;
  /** Исходное — моё: плашка у правого края, как облачко. */
  isOwn: boolean;
  /** Отступ слева у чужого — место аватара в строке облачка. */
  inset: number;
  /** Справа — место круга комментариев: плашка не шире облачка с ним. */
  aside: number;
  onPress: () => void;
};

/** Значок ответов — не тот, что у комментариев: ответы и комментарии не путаются. */
const REPLIES_ICON = { ios: 'arrowshape.turn.up.left.2', android: 'reply_all', web: 'reply_all' } as const;

/**
 * Плашка треда под исходным сообщением в «Тредах»: сколько ответов, двое
 * последних ответивших и «+N», время и текст последнего ответа одной
 * строкой. Тап — шторка треда.
 */
export function ChatThreadPlate({ summary, isOwn, inset, aside, onPress }: ChatThreadPlateProps) {
  const theme = useTheme();
  const { last, people, othersCount, repliesCount } = summary;
  const time = last?.createdAt ? formatChatTimestamp(last.createdAt) : '';
  const text = last ? describePreview(last.preview) : '';
  const line = [time, text].filter(Boolean).join(' • ');

  return (
    <View
      style={[
        styles.row,
        isOwn ? styles.own : undefined,
        isOwn ? { paddingLeft: aside } : { paddingLeft: inset, paddingRight: aside },
      ]}
    >
      <Pressable
        testID={`chat-thread-plate-${summary.rootId}`}
        accessibilityRole="button"
        accessibilityLabel={`Тред: ${repliesLabel(repliesCount)}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.plate,
          { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
        ]}
      >
        <View style={styles.count}>
          <SymbolView name={REPLIES_ICON} size={Sizes.chatThreadIcon} tintColor={theme.primary} />
          <Text variant="captionBold" color="primary">
            {repliesCount}
          </Text>
        </View>

        {people.length > 0 ? (
          <View style={styles.people}>
            {people.map((person, index) => (
              <View key={person.id} style={index > 0 ? styles.overlap : undefined}>
                <Avatar uri={person.avatarUrl} name={person.name} size={Sizes.chatThreadAvatar} />
              </View>
            ))}
            {othersCount > 0 ? (
              <Text variant="caption" color="textSecondary" style={styles.others}>
                +{othersCount}
              </Text>
            ) : null}
          </View>
        ) : null}

        {line ? (
          <Text
            testID="chat-thread-plate-last"
            variant="caption"
            color="textSecondary"
            numberOfLines={1}
            style={styles.last}
          >
            {line}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}
