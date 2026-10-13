import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { SearchEntity } from '@/api/search';
import type { UsernameKind } from '@/api/usernames';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { formatUsername } from '@/features/profile/username';
import { HighlightedText } from '@/features/search/HighlightedText';
import { findMatches, type ParsedQuery } from '@/features/search/searchText';
import { plural } from '@/lib/plural';
import { Sizes } from '@/theme';

export type SearchEntityRowProps = {
  entity: SearchEntity;
  query: ParsedQuery;
  onPress: (entity: SearchEntity) => void;
};

function usernameKind(entity: SearchEntity): UsernameKind {
  if (entity.kind === 'channel') return 'channel';
  if (entity.kind === 'group') return 'group';

  return 'profile';
}

/** Что сказать о сущности после @имени: подписка, число подписчиков, вид. */
function detailOf(entity: SearchEntity): string | null {
  if (entity.kind === 'channel') {
    if (entity.section === 'mine') return entity.subscribed ? 'вы подписаны' : 'ваш канал';

    const count = entity.subscribersCount ?? 0;
    return `${count} ${plural(count, 'подписчик', 'подписчика', 'подписчиков')}`;
  }
  if (entity.kind === 'group') return entity.subscribed ? 'вы подписаны' : 'группа';
  if (entity.kind === 'direct' && entity.subscribed) return 'вы подписаны';

  return null;
}

/** Строка выдачи: чат, канал, человек или группа — аватар, название, `@имя`. */
export function SearchEntityRow({ entity, query, onPress }: SearchEntityRowProps) {
  const username = formatUsername(entity.username, usernameKind(entity));
  const detail = detailOf(entity);
  // В `@имя.ch` совпадение ищется по самому имени, со сдвигом на `@`.
  const usernameRanges =
    username && entity.username && query.username
      ? findMatches(entity.username, query.username).map((range) => ({
          start: range.start + 1,
          end: range.end + 1,
        }))
      : [];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entity.title}
      testID={`search-${entity.section}-${entity.kind}`}
      onPress={() => onPress(entity)}
      style={styles.row}
    >
      <Avatar uri={entity.avatarUrl} name={entity.title} size={Sizes.chatListAvatar} />
      <View style={styles.body}>
        <HighlightedText
          variant="bodyBold"
          numberOfLines={1}
          ranges={findMatches(entity.title, query.text)}
        >
          {entity.title}
        </HighlightedText>
        {username || detail ? (
          <Text variant="small" color="textSecondary" numberOfLines={1}>
            {username ? (
              <HighlightedText variant="small" color="textSecondary" ranges={usernameRanges}>
                {username}
              </HighlightedText>
            ) : null}
            {username && detail ? ' · ' : null}
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
