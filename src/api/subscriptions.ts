// Подписки на каналы и на чужие диалоги и группы. Подписка — приватная строка
// «я + цель»: читает её только сам подписчик, а пишут только функции базы —
// подписаться может не каждый (публикующий в канале и участник чата — нет), а
// отметки прочтения ставит время сервера. Подписка никогда не делает
// участником чата: писать подписчик не может, это проверяет политика на
// `messages`.

import { requestClient } from '@/api/requestClient';

/**
 * Моя подписка с тем, что для меня непрочитано: на канал (`channelId`) или на
 * чужой диалог и группу (`channelId` — null). У подписки на чат один уровень —
 * она всегда в «Чатах», непрочитанное — в `unreadPosts`, попсов нет.
 */
export type Subscription = {
  channelId: string | null;
  /** Чат постов канала или сам подписанный чат. */
  chatId: string;
  /** Читатель: канал лежит в «Чатах». У чата — всегда. */
  inChats: boolean;
  /** Карточки о новых постах, попсах и сообщениях (только «в чатах»). */
  notify: boolean;
  unreadPosts: number;
  unreadPops: number;
  /** Когда подписка попала в «Чаты» — мой момент входа для порядка списка; не в чатах — null. */
  inChatsAt: string | null;
};

/** Подписка на канал. */
export type ChannelSubscription = Subscription & { channelId: string };

/** Подписчик в списке, который видит создатель канала или участник чата. */
export type Subscriber = {
  /** Id строки подписки — ключ страницы. */
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  /** Канал у читателя в «Чатах»; у подписчика чата — null: уровень один. */
  inChats: boolean | null;
  subscribedAt: string;
};

export const SUBSCRIBERS_PAGE_SIZE = 30;

type SubscriptionRow = {
  channel_id: string | null;
  chat_id: string;
  in_chats: boolean;
  notify: boolean;
  unread_posts: number;
  unread_pops: number;
  in_chats_at?: string | null;
};

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    channelId: row.channel_id,
    chatId: row.chat_id,
    inChats: row.in_chats,
    notify: row.notify,
    unreadPosts: row.unread_posts,
    unreadPops: row.unread_pops,
    inChatsAt: row.in_chats_at ?? null,
  };
}

/** Моя подписка на канал; `null` — не подписан. */
export async function getMySubscription(channelId: string, api = requestClient()): Promise<ChannelSubscription | null> {
  const { data, error } = await api.rpc('my_channel_subscriptions', {
    target_channel: channelId,
  });

  if (error) throw error;

  const row = data?.[0];

  return row ? { ...toSubscription(row), channelId: row.channel_id } : null;
}

/** Моя подписка на чужой диалог или группу; `null` — не подписан. */
export async function getMyChatSubscription(chatId: string, api = requestClient()): Promise<Subscription | null> {
  const { data, error } = await api.rpc('my_subscriptions', { target_chat: chatId });

  if (error) throw error;

  const row = (data ?? []).find((item) => item.channel_id === null);

  return row ? toSubscription(row) : null;
}

/**
 * Подписки, которые лежат в «Чатах», — каналы и чаты одним запросом на весь
 * список.
 */
export async function listChatSubscriptions(api = requestClient()): Promise<Subscription[]> {
  const { data, error } = await api.rpc('my_subscriptions', {});

  if (error) throw error;

  return (data ?? []).map(toSubscription);
}

/** Подписаться; `addToChats` — сразу читателем. Повтор — не ошибка. */
export async function subscribeToChannel(channelId: string, addToChats: boolean, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('subscribe_to_channel', {
    target_channel: channelId,
    add_to_chats: addToChats,
  });

  if (error) throw error;
}

export async function setChannelInChats(channelId: string, inChats: boolean, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('set_channel_in_chats', {
    target_channel: channelId,
    value: inChats,
  });

  if (error) throw error;
}

export async function setChannelNotifications(channelId: string, enabled: boolean, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('set_channel_notifications', {
    target_channel: channelId,
    enabled,
  });

  if (error) throw error;
}

export async function unsubscribeFromChannel(channelId: string, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('unsubscribe_from_channel', { target_channel: channelId });

  if (error) throw error;
}

/**
 * Отметка прочтения подписчика — временем базы, по той же причине, что у
 * `markChatRead`: часы устройства расходятся с серверными. Не подписан —
 * база ничего не делает.
 */
export async function markChannelRead(
  channelId: string,
  sections: { posts: boolean; pops: boolean },
  api = requestClient(),
): Promise<void> {
  const { error } = await api.rpc('mark_channel_read', {
    target_channel: channelId,
    read_posts: sections.posts,
    read_pops: sections.pops,
  });

  if (error) throw error;
}

/**
 * Страница подписчиков канала, свежие сверху. Только создателю канала:
 * остальным база отказывает. `after` — последняя строка прошлой страницы.
 */
export async function listChannelSubscribers(
  channelId: string,
  after: Subscriber | null,
  /** По имени или `@имени`; пусто — все. */
  query?: string,
  api = requestClient(),
): Promise<Subscriber[]> {
  const { data, error } = await api.rpc('list_channel_subscribers', {
    target_channel: channelId,
    before_created: after?.subscribedAt,
    before_id: after?.id,
    page_size: SUBSCRIBERS_PAGE_SIZE,
    query: query?.trim() || undefined,
  });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.subscriber_id,
    displayName: row.display_name ?? 'Без имени',
    username: row.username,
    avatarUrl: row.avatar_url,
    inChats: row.in_chats,
    subscribedAt: row.subscribed_at,
  }));
}

/** Подписаться на чужой диалог или группу — он сразу в «Чатах». Повтор — не ошибка. */
export async function subscribeToChat(chatId: string, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('subscribe_to_chat', { target_chat: chatId });

  if (error) throw error;
}

export async function setChatNotifications(chatId: string, enabled: boolean, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('set_chat_notifications', {
    target_chat: chatId,
    enabled,
  });

  if (error) throw error;
}

export async function unsubscribeFromChat(chatId: string, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('unsubscribe_from_chat', { target_chat: chatId });

  if (error) throw error;
}

/**
 * Отметка прочтения подписчика чата — временем базы. Галочки «прочитано» у
 * участников она не трогает. Не подписан — база ничего не делает.
 */
export async function markChatSubscriptionRead(chatId: string, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('mark_chat_subscription_read', { target_chat: chatId });

  if (error) throw error;
}

/**
 * Страница подписчиков чата, свежие сверху. Только участникам: остальным база
 * отказывает. `after` — последняя строка прошлой страницы.
 */
export async function listChatSubscribers(
  chatId: string,
  after: Subscriber | null,
  api = requestClient(),
): Promise<Subscriber[]> {
  const { data, error } = await api.rpc('list_chat_subscribers', {
    target_chat: chatId,
    before_created: after?.subscribedAt,
    before_id: after?.id,
    page_size: SUBSCRIBERS_PAGE_SIZE,
  });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.subscriber_id,
    displayName: row.display_name ?? 'Без имени',
    username: row.username,
    avatarUrl: row.avatar_url,
    inChats: null,
    subscribedAt: row.subscribed_at,
  }));
}
