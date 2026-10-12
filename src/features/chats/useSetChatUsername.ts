import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ChatUsernameTakenError, setChatUsername, type ChatSummary } from '@/api/chats';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { chatQueryKey } from '@/features/chats/useChat';
import { usernameAvailabilityKey } from '@/features/profile/useUsernameAvailability';
import { withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';

/** Дольше этого сохранение не ждём — дальше это потеря связи. */
const SAVE_DEADLINE_MS = 20_000;

/** Текст сбоя сохранения для формы. */
export function describeSetChatUsernameError(error: unknown): string {
  if (error instanceof ChatUsernameTakenError) return 'Имя занято';
  if (isNetworkError(error)) return 'Нет связи. Проверьте интернет и попробуйте ещё раз.';

  return 'Не удалось сохранить. Попробуйте ещё раз.';
}

/** Задать, сменить или убрать (`null`) `@имя` группы. */
export function useSetChatUsername(chatId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    // Без связи React Query поставил бы мутацию на паузу, и кнопка крутилась
    // бы молча. Сохранение пробуется сразу и честно падает по сроку.
    networkMode: 'always',
    mutationFn: (username: string | null) =>
      withDeadline(setChatUsername(chatId, username), SAVE_DEADLINE_MS),
    onSuccess: (_result, username) => {
      queryClient.setQueryData<ChatSummary>(chatQueryKey(chatId), (chat) =>
        chat ? { ...chat, username } : chat,
      );
      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId), exact: true });
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
    },
    // Имя заняли между проверкой и отправкой: старый ответ «свободно» больше не правда.
    onError: (error, username) => {
      if (error instanceof ChatUsernameTakenError && username) {
        void queryClient.invalidateQueries({
          queryKey: usernameAvailabilityKey('group', username, chatId),
        });
      }
    },
  });
}
