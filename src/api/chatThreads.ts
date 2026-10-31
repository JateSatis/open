// Треды в чатах — вид «Треды» в группе. Ответ — сообщение с цитатой на
// сообщение этого чата; его корни база пишет в `chat_thread_root_ids`.
// Лента «Тредов» — сообщения без корней; сводки плашек и сам тред считает
// база глазами смотрящего (`20261110100000_chat_threads.sql`).

import { MESSAGE_PAGE_SIZE, type MessagePage } from '@/api/messagePage';
import { toPreview, type MessagePreview, type PreviewAttachment } from '@/api/messagePreview';
import { messagesSelect, toMessage, toMessageKind, type Message } from '@/api/messageRows';
import { opaqueFlag } from '@/api/opaquePeople';
import { NO_REACTIONS } from '@/api/reactionCounts';
import { supabase } from '@/api/supabase';

/** Ответивший в треде — глазами смотрящего, как автор в `message_rows`. */
export type ChatThreadPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  opaque?: boolean;
};

/** Плашка треда под исходным сообщением. */
export type ChatThreadSummary = {
  rootId: string;
  /** Видимых мне ответов, включая ответы на ответы. */
  repliesCount: number;
  /** Последний ответ; `null` — все ответы скрыты (сообщения заблокировавших). */
  last: {
    seq: number;
    /** `null` — время чата скрыто от меня. */
    createdAt: string | null;
    preview: MessagePreview;
  } | null;
  /** Двое последних ответивших, самый свежий первым. */
  people: ChatThreadPerson[];
  /** Сколько ещё ответивших, кроме показанных. */
  othersCount: number;
  /** Я уже отвечал, в том числе среди авторов за «+N». */
  viewerReplied?: boolean;
};

/** Страница ответов треда: облачка и их цитаты, входящие в этот тред. */
export type ChatThreadPage = {
  items: Message[];
  /** id сообщения → его цитаты из этого треда, кроме корня. */
  quotes: Record<string, string[]>;
  /** Страница полная — за ней может быть ещё. */
  full: boolean;
};

export const CHAT_THREAD_PAGE_SIZE = 30;

/** Номера корней видимого ответа, включая удалённые исходные. */
export async function listChatThreadRootPositions(replyId: string): Promise<{ id: string; seq: number }[]> {
  const { data, error } = await supabase.rpc('chat_thread_root_positions', { p_reply: replyId });
  if (error) throw error;
  return data ?? [];
}

/** Самый большой номер — «до конца треда» для страницы с хвоста. */
const END_SEQ = Number.MAX_SAFE_INTEGER;

/** Заглушка удалённого исходного сообщения: «Сообщение удалено» на его месте. */
export function deletedChatThreadRoot(chatId: string, id: string, seq: number): Message {
  return {
    id,
    chatId,
    authorId: null,
    kind: 'text',
    text: null,
    seq,
    createdAt: null,
    editedAt: null,
    edited: false,
    editMark: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    chatThreadRootIds: null,
    chatThreadDeletedRoot: true,
  };
}

/**
 * Страница ленты «Тредов», самые новые первыми: сообщения, которые сами не
 * ответы (и ответы только на островки), плюс заглушки удалённых исходных с
 * живыми ответами. Обе выборки — до `cursor`, по `limit`; верхние `limit`
 * их объединения и есть страница.
 */
export async function listChatThreadFeed(
  chatId: string,
  params: { cursor?: number; limit?: number } = {},
): Promise<MessagePage> {
  const limit = params.limit ?? MESSAGE_PAGE_SIZE;
  let query = messagesSelect()
    .eq('chat_id', chatId)
    .is('chat_thread_root_ids', null)
    .order('seq', { ascending: false })
    .limit(limit);

  if (params.cursor !== undefined) query = query.lt('seq', params.cursor);

  const [rows, stubs] = await Promise.all([
    query,
    supabase.rpc('list_chat_thread_deleted_roots', {
      p_chat: chatId,
      p_before_seq: params.cursor,
      p_limit: limit,
    }),
  ]);

  if (rows.error) throw rows.error;
  if (stubs.error) throw stubs.error;

  const live = (rows.data ?? []).map(toMessage);
  const deleted = (stubs.data ?? []).map((row) => deletedChatThreadRoot(chatId, row.id, row.seq));
  // Ещё есть, если хоть одна выборка полная или вместе они не влезли в страницу.
  const full =
    live.length === limit || deleted.length === limit || live.length + deleted.length > limit;
  const items = [...live, ...deleted].sort((a, b) => b.seq - a.seq).slice(0, limit);

  return {
    items,
    nextCursor: full && items.length > 0 ? items[items.length - 1].seq : null,
  };
}

/** Сообщения ленты «Тредов» после `sinceSeq`, старые первыми, — дочитывание по сигналу. */
export async function listChatThreadFeedSince(chatId: string, sinceSeq: number): Promise<Message[]> {
  const { data, error } = await messagesSelect()
    .eq('chat_id', chatId)
    .is('chat_thread_root_ids', null)
    .gt('seq', sinceSeq)
    .order('seq', { ascending: true })
    .limit(MESSAGE_PAGE_SIZE);

  if (error) throw error;

  return (data ?? []).map(toMessage);
}

type SummaryPersonRow = { id: string; name: string | null; avatar_url: string | null; opaque: boolean | null };

/** Сводки плашек пачкой. Корня без видимых мне ответов в ответе нет. */
export async function listChatThreadSummaries(rootIds: string[]): Promise<ChatThreadSummary[]> {
  if (rootIds.length === 0) return [];

  const { data, error } = await supabase.rpc('chat_thread_summaries', { p_root_ids: rootIds });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    rootId: row.root_id,
    repliesCount: row.replies_count,
    last:
      row.last_seq === null
        ? null
        : {
            seq: row.last_seq,
            createdAt: row.last_created_at,
            preview: toPreview(
              toMessageKind(row.last_kind),
              row.last_text,
              (row.last_attachments ?? []) as PreviewAttachment[],
            ),
          },
    people: ((row.people ?? []) as SummaryPersonRow[]).map((person) => ({
      id: person.id,
      name: person.name ?? 'Без имени',
      avatarUrl: person.avatar_url,
      opaque: opaqueFlag(person.id, person.opaque),
    })),
    othersCount: row.others_count,
    viewerReplied: row.viewer_replied,
  }));
}

/**
 * Ответы треда по порядку: после `afterSeq` (начало) или самые поздние до
 * `beforeSeq` (`'end'` — хвост треда). Облачка — той же выборкой, что в
 * переписке, по id из базы.
 */
export async function listChatThread(
  rootId: string,
  params: { afterSeq?: number; beforeSeq?: number | 'end'; limit?: number } = {},
): Promise<ChatThreadPage> {
  const limit = params.limit ?? CHAT_THREAD_PAGE_SIZE;
  const { data, error } = await supabase.rpc('list_chat_thread', {
    p_root: rootId,
    p_after_seq: params.afterSeq,
    p_before_seq: params.beforeSeq === 'end' ? END_SEQ : params.beforeSeq,
    p_limit: limit,
  });

  if (error) throw error;

  const page = data ?? [];
  const quotes: Record<string, string[]> = {};

  page.forEach((row) => {
    quotes[row.id] = row.quote_ids ?? [];
  });

  if (page.length === 0) return { items: [], quotes, full: false };

  const fetched = await messagesSelect().in(
    'id',
    page.map((row) => row.id),
  );

  if (fetched.error) throw fetched.error;

  const items = (fetched.data ?? []).map(toMessage).sort((a, b) => a.seq - b.seq);

  return { items, quotes, full: page.length === limit };
}
