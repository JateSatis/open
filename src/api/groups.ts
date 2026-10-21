// Состав и настройки группы, удаление личного диалога. Права проверяет база
// (миграция `20261020100000_group_management.sql`): настраивает группу и
// удаляет участников только владелец (`can_manage_chat`), звать может любой
// участник, уйти — только функцией. Скрытая в интерфейсе кнопка — лишь
// дополнение к отказу базы.

import { supabase } from '@/api/supabase';

/** Человек в выборе, кого позвать: имя, `@имя` и аватарка. */
export type PersonCandidate = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
};

/** Ключ следующей страницы людей: имя и id последнего на прошлой. */
export type PeopleCursor = { name: string; id: string };

export type PeoplePage = { items: PersonCandidate[]; next: PeopleCursor | null };

export const PEOPLE_PAGE_SIZE = 30;

/**
 * Люди страницей по алфавиту. Пустой запрос — знакомые: друзья и люди из
 * моих личек и групп. Запрос — по имени или `@имени` среди знакомых и тех,
 * кто пускает меня в поиск. Каталога всех нет; себя база не отдаёт. Частоту
 * ограничивает сервер — отказ узнаёт `isSearchRateLimited`.
 */
export async function searchPeople(
  query: string,
  cursor: PeopleCursor | null,
  signal?: AbortSignal,
): Promise<PeoplePage> {
  let request = supabase.rpc('search_people', {
    query: query.trim(),
    after_name: cursor?.name,
    after_id: cursor?.id,
    page_size: PEOPLE_PAGE_SIZE,
  });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  // Колонки результата rpc генератор типов не размечает как nullable.
  const items = (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name ?? 'Без имени',
    username: row.username ?? null,
    avatarUrl: row.avatar_url ?? null,
  }));
  const last = data?.[data.length - 1];

  return {
    items,
    next:
      items.length === PEOPLE_PAGE_SIZE && last
        ? { name: last.display_name ?? '', id: last.id }
        : null,
  };
}

/** Позвать людей в группу. Отдаёт, скольких позвали (участники и уже позванные пропускаются). */
export async function inviteToChat(chatId: string, userIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('invite_to_chat', {
    target_chat: chatId,
    invitee_ids: userIds,
  });

  if (error) throw error;

  return data ?? 0;
}

/** Покинуть группу. Владелец уходит — владение переходит само. */
export async function leaveChat(chatId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_chat', { target_chat: chatId });

  if (error) throw error;
}

/** Удалить участника из группы (только владелец). */
export async function removeChatMember(chatId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_chat_member', {
    target_chat: chatId,
    target_user: userId,
  });

  if (error) throw error;
}

/** Отменить ещё не принятое приглашение (только владелец). */
export async function cancelChatInvite(chatId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_chat_invite', {
    target_chat: chatId,
    target_user: userId,
  });

  if (error) throw error;
}

/** Задать или убрать (`null`) описание группы (только владелец). */
export async function setChatDescription(chatId: string, description: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_chat_description', {
    target_chat: chatId,
    new_description: description ?? '',
  });

  if (error) throw error;
}

/** Удалить свой личный диалог — для обоих и для всех, кто его читает. */
export async function deleteDirectChat(chatId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_direct_chat', { target_chat: chatId });

  if (error) throw error;
}
