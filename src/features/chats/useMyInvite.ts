import { useQuery } from '@tanstack/react-query';

import { getMyInvite, type MyInvite } from '@/api/invites';

export function myInviteQueryKey(chatId: string) {
  return ['my-invite', chatId] as const;
}

/**
 * Моя заявка в этот чат. Решает, что показать вместо поля ввода, пока я не
 * участник: кнопки ответа на заявку или «Подписаться». `undefined` — ещё не
 * известна: «Подписаться» не мигает перед панелью заявки.
 */
export function useMyInvite(chatId: string, enabled: boolean): MyInvite | null | undefined {
  const { data, isError } = useQuery({
    queryKey: myInviteQueryKey(chatId),
    queryFn: () => getMyInvite(chatId),
    enabled,
  });

  // Не узнали — как будто заявки нет: низ переписки не остаётся пустым.
  return data === undefined && isError ? null : data;
}
