import { useQuery } from '@tanstack/react-query';

import { getMyInvite, type MyInvite } from '@/api/invites';

export function myInviteQueryKey(chatId: string) {
  return ['my-invite', chatId] as const;
}

/**
 * Моя заявка в этот чат. Решает, что показать вместо поля ввода, пока я не
 * участник: кнопки ответа на заявку или просто «читать может кто угодно».
 */
export function useMyInvite(chatId: string, enabled: boolean): MyInvite | null {
  const { data } = useQuery({
    queryKey: myInviteQueryKey(chatId),
    queryFn: () => getMyInvite(chatId),
    enabled,
  });

  return data ?? null;
}
