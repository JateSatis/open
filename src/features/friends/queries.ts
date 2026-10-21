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

export const friendKeys = {
  all: ['friends'] as const,
  status: (userId: string) => [...friendKeys.all, 'status', userId] as const,
  summary: (userId: string) => [...friendKeys.all, 'summary', userId] as const,
  list: (userId: string) => [...friendKeys.all, 'list', userId] as const,
  incoming: () => [...friendKeys.all, 'incoming'] as const,
};

export function useFriendshipStatus(userId: string, enabled = true) {
  return useQuery({
    queryKey: friendKeys.status(userId),
    queryFn: () => getFriendshipStatus(userId),
    enabled,
  });
}

export function useFriendsSummary(userId: string | null) {
  return useQuery({
    queryKey: friendKeys.summary(userId ?? ''),
    queryFn: () => getFriendsSummary(userId as string),
    enabled: userId !== null,
  });
}

type Cursor = { at: string; id: string } | null;

export function useFriendsList(userId: string) {
  return useInfiniteQuery<FriendsPage, Error, FriendsPage[], readonly unknown[], Cursor>({
    queryKey: friendKeys.list(userId),
    queryFn: ({ pageParam }) => listFriends(userId, pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => last.next ?? undefined,
    select: (data) => data.pages,
  });
}

export function useIncomingFriendRequests() {
  return useInfiniteQuery<FriendsPage, Error, FriendsPage[], readonly unknown[], Cursor>({
    queryKey: friendKeys.incoming(),
    queryFn: ({ pageParam }) => listIncomingFriendRequests(pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => last.next ?? undefined,
    select: (data) => data.pages,
  });
}

export type FriendAction = 'send' | 'cancel' | 'accept' | 'decline' | 'remove';

const ACTIONS: Record<FriendAction, (userId: string) => Promise<FriendshipStatus>> = {
  send: sendFriendRequest,
  cancel: cancelFriendRequest,
  accept: acceptFriendRequest,
  decline: declineFriendRequest,
  remove: removeFriend,
};

/** Действие с парой «я + он». Новое состояние пары сервер возвращает сам. */
export function useFriendAction() {
  const queryClient = useQueryClient();
  const me = useCurrentUserId();

  return useMutation<FriendshipStatus, Error, { action: FriendAction; userId: string }>({
    mutationFn: ({ action, userId }) => ACTIONS[action](userId),
    networkMode: 'always',
    onSuccess: (status, { userId }) => {
      queryClient.setQueryData(friendKeys.status(userId), status);
    },
    onSettled: (_status, _error, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: friendKeys.status(userId) });
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
