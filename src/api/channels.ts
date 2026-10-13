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
