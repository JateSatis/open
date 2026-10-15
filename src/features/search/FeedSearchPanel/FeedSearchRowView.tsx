import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { SearchChannel, SearchEntity, SearchPop } from '@/api/search';
import { Text } from '@/components/Text';
import { SearchEntityRow } from '@/features/search/SearchEntityRow';
import { SearchPopTile } from '@/features/search/SearchPopTile';
import { SearchSectionHeader } from '@/features/search/SearchSectionHeader';
import type { FeedSearchRow } from '@/features/search/feedSearchRows';
import type { ParsedQuery } from '@/features/search/searchText';
import { plural } from '@/lib/plural';

const TITLES = { recent: 'Недавние', channels: 'Каналы', pops: 'Попсы' } as const;

/** Строка канала — та же, что в поиске «Чатов». */
function asEntity(channel: SearchChannel): SearchEntity {
  return {
    section: 'global',
    kind: 'channel',
    id: channel.id,
    chatId: channel.postsChatId,
    channelId: channel.id,
    personId: null,
    title: channel.title,
    username: channel.username,
    avatarUrl: channel.avatarUrl,
    subscribed: channel.subscribed,
    subscribersCount: channel.subscribersCount,
  };
}

function channelDetail(channel: SearchChannel): string {
  const count = channel.subscribersCount;
  const subscribers = `${count} ${plural(count, 'подписчик', 'подписчика', 'подписчиков')}`;

  if (channel.mine) return `${subscribers} · ваш канал`;

  return channel.subscribed ? `${subscribers} · вы подписаны` : subscribers;
}

export type FeedSearchRowViewProps = {
  row: FeedSearchRow;
  parsed: ParsedQuery;
  tileWidth: number;
  /** Блок каналов длиннее свёрнутого — «Показать ещё» / «Свернуть». */
  channelsToggle: { expanded: boolean; onPress: () => void } | null;
  onClearRecent: () => void;
  onPickRecent: (query: string) => void;
  onOpenChannel: (entity: SearchEntity) => void;
  onOpenPop: (pop: SearchPop) => void;
};

/** Одна строка выдачи «Ленты»: заголовок блока, недавний запрос, канал или ряд попсов. */
export function FeedSearchRowView({
  row,
  parsed,
  tileWidth,
  channelsToggle,
  onClearRecent,
  onPickRecent,
  onOpenChannel,
  onOpenPop,
}: FeedSearchRowViewProps) {
  switch (row.type) {
    case 'header': {
      const action =
        row.section === 'recent'
          ? { label: 'Очистить', onPress: onClearRecent }
          : row.section === 'channels' && channelsToggle
            ? {
                label: channelsToggle.expanded ? 'Свернуть' : 'Показать ещё',
                onPress: channelsToggle.onPress,
              }
            : undefined;

      return <SearchSectionHeader title={TITLES[row.section]} action={action} />;
    }
    case 'recent':
      return (
        <Pressable
          testID="feed-search-recent"
          accessibilityRole="button"
          onPress={() => onPickRecent(row.query)}
          style={styles.recent}
        >
          <Text numberOfLines={1}>{row.query}</Text>
        </Pressable>
      );
    case 'channel':
      return (
        <SearchEntityRow
          testID="feed-search-channel"
          entity={asEntity(row.channel)}
          query={parsed}
          detail={channelDetail(row.channel)}
          onPress={onOpenChannel}
        />
      );
    case 'pops':
      return (
        <View style={styles.popRow}>
          {row.pops.map((pop) => (
            <SearchPopTile
              key={pop.id}
              pop={pop}
              needle={parsed.text}
              width={tileWidth}
              onPress={onOpenPop}
            />
          ))}
        </View>
      );
  }
}
