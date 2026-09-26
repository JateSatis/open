// Заявки в чат. Участником становятся только двумя путями — создатель чата и
// принявший заявку, — и оба живут в функциях базы (`create_chat`,
// `accept_chat_invite`): прямой записи в `chat_members` с клиента нет.
//
// Полный статус заявки видит только сам приглашённый. Всем остальным база
// отдаёт лишь «ещё не принял» (`ChatSummary.waiting`), так что отказ не
// утекает создателю даже прямым запросом.

import {
  chatsSelect,
  fetchChatPeople,
  getCurrentUserId,
  MESSAGE_COLUMNS,
  toMessage,
  toSummary,
  type ChatSummary,
  type Message,
  type Person,
} from '@/api/chats';
import { supabase } from '@/api/supabase';

/** Сколько последних сообщений показывает карточка заявки. */
export const INVITE_PREVIEW_MESSAGES = 3;

export type InviteStatus = 'pending' | 'declined';

export type ChatInvite = {
  chatId: string;
  status: InviteStatus;
  invitedAt: string;
  inviter: Person | null;
  chat: ChatSummary;
  /** Последние сообщения, новые первыми. */
  recentMessages: Message[];
};

/** Моя заявка в конкретный чат — то, что решает, какие кнопки показать в переписке. */
export type MyInvite = {
  status: 'pending' | 'accepted' | 'declined';
  inviter: Person | null;
};

export type CreateChatInput = {
  inviteeIds: string[];
  title?: string;
};

export type CreateChatResult =
  | { outcome: 'created'; chatId: string }
  /**
   * Эти же люди уже зовут меня в чат с тем же составом. Второй чат не
   * создаётся — вместо него открывается их заявка (решение человека).
   */
  | { outcome: 'incoming_invite'; chatId: string };

/**
 * Я уже звал этот же набор людей, и в том чате ещё не все приняли. Несёт id
 * того чата, чтобы интерфейс мог в него провести.
 */
export class DuplicateChatError extends Error {
  constructor(readonly chatId: string) {
    super('Вы уже позвали этих людей, и ответили ещё не все');
    this.name = 'DuplicateChatError';
  }
}

/** Код, которым `create_chat` отвергает повтор набора людей. */
const DUPLICATE_CHAT_CODE = 'OPN01';

const INVITE_COLUMNS =
  'chat_id, status, created_at, inviter:profiles!chat_invites_inviter_id_fkey(id, display_name, avatar_url)';

type InviterRow = { id: string; display_name: string | null; avatar_url: string | null } | null;

function toPerson(row: InviterRow): Person | null {
  if (!row) return null;

  return { id: row.id, displayName: row.display_name ?? 'Без имени', avatarUrl: row.avatar_url };
}

function toResult(data: unknown): CreateChatResult {
  const row = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

  if (typeof row.chat_id !== 'string') throw new Error('Не удалось создать чат');

  return row.outcome === 'incoming_invite'
    ? { outcome: 'incoming_invite', chatId: row.chat_id }
    : { outcome: 'created', chatId: row.chat_id };
}

/**
 * Один выбранный — личный диалог, несколько — группа. Все проверки (не себя,
 * не удалённый профиль, не повтор набора) делает база под блокировкой: два
 * одновременных нажатия не создадут два чата.
 */
export async function createChat({
  inviteeIds,
  title,
}: CreateChatInput): Promise<CreateChatResult> {
  const { data, error } = await supabase.rpc('create_chat', {
    invitee_ids: inviteeIds,
    // Функция принимает NULL, но генератор типов не размечает скалярные
    // аргументы rpc как nullable — отсюда приведение.
    chat_title: (title?.trim() || null) as string,
  });

  if (error) {
    if (error.code === DUPLICATE_CHAT_CODE && error.details) {
      throw new DuplicateChatError(error.details);
    }

    throw error;
  }

  return toResult(data);
}

async function fetchRecentMessages(chatIds: string[]): Promise<Map<string, Message[]>> {
  const byChat = new Map<string, Message[]>();

  if (chatIds.length === 0) return byChat;

  // Одна функция на все карточки сразу, а не запрос на каждую заявку.
  const { data, error } = await supabase
    .rpc('latest_chat_messages', { chat_ids: chatIds, per_chat: INVITE_PREVIEW_MESSAGES })
    .select(MESSAGE_COLUMNS)
    .order('created_at', { ascending: false })
    .order('position', { referencedTable: 'attachments' });

  if (error) throw error;

  for (const row of data ?? []) {
    const message = toMessage(row);
    byChat.set(message.chatId, [...(byChat.get(message.chatId) ?? []), message]);
  }

  return byChat;
}

/**
 * Мои заявки, которые ещё не приняты: входящие и отклонённые. Каждая — с
 * чатом, его составом и последними сообщениями, чтобы решить, не открывая
 * переписку.
 */
export async function listInvites(): Promise<ChatInvite[]> {
  const userId = await getCurrentUserId();

  const { data: inviteData, error: inviteError } = await supabase
    .from('chat_invites')
    .select(INVITE_COLUMNS)
    .eq('invitee_id', userId)
    .neq('status', 'accepted')
    .order('created_at', { ascending: false });

  if (inviteError) throw inviteError;

  const invites = inviteData ?? [];
  const chatIds = invites.map((invite) => invite.chat_id);

  if (chatIds.length === 0) return [];

  const [chatResult, peopleByChat, messagesByChat] = await Promise.all([
    chatsSelect().in('id', chatIds).is('deleted_at', null),
    fetchChatPeople(chatIds),
    fetchRecentMessages(chatIds),
  ]);

  if (chatResult.error) throw chatResult.error;

  const chatsById = new Map((chatResult.data ?? []).map((chat) => [chat.id, chat]));

  return invites.flatMap((invite): ChatInvite[] => {
    const chat = chatsById.get(invite.chat_id);

    // Удалённый чат принять уже нельзя — и показывать незачем.
    if (!chat) return [];

    return [
      {
        chatId: invite.chat_id,
        status: invite.status === 'declined' ? 'declined' : 'pending',
        invitedAt: invite.created_at,
        inviter: toPerson(invite.inviter),
        chat: toSummary(chat, peopleByChat.get(chat.id) ?? { members: [], waiting: [] }, userId),
        recentMessages: messagesByChat.get(chat.id) ?? [],
      },
    ];
  });
}

/** Моя заявка в этот чат или `null`, если меня туда не звали. */
export async function getMyInvite(chatId: string): Promise<MyInvite | null> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('chat_invites')
    .select(INVITE_COLUMNS)
    .eq('chat_id', chatId)
    .eq('invitee_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const status =
    data.status === 'accepted' ? 'accepted' : data.status === 'declined' ? 'declined' : 'pending';

  return { status, inviter: toPerson(data.inviter) };
}

/** Принять можно и входящую, и отклонённую заявку. */
export async function acceptInvite(chatId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_chat_invite', { target_chat: chatId });

  if (error) throw error;
}

/** Отклонить можно только входящую: принятая — это уже участие в чате. */
export async function declineInvite(chatId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_chat_invite', { target_chat: chatId });

  if (error) throw error;
}
