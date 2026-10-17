import { useLocalSearchParams } from 'expo-router';

import { PopViewer } from '@/features/pops/PopViewer';
import { setLastSearchPop } from '@/features/search/lastSearchPop';
import { useSearchPopFeed } from '@/features/search/useSearchPopFeed';

/** Просмотр попсов выдачи поиска «Ленты» с выбранного попа. */
export default function SearchPopViewerRoute() {
  const { q, start } = useLocalSearchParams<{ q: string; start: string }>();
  const feed = useSearchPopFeed(q);

  return (
    <PopViewer
      feed={feed}
      startId={start}
      channelLink="over"
      surface="search"
      entry="search_result"
      onActivePop={setLastSearchPop}
    />
  );
}
