// Друзья — взаимная связь, подтверждённая обеими сторонами. Таблица закрыта:
// всё через функции базы (миграция 20261029110000_friends.sql). Отказ
// отправителю не раскрывается — для него отклонённая заявка выглядит как
// неотвеченная, и различить их по ответу нельзя.

import type { AccountClient } from '@/api/accountClient';
import { requestClient } from '@/api/requestClient';

/** Пара глазами меня. `self` — свой профиль. */
export type FriendshipStatus = 'self' | 'none' | 'outgoing' | 'incoming' | 'friends';

export type FriendPerson = {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

/** Позиция в списке и курсор следующей страницы. */
export type FriendListItem = FriendPerson & { cursorAt: string; cursorId: string };

export type FriendsPage = {
  items: FriendListItem[];
  /** Курсор следующей страницы; null — дальше пусто. */
  next: { at: string; id: string } | null;
};

export type FriendsSummary = {
  /** Можно ли мне видеть список (настройка владельца). */
  listVisible: boolean;
  /** Сколько друзей — только если список виден. */
  friendsCount: number | null;
  /** Входящие заявки — только в своём профиле. */
  incomingCount: number | null;
};

export const FRIENDS_PAGE_SIZE = 30;

/** Код лимита частоты заявок. */
export const FRIEND_REQUEST_LIMIT_CODE = 'OPN05';

export class FriendRequestLimitError extends Error {
  constructor() {
    super('Слишком много заявок в друзья. Попробуйте позже.');
    this.name = 'FriendRequestLimitError';
  }
}

/** Список скрыт настройкой его владельца. */
export class FriendsListHiddenError extends Error {
  constructor() {
    super('Список друзей скрыт');
    this.name = 'FriendsListHiddenError';
  }
}

const STATUSES: readonly FriendshipStatus[] = ['self', 'none', 'outgoing', 'incoming', 'friends'];

function toStatus(value: unknown): FriendshipStatus {
  return STATUSES.find((status) => status === value) ?? 'none';
}

type PersonRow = {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  friendship_id: string;
};

function toPage<T extends PersonRow>(rows: T[], cursorAt: (row: T) => string): FriendsPage {
  const items = rows.map((row) => ({
    id: row.user_id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    cursorAt: cursorAt(row),
    cursorId: row.friendship_id,
  }));
  const last = items[items.length - 1];

  return {
    items,
    next: items.length === FRIENDS_PAGE_SIZE && last ? { at: last.cursorAt, id: last.cursorId } : null,
  };
}

export async function getFriendshipStatus(userId: string, api = requestClient()): Promise<FriendshipStatus> {
  const { data, error } = await api.rpc('friendship_status', { p_user: userId });

  if (error) throw error;

  return toStatus(data);
}

type FriendAction =
  | 'send_friend_request'
  | 'cancel_friend_request'
  | 'accept_friend_request'
  | 'decline_friend_request'
  | 'remove_friend';

async function act(action: FriendAction, userId: string, api: AccountClient): Promise<FriendshipStatus> {
  const { data, error } = await api.rpc(action, { p_user: userId });

  if (error) {
    if (error.code === FRIEND_REQUEST_LIMIT_CODE) throw new FriendRequestLimitError();
    throw error;
  }

  return toStatus(data);
}

/** «Добавить в друзья». Если он уже звал меня — это принятие. */
export const sendFriendRequest = (userId: string, api = requestClient()) => act('send_friend_request', userId, api);
export const cancelFriendRequest = (userId: string, api = requestClient()) => act('cancel_friend_request', userId, api);
export const acceptFriendRequest = (userId: string, api = requestClient()) => act('accept_friend_request', userId, api);
export const declineFriendRequest = (userId: string, api = requestClient()) => act('decline_friend_request', userId, api);
export const removeFriend = (userId: string, api = requestClient()) => act('remove_friend', userId, api);

export async function getFriendsSummary(userId: string, api = requestClient()): Promise<FriendsSummary> {
  const { data, error } = await api.rpc('friends_summary', { p_user: userId });

  if (error) throw error;

  const value = (data ?? {}) as {
    list_visible?: boolean;
    friends_count?: number | null;
    incoming_count?: number | null;
  };

  return {
    listVisible: value.list_visible === true,
    friendsCount: value.friends_count ?? null,
    incomingCount: value.incoming_count ?? null,
  };
}

export async function listFriends(
  userId: string,
  before: { at: string; id: string } | null,
  api = requestClient(),
): Promise<FriendsPage> {
  const { data, error } = await api.rpc('list_friends', {
    p_user: userId,
    p_limit: FRIENDS_PAGE_SIZE,
    ...(before ? { p_before_accepted_at: before.at, p_before_id: before.id } : {}),
  });

  if (error) {
    if (error.code === '42501') throw new FriendsListHiddenError();
    throw error;
  }

  return toPage(data ?? [], (row) => row.accepted_at);
}

export async function listIncomingFriendRequests(
  before: { at: string; id: string } | null,
  api = requestClient(),
): Promise<FriendsPage> {
  const { data, error } = await api.rpc('list_incoming_friend_requests', {
    p_limit: FRIENDS_PAGE_SIZE,
    ...(before ? { p_before_created_at: before.at, p_before_id: before.id } : {}),
  });

  if (error) throw error;

  return toPage(data ?? [], (row) => row.created_at);
}
