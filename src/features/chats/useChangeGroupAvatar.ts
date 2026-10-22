import { useMutation, useQueryClient } from '@tanstack/react-query';

import { setChatAvatar, type ChatSummary } from '@/api/chats';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { chatQueryKey } from '@/features/chats/useChat';
import { removeOwnGroupAvatar, removePublicMedia, uploadGroupAvatar } from '@/features/media';
import { DeadlineError, withDeadline } from '@/lib/deadline';

/** Дольше этого смену фото не ждём — дальше это потеря связи. */
export const GROUP_AVATAR_DEADLINE_MS = 30_000;

export type GroupAvatarChange =
  /** Новое фото — файл уже квадратный и сжатый (`prepareAvatar`). */
  { kind: 'set'; uri: string } | { kind: 'remove' };

/**
 * Поставить, сменить или убрать фото группы. Новый файл ложится в мой
 * префикс; заменённый удаляется, только если он тоже мой — фото, поставленное
 * другим участником, лежит у него, и удалить его нельзя. Какой файл заменён,
 * говорит база: кеш мог отстать.
 */
export function useChangeGroupAvatar(chatId: string, userId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<string | null, Error, GroupAvatarChange>({
    // Без связи React Query поставил бы мутацию на паузу, и крутилка на
    // аватарке висела бы молча. Смена пробуется сразу и честно падает.
    networkMode: 'always',
    mutationFn: async (change) => {
      if (!userId) throw new Error('Нет активной сессии');

      if (change.kind === 'remove') {
        const replaced = await withDeadline(setChatAvatar(chatId, null), GROUP_AVATAR_DEADLINE_MS);
        // Группа уже без фото; файл убирается без ожидания — без связи
        // удаление в Storage висело бы вместе с крутилкой.
        void removeOwnGroupAvatar(replaced, userId);
        return null;
      }

      // Загрузка в Storage без связи не падает, а висит: срок превращает её в
      // ошибку. Файл, доехавший после срока, никому не нужен.
      const uploaded = await withDeadline(
        uploadGroupAvatar(change.uri, userId),
        GROUP_AVATAR_DEADLINE_MS,
        (late) => {
          void removePublicMedia(late.path);
        },
      );
      let replaced: string | null;

      try {
        replaced = await withDeadline(
          setChatAvatar(chatId, uploaded.url),
          GROUP_AVATAR_DEADLINE_MS,
        );
      } catch (error) {
        // База фото не приняла — файл никому не нужен. Кроме запроса,
        // оборванного по сроку: он мог дойти, и файл тогда — фото группы.
        if (!(error instanceof DeadlineError)) void removePublicMedia(uploaded.path);
        throw error;
      }

      void removeOwnGroupAvatar(replaced, userId);
      return uploaded.url;
    },
    onSuccess: (avatarUrl) => {
      queryClient.setQueryData<ChatSummary>(chatQueryKey(chatId), (chat) =>
        chat ? { ...chat, avatarUrl } : chat,
      );
      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId), exact: true });
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
    },
  });
}
