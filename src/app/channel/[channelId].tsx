import { useLocalSearchParams } from 'expo-router';

import { ChannelScreen } from '@/features/channels/ChannelScreen';
import {
  initialSectionOf,
  sectionRequestOf,
  type ChannelRouteParams,
} from '@/features/channels/sectionRequest';

/**
 * Канал поверх вкладок — из «Ленты»: из выдачи поиска и из просмотра выдачи.
 * «Назад» возвращает туда, откуда пришли, а не в список чатов.
 */
export default function RootChannelRoute() {
  const params = useLocalSearchParams<{ channelId: string } & ChannelRouteParams>();

  return (
    <ChannelScreen
      channelId={params.channelId}
      section={initialSectionOf(params)}
      sectionRequest={sectionRequestOf(params)}
    />
  );
}
