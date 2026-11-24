import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendsSummary,
  getFriendshipStatus,
  listFriends,
  listIncomingFriendRequests,
  removeFriend,
  sendFriendRequest,
  type FriendsPage,
  type FriendshipStatus,
} from '@/api/friends';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { friendKeys } from '@/features/friends/keys';

export { friendKeys };

export function useFriendshipStatus(userId: string, enabled = true) {
  const api = useRequestClient();
  return useQuery({
    queryKey: friendKeys.status(userId),
    queryFn: () => getFriendshipStatus(userId, api),
    enabled,
  });
}

export function useFriendsSummary(userId: string | null) {
  const api = useRequestClient();
  return useQuery({
    queryKey: friendKeys.summary(userId ?? ''),
    queryFn: () => getFriendsSummary(userId as string, api),
    enabled: userId !== null,
  });
}

type Cursor = { at: string; id: string } | null;

export function useFriendsList(userId: string) {
  const api = useRequestClient();
  return useInfiniteQuery<FriendsPage, Error, FriendsPage[], readonly unknown[], Cursor>({
    queryKey: friendKeys.list(userId),
    queryFn: ({ pageParam }) => listFriends(userId, pageParam, api),
    initialPageParam: null,
    getNextPageParam: (last) => last.next ?? undefined,
    select: (data) => data.pages,
  });
}

export function useIncomingFriendRequests() {
  const api = useRequestClient();
  return useInfiniteQuery<FriendsPage, Error, FriendsPage[], readonly unknown[], Cursor>({
    queryKey: friendKeys.incoming(),
    queryFn: ({ pageParam }) => listIncomingFriendRequests(pageParam, api),
    initialPageParam: null,
    getNextPageParam: (last) => last.next ?? undefined,
    select: (data) => data.pages,
  });
}

export type FriendAction = 'send' | 'cancel' | 'accept' | 'decline' | 'remove';

const ACTIONS: Record<FriendAction, typeof sendFriendRequest> = {
  send: sendFriendRequest,
  cancel: cancelFriendRequest,
  accept: acceptFriendRequest,
  decline: declineFriendRequest,
  remove: removeFriend,
};

/** Действие с парой «я + он». Новое состояние пары сервер возвращает сам. */
export function useFriendAction() {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const me = useCurrentUserId();

  return useMutation<FriendshipStatus, Error, { action: FriendAction; userId: string }>({
    mutationFn: ({ action, userId }) => ACTIONS[action](userId, api),
    networkMode: 'always',
    onSuccess: (status, { userId }) => {
      queryClient.setQueryData(friendKeys.status(userId), status);
    },
    onError: (_error, { userId }) => {
      // Ответа нет — состояние пары неизвестно, его надо перечитать.
      void queryClient.invalidateQueries({ queryKey: friendKeys.status(userId) });
    },
    onSettled: (_status, _error, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: friendKeys.summary(userId) });
      void queryClient.invalidateQueries({ queryKey: friendKeys.list(userId) });
      void queryClient.invalidateQueries({ queryKey: friendKeys.incoming() });

      if (me) {
        void queryClient.invalidateQueries({ queryKey: friendKeys.summary(me) });
        void queryClient.invalidateQueries({ queryKey: friendKeys.list(me) });
      }
    },
  });
}
