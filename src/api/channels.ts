// Каналы. Канал читает любой; создаёт и меняет его только функция в базе —
// прямой записи в `channels` с клиента нет. Посты канала — обычные сообщения
// его чата постов, их шлют функции из `chats.ts`.

import { supabase } from '@/api/supabase';
import type { Tables } from '@/api/types.gen';

type ChannelRow = Pick<
  Tables<'channels'>,
  | 'id'
  | 'title'
  | 'description'
  | 'username'
  | 'avatar_url'
  | 'owner_id'
  | 'posts_chat_id'
  | 'subscribers_count'
  | 'readers_count'
>;

export type Channel = {
  id: string;
  title: string;
  description: string | null;
  username: string;
  avatarUrl: string | null;
  /** Null, если аккаунт владельца удалён: канал живёт дальше. */
  ownerId: string | null;
  /** Чат, сообщения которого — посты канала. */
  postsChatId: string;
  /** Все подписавшиеся — и добавившие канал в чаты, и нет. */
  subscribersCount: number;
  /** Подписчики, у которых канал лежит в «Чатах». */
  readersCount: number;
};

export type CreateChannelInput = {
  title: string;
  username: string;
  description?: string | null;
  avatarUrl?: string | null;
};

export type CreatedChannel = { channelId: string; chatId: string };

/** `@имя` уже занято другим каналом. */
export class ChannelUsernameTakenError extends Error {
  constructor(readonly username: string) {
    super(`Username "${username}" is already taken`);
    this.name = 'ChannelUsernameTakenError';
  }
}

/** Код, которым `create_channel` отвергает занятое имя. */
const USERNAME_TAKEN_CODE = 'OPN02';

const COLUMNS =
  'id, title, description, username, avatar_url, owner_id, posts_chat_id, subscribers_count, readers_count';

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    username: row.username,
    avatarUrl: row.avatar_url,
    ownerId: row.owner_id,
    postsChatId: row.posts_chat_id,
    subscribersCount: row.subscribers_count,
    readersCount: row.readers_count,
  };
}

export async function createChannel(
  input: CreateChannelInput,
  signal?: AbortSignal,
): Promise<CreatedChannel> {
  let request = supabase.rpc('create_channel', {
    channel_title: input.title,
    channel_username: input.username,
    channel_description: input.description ?? undefined,
    channel_avatar_url: input.avatarUrl ?? undefined,
  });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) {
    if (error.code === USERNAME_TAKEN_CODE) throw new ChannelUsernameTakenError(input.username);
    throw error;
  }

  const row = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

  if (typeof row.channel_id !== 'string' || typeof row.chat_id !== 'string') {
    throw new Error('Не удалось создать канал');
  }

  return { channelId: row.channel_id, chatId: row.chat_id };
}

export async function getChannel(channelId: string): Promise<Channel> {
  const { data, error } = await supabase
    .from('channels')
    .select(COLUMNS)
    .eq('id', channelId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Канал не найден');

  return toChannel(data);
}

/** Канал, чей чат постов — `chatId`; null, если это обычный чат. */
export async function findChannelIdByChat(chatId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('channels')
    .select('id')
    .eq('posts_chat_id', chatId)
    .maybeSingle();

  if (error) throw error;

  return data?.id ?? null;
}

/** Канал по `@имени`, без учёта регистра и `@`; нет такого — null. */
export async function findChannelByUsername(username: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_channel_by_username', { name: username });

  if (error) throw error;

  // Скалярный ответ rpc генератор типов не размечает как nullable.
  return (data as string | null) ?? null;
}

// Правка канала — только функциями базы, право владельца проверяет она.

/** Сменить название. Пустое база отвергает. */
export async function setChannelTitle(channelId: string, title: string): Promise<void> {
  const { error } = await supabase.rpc('set_channel_title', {
    target_channel: channelId,
    new_title: title,
  });

  if (error) throw error;
}

/** Задать или убрать (`null`) описание. */
export async function setChannelDescription(
  channelId: string,
  description: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_channel_description', {
    target_channel: channelId,
    new_description: description ?? '',
  });

  if (error) throw error;
}

/** Сменить `@имя`. Занятое другим каналом — `ChannelUsernameTakenError`. */
export async function setChannelUsername(channelId: string, username: string): Promise<void> {
  const { error } = await supabase.rpc('set_channel_username', {
    target_channel: channelId,
    new_username: username,
  });

  if (error) {
    if (error.code === USERNAME_TAKEN_CODE) throw new ChannelUsernameTakenError(username);
    throw error;
  }
}

/**
 * Поставить или убрать (`null`) фото канала. Адрес — только файл аватарки
 * канала в моём префиксе бакета (`uploadChannelAvatar`). Отдаёт адрес,
 * который заменён на самом деле.
 */
export async function setChannelAvatar(
  channelId: string,
  avatarUrl: string | null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_channel_avatar', {
    target_channel: channelId,
    new_avatar_url: avatarUrl ?? '',
  });

  if (error) throw error;

  return (data as string | null) ?? null;
}

/** Счётчики вкладок страницы канала. */
export type ChannelInfoSummary = {
  subscribers: number;
  readers: number;
  pops: number;
  photos: number;
  videos: number;
  voices: number;
};

export async function getChannelInfoSummary(channelId: string): Promise<ChannelInfoSummary> {
  const { data, error } = await supabase.rpc('channel_info_summary', {
    target_channel: channelId,
  });

  if (error) throw error;

  const row = data?.[0];

  return {
    subscribers: row?.subscribers ?? 0,
    readers: row?.readers ?? 0,
    pops: row?.pops ?? 0,
    photos: row?.photos ?? 0,
    videos: row?.videos ?? 0,
    voices: row?.voices ?? 0,
  };
}
