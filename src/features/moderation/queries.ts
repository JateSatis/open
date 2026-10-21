import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  blockUser,
  isBlockedByMe,
  listBlockedUsers,
  reportUser,
  unblockUser,
  type BlockedPage,
  type ReportInput,
} from '@/api/blocks';
import { chatsQueryKey } from '@/features/chats/useChats';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { friendKeys } from '@/features/friends/queries';
import { profileKeys } from '@/features/profile/queries';

export const blockKeys = {
  all: ['blocks'] as const,
  status: (userId: string) => [...blockKeys.all, 'status', userId] as const,
  list: () => [...blockKeys.all, 'list'] as const,
};

/** Заблокировал ли я этого человека. */
export function useIsBlocked(userId: string, enabled = true) {
  return useQuery({
    queryKey: blockKeys.status(userId),
    queryFn: () => isBlockedByMe(userId),
    enabled,
  });
}

type Cursor = { at: string; id: string } | null;

export function useBlockedUsers() {
  return useInfiniteQuery<BlockedPage, Error, BlockedPage[], readonly unknown[], Cursor>({
    queryKey: blockKeys.list(),
    queryFn: ({ pageParam }) => listBlockedUsers(pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => last.next ?? undefined,
    select: (data) => data.pages,
  });
}

/**
 * Блокировка рвёт дружбу и заявки, а скрытое меняется во многих списках —
 * перечитывается всё, что от неё зависит.
 */
function useAfterBlockChange() {
  const queryClient = useQueryClient();

  return (userId: string) => {
    void queryClient.invalidateQueries({ queryKey: blockKeys.all });
    void queryClient.invalidateQueries({ queryKey: friendKeys.all });
    void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
    void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
    void queryClient.invalidateQueries({ queryKey: profileKeys.byId(userId) });
  };
}

export type BlockChange = { userId: string; blocked: boolean };

/** Заблокировать или разблокировать. */
export function useSetBlocked() {
  const after = useAfterBlockChange();
  const queryClient = useQueryClient();

  return useMutation<void, Error, BlockChange>({
    networkMode: 'always',
    mutationFn: ({ userId, blocked }) => (blocked ? blockUser(userId) : unblockUser(userId)),
    onSuccess: (_result, { userId, blocked }) => {
      queryClient.setQueryData(blockKeys.status(userId), blocked);
    },
    onSettled: (_result, _error, { userId }) => after(userId),
  });
}

/** Жалоба, по желанию — вместе с блокировкой. */
export function useReportUser() {
  const after = useAfterBlockChange();

  return useMutation<void, Error, ReportInput>({
    networkMode: 'always',
    mutationFn: (input) => reportUser(input),
    onSuccess: (_result, input) => {
      if (input.block) after(input.userId);
    },
  });
}
