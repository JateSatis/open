import { useMutation, useQueryClient } from '@tanstack/react-query';

import { setChatAvatar, type ChatSummary } from '@/api/chats';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { chatQueryKey } from '@/features/chats/useChat';
import { removeOwnGroupAvatar, removeUploadedMedia, uploadGroupAvatar } from '@/features/media';
import { DeadlineError, withDeadline } from '@/lib/deadline';

/** Дольше этого смену фото не ждём — дальше это потеря связи. */
const SAVE_DEADLINE_MS = 30_000;

export type GroupAvatarChange =
  /** Новое фото — файл уже квадратный и сжатый (`prepareAvatar`). */
  { kind: 'set'; uri: string } | { kind: 'remove' };

/**
 * Поставить, сменить или убрать фото группы. Новый файл ложится в мой
 * префикс; прежний удаляется, только если он тоже мой — фото, поставленное
 * другим участником, лежит у него, и удалить его нельзя.
 */
export function useChangeGroupAvatar(chatId: string, userId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<string | null, Error, GroupAvatarChange>({
    // Без связи React Query поставил бы мутацию на паузу, и крутилка на
    // аватарке висела бы молча. Смена пробуется сразу и честно падает.
    networkMode: 'always',
    mutationFn: async (change) => {
      if (!userId) throw new Error('Нет активной сессии');

      const previous =
        queryClient.getQueryData<ChatSummary>(chatQueryKey(chatId))?.avatarUrl ?? null;

      if (change.kind === 'remove') {
        await withDeadline(setChatAvatar(chatId, null), SAVE_DEADLINE_MS);
        // Группа уже без фото; файл убирается без ожидания — без связи
        // удаление в Storage висело бы вместе с крутилкой.
        void removeOwnGroupAvatar(previous, userId);
        return null;
      }

      // Загрузка в Storage без связи не падает, а висит: срок превращает её в
      // ошибку. Файл, доехавший после срока, никому не нужен.
      const uploaded = await withDeadline(
        uploadGroupAvatar(change.uri, userId),
        SAVE_DEADLINE_MS,
        (late) => {
          void removeUploadedMedia(late.path);
        },
      );

      try {
        await withDeadline(setChatAvatar(chatId, uploaded.url), SAVE_DEADLINE_MS);
      } catch (error) {
        // База фото не приняла — файл никому не нужен. Кроме запроса,
        // оборванного по сроку: он мог дойти, и файл тогда — фото группы.
        if (!(error instanceof DeadlineError)) void removeUploadedMedia(uploaded.path);
        throw error;
      }

      if (previous !== uploaded.url) void removeOwnGroupAvatar(previous, userId);
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
