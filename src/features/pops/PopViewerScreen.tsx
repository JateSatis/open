import { useRouteParams } from '@/navigation';
import { PopViewer } from './PopViewer';
import { ChannelPopViewer, type ChannelPopViewerProps } from './PopViewer/ChannelPopViewer';

import { setLastSearchPop } from '@/features/search/lastSearchPop';
import { useSearchPopFeed } from '@/features/search/useSearchPopFeed';

type SearchParams = { source: 'search'; query: string; startId: string };

export type PopViewerScreenParams = ({ source: 'channel' } & ChannelPopViewerProps) | SearchParams;

export function PopViewerScreen() {
  const params = useRouteParams<'PopViewer'>();
  if (params.source === 'search') return <SearchResultsViewer {...params} />;

  return <ChannelPopViewer {...params} entry={params.entry ?? 'channel_grid'} />;
}

function SearchResultsViewer({ query, startId }: SearchParams) {
  const feed = useSearchPopFeed(query);

  return (
    <PopViewer
      feed={feed}
      startId={startId}
      channelLink="over"
      surface="search"
      entry="search_result"
      onActivePop={setLastSearchPop}
    />
  );
}
