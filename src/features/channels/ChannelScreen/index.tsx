import { Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { styles } from './styles';

import type { Channel } from '@/api/channels';
import type { ChannelRef } from '@/api/chats';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Text } from '@/components/Text';
import { SECTION_SETTLE_MS, SectionPager } from '@/features/channels/SectionPager';
import { useChannel } from '@/features/channels/useChannel';
import { ChatConversation } from '@/features/chats/ChatConversation';
import { useTheme } from '@/hooks/use-theme';
import { describeLoadError } from '@/lib/network';

const SECTIONS = ['Посты', 'Попсы'] as const;

export type ChannelScreenProps = { channelId: string };

/**
 * Экран канала: под шапкой — «Посты» | «Попсы», разделы листаются свайпом и
 * тапом по сегменту. «Посты» — переписка чата постов, «Попсы» пока пусты.
 */
export function ChannelScreen({ channelId }: ChannelScreenProps) {
  const theme = useTheme();
  const { data: channel, error, fetchStatus } = useChannel(channelId);
  // Без связи запрос стоит на паузе: крутилка обещала бы данные, которых не будет.
  const offline = fetchStatus === 'paused';

  if (!channel) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: 'Канал' }} />
        {error || offline ? (
          <Text color={offline ? 'textSecondary' : 'danger'}>
            {describeLoadError(error, 'Не удалось открыть канал') ?? 'Нет связи'}
          </Text>
        ) : (
          <ActivityIndicator accessibilityLabel="Загрузка канала" />
        )}
      </View>
    );
  }

  return <ChannelSections channel={channel} />;
}

function ChannelSections({ channel }: { channel: Channel }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const position = useSharedValue(0);
  const [index, setIndex] = useState(0);

  const ref = useMemo<ChannelRef>(
    () => ({
      id: channel.id,
      title: channel.title,
      username: channel.username,
      avatarUrl: channel.avatarUrl,
    }),
    [channel],
  );

  const select = useCallback(
    (next: number) => {
      setIndex(next);
      position.set(withTiming(next, { duration: SECTION_SETTLE_MS }));
    },
    [position],
  );

  const pages = useMemo(
    () => [
      <ChatConversation
        key="posts"
        chatId={channel.postsChatId}
        channel={ref}
        active={index === 0}
      />,
      <View key="pops" testID="pops-section" style={styles.centered}>
        <Text color="textSecondary">Попсов пока нет</Text>
      </View>,
    ],
    [channel.postsChatId, index, ref],
  );

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <View style={styles.segments}>
        <SegmentedControl
          segments={SECTIONS}
          position={position}
          selectedIndex={index}
          onSelect={select}
        />
      </View>

      <SectionPager position={position} width={width} pages={pages} onIndexChange={setIndex} />
    </View>
  );
}
