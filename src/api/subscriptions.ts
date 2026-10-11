// Подписки на каналы. Подписка — приватная строка «я + канал»: читает её
// только сам подписчик, а пишут только функции базы — подписаться может не
// каждый (публикующий в канале — нет), а отметки прочтения ставит время
// сервера. Подписка никогда не делает участником чата постов: писать посты
// подписчик не может, это проверяет политика на `messages`.

import { supabase } from '@/api/supabase';

/** Моя подписка на канал с тем, что в нём для меня непрочитано. */
export type ChannelSubscription = {
  channelId: string;
  /** Чат постов канала. */
  chatId: string;
  /** Читатель: канал лежит в «Чатах». */
  inChats: boolean;
  /** Карточки о новых постах и попсах (только у читателя). */
  notify: boolean;
  unreadPosts: number;
  unreadPops: number;
};

/** Подписчик в списке, который видит создатель канала. */
export type ChannelSubscriber = {
  /** Id строки подписки — ключ страницы. */
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  inChats: boolean;
  subscribedAt: string;
};

export const SUBSCRIBERS_PAGE_SIZE = 30;

type SubscriptionRow = {
  channel_id: string;
  chat_id: string;
  in_chats: boolean;
  notify: boolean;
  unread_posts: number;
  unread_pops: number;
};

function toSubscription(row: SubscriptionRow): ChannelSubscription {
  return {
    channelId: row.channel_id,
    chatId: row.chat_id,
    inChats: row.in_chats,
    notify: row.notify,
    unreadPosts: row.unread_posts,
    unreadPops: row.unread_pops,
  };
}

/** Моя подписка на канал; `null` — не подписан. */
export async function getMySubscription(channelId: string): Promise<ChannelSubscription | null> {
  const { data, error } = await supabase.rpc('my_channel_subscriptions', {
    target_channel: channelId,
  });

  if (error) throw error;

  const row = data?.[0];

  return row ? toSubscription(row) : null;
}

/** Подписки, которые лежат в «Чатах», — одним запросом на весь список. */
export async function listChatSubscriptions(): Promise<ChannelSubscription[]> {
  const { data, error } = await supabase.rpc('my_channel_subscriptions', {});

  if (error) throw error;

  return (data ?? []).map(toSubscription);
}

/** Подписаться; `addToChats` — сразу читателем. Повтор — не ошибка. */
export async function subscribeToChannel(channelId: string, addToChats: boolean): Promise<void> {
  const { error } = await supabase.rpc('subscribe_to_channel', {
    target_channel: channelId,
    add_to_chats: addToChats,
  });

  if (error) throw error;
}

export async function setChannelInChats(channelId: string, inChats: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_channel_in_chats', {
    target_channel: channelId,
    value: inChats,
  });

  if (error) throw error;
}

export async function setChannelNotifications(channelId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_channel_notifications', {
    target_channel: channelId,
    enabled,
  });

  if (error) throw error;
}

export async function unsubscribeFromChannel(channelId: string): Promise<void> {
  const { error } = await supabase.rpc('unsubscribe_from_channel', { target_channel: channelId });

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
): Promise<void> {
  const { error } = await supabase.rpc('mark_channel_read', {
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
  after: ChannelSubscriber | null,
): Promise<ChannelSubscriber[]> {
  const { data, error } = await supabase.rpc('list_channel_subscribers', {
    target_channel: channelId,
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
    inChats: row.in_chats,
    subscribedAt: row.subscribed_at,
  }));
}
