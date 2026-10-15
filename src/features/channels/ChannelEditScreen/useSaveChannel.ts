import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  ChannelUsernameTakenError,
  setChannelAvatar,
  setChannelDescription,
  setChannelTitle,
  setChannelUsername,
  type Channel,
} from '@/api/channels';
import { channelQueryKey } from '@/features/channels/keys';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { removeOwnChannelAvatar, removeUploadedMedia, uploadChannelAvatar } from '@/features/media';
import { usernameAvailabilityKey } from '@/features/profile/useUsernameAvailability';
import { searchQueryKey } from '@/features/search/useSearch';
import { DeadlineError, withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';

/** Дольше этого правку не ждём — дальше это потеря связи. */
const TEXT_DEADLINE_MS = 20_000;
const PHOTO_DEADLINE_MS = 30_000;

/** Фото в черновике: не трогали, новое (готовый файл) или убрать. */
export type PhotoDraft = { kind: 'keep' } | { kind: 'set'; uri: string } | { kind: 'remove' };

/** Что поменять: только изменённые поля. */
export type ChannelChanges = {
  title?: string;
  description?: string | null;
  username?: string;
  photo: PhotoDraft;
};

/** Текст сбоя сохранения для формы. */
export function describeSaveChannelError(error: unknown): string {
  if (error instanceof ChannelUsernameTakenError) return 'Имя занято';
  if (isNetworkError(error) || error instanceof DeadlineError) {
    return 'Нет связи. Проверьте интернет и попробуйте ещё раз.';
  }

  return 'Не удалось сохранить. Попробуйте ещё раз.';
}

/**
 * Сохранить правку канала: поле за полем, каждое — своей функцией базы с
 * правом владельца. Кеш канала обновляется после каждого шага: страница и
 * экран канала под этим экраном показывают новое сразу. Новое фото ложится в
 * мой префикс, заменённое удаляется, если оно моё, — какое заменено, говорит
 * база: кеш мог отстать.
 */
export function useSaveChannel(channel: Channel, userId: string | null) {
  const queryClient = useQueryClient();
  const channelId = channel.id;

  const patch = useCallback(
    (changes: Partial<Channel>) =>
      queryClient.setQueryData<Channel>(channelQueryKey(channelId), (current) =>
        current ? { ...current, ...changes } : current,
      ),
    [channelId, queryClient],
  );

  return useCallback(
    async (changes: ChannelChanges) => {
      try {
        if (changes.title !== undefined) {
          await withDeadline(setChannelTitle(channelId, changes.title), TEXT_DEADLINE_MS);
          patch({ title: changes.title });
        }

        if (changes.description !== undefined) {
          await withDeadline(
            setChannelDescription(channelId, changes.description),
            TEXT_DEADLINE_MS,
          );
          patch({ description: changes.description });
        }

        if (changes.username !== undefined) {
          const username = changes.username;

          try {
            await withDeadline(setChannelUsername(channelId, username), TEXT_DEADLINE_MS);
          } catch (error) {
            // Имя заняли между проверкой и отправкой: старый «свободно» больше не правда.
            if (error instanceof ChannelUsernameTakenError) {
              void queryClient.invalidateQueries({
                queryKey: usernameAvailabilityKey('channel', username, channelId),
              });
            }
            throw error;
          }
          patch({ username });
        }

        if (changes.photo.kind !== 'keep') {
          if (!userId) throw new Error('Нет активной сессии');

          const avatarUrl = await savePhoto(channelId, userId, changes.photo);

          patch({ avatarUrl });
        }
      } finally {
        void queryClient.invalidateQueries({ queryKey: channelQueryKey(channelId) });
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        // Поиск показывал канал со старым названием и фото.
        void queryClient.invalidateQueries({ queryKey: searchQueryKey });
      }
    },
    [channelId, patch, queryClient, userId],
  );
}

async function savePhoto(
  channelId: string,
  userId: string,
  photo: Exclude<PhotoDraft, { kind: 'keep' }>,
): Promise<string | null> {
  if (photo.kind === 'remove') {
    const replaced = await withDeadline(setChannelAvatar(channelId, null), PHOTO_DEADLINE_MS);
    // Канал уже без фото; файл убирается без ожидания.
    void removeOwnChannelAvatar(replaced, userId);
    return null;
  }

  // Загрузка в Storage без связи не падает, а висит: срок превращает её в ошибку.
  const uploaded = await withDeadline(
    uploadChannelAvatar(photo.uri, userId),
    PHOTO_DEADLINE_MS,
    (late) => {
      void removeUploadedMedia(late.path);
    },
  );
  let replaced: string | null;

  try {
    replaced = await withDeadline(setChannelAvatar(channelId, uploaded.url), PHOTO_DEADLINE_MS);
  } catch (error) {
    // База фото не приняла — файл никому не нужен. Кроме запроса, оборванного
    // по сроку: он мог дойти, и файл тогда — фото канала.
    if (!(error instanceof DeadlineError)) void removeUploadedMedia(uploaded.path);
    throw error;
  }

  void removeOwnChannelAvatar(replaced, userId);
  return uploaded.url;
}
