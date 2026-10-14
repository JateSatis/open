import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { TabStatus, tabStatusOf } from './TabStatus';
import { chatInfoKeys, useCommonGroups } from './queries';

import { InfoPersonRow, InfoTabList } from '@/components/InfoPage';
import { plural } from '@/lib/plural';

export type CommonGroupsTabProps = {
  tab: number;
  otherUserId: string;
  onOpenChat: (chatId: string) => void;
};

/** Вкладка «Общие группы» своего диалога: группы, где есть и я, и собеседник. */
export function CommonGroupsTab({ tab, otherUserId, onOpenChat }: CommonGroupsTabProps) {
  const queryClient = useQueryClient();
  const query = useCommonGroups(otherUserId, true);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const groups = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const retry = useCallback(() => {
    if (query.data === undefined) {
      void queryClient.resetQueries({
        queryKey: chatInfoKeys.commonGroups(otherUserId),
        exact: true,
      });
    } else {
      void fetchNextPage();
    }
  }, [fetchNextPage, otherUserId, query.data, queryClient]);

  return (
    <InfoTabList
      tab={tab}
      testID="info-groups"
      data={groups}
      keyExtractor={(group) => group.id}
      renderItem={({ item }) => (
        <InfoPersonRow
          testID={`info-group-${item.id}`}
          name={item.title ?? 'Групповой чат'}
          avatarUrl={item.avatarUrl}
          status={{
            text: `${item.membersCount} ${plural(item.membersCount, 'участник', 'участника', 'участников')}`,
          }}
          onPress={() => onOpenChat(item.id)}
        />
      )}
      onEndReached={loadMore}
      onEndReachedThreshold={1}
      footer={<TabStatus state={tabStatusOf(query)} what="группы" onRetry={retry} />}
    />
  );
}
