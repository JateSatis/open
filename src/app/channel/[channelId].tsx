import { useLocalSearchParams } from 'expo-router';

import { ChannelScreen } from '@/features/channels/ChannelScreen';

/**
 * Канал поверх вкладок — из «Ленты»: из выдачи поиска и из просмотра выдачи.
 * «Назад» возвращает туда, откуда пришли, а не в список чатов.
 */
export default function RootChannelRoute() {
  const { channelId, section } = useLocalSearchParams<{ channelId: string; section?: string }>();

  return <ChannelScreen channelId={channelId} section={section === 'pops' ? 'pops' : 'posts'} />;
}
