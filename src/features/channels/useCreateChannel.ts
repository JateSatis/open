import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ChannelUsernameTakenError, createChannel, type CreatedChannel } from '@/api/channels';
import { chatsQueryKey } from '@/features/chats/useChats';
import { removePublicMedia, uploadChannelAvatar } from '@/features/media';
import { usernameAvailabilityKey } from '@/features/profile/useUsernameAvailability';
import { DeadlineError, withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';

/** Дольше этого создание канала не ждём — дальше это потеря связи. */
const CREATE_DEADLINE_MS = 30_000;

export type NewChannel = {
  title: string;
  username: string;
  description: string;
  /** Уже обрезанное до квадрата и сжатое фото на устройстве. */
  avatarUri: string | null;
};

/**
 * Аватарка загружается первой: канал создаётся сразу с её адресом. Если
 * создание сорвалось — файл убирается из бакета, висеть ему не за чем.
 */
async function createWithAvatar(input: NewChannel, userId: string): Promise<CreatedChannel> {
  // Без связи загрузка в Storage и запрос не падают, а висят: срок превращает
  // их в понятную ошибку. Файл, доехавший после срока, убирается.
  const avatar = input.avatarUri
    ? await withDeadline(
        uploadChannelAvatar(input.avatarUri, userId),
        CREATE_DEADLINE_MS,
        (late) => {
          void removePublicMedia(late.path);
        },
      )
    : null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CREATE_DEADLINE_MS);

  try {
    return await createChannel(
      {
        title: input.title.trim(),
        username: input.username.trim(),
        description: input.description.trim() || null,
        avatarUrl: avatar?.url ?? null,
      },
      abort.signal,
    );
  } catch (error) {
    // Оборванный по сроку запрос мог дойти до базы: канал тогда есть и
    // ссылается на файл. Удалять его нельзя — лишний файл дешевле битой аватарки.
    if (abort.signal.aborted) throw new DeadlineError();
    if (avatar) await removePublicMedia(avatar.path);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Текст сбоя создания для формы. */
export function describeCreateChannelError(error: unknown): string {
  if (error instanceof ChannelUsernameTakenError) return 'Имя занято';
  if (isNetworkError(error)) return 'Нет связи. Проверьте интернет и попробуйте ещё раз.';

  return 'Не удалось создать канал. Попробуйте ещё раз.';
}

export function useCreateChannel(
  userId: string | null,
  onCreated: (created: CreatedChannel) => void,
) {
  const queryClient = useQueryClient();

  return useMutation({
    // Без связи React Query ставит мутацию на паузу до её возвращения, и
    // кнопка крутилась бы молча. Создание пробуется сразу и честно падает.
    networkMode: 'always',
    mutationFn: (input: NewChannel) => {
      if (!userId) throw new Error('Нет активной сессии');

      return createWithAvatar(input, userId);
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      onCreated(created);
    },
    // Имя заняли между проверкой и отправкой: старый ответ «свободно» больше не правда.
    onError: (error, input) => {
      if (error instanceof ChannelUsernameTakenError) {
        void queryClient.invalidateQueries({
          queryKey: usernameAvailabilityKey('channel', input.username.trim()),
        });
      }
    },
  });
}
