import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ChannelUsernameTakenError, createChannel, type CreatedChannel } from '@/api/channels';
import { chatsQueryKey } from '@/features/chats/useChats';
import { removeUploadedMedia, uploadChannelAvatar } from '@/features/media';
import { isNetworkError } from '@/lib/network';

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
  const avatar = input.avatarUri ? await uploadChannelAvatar(input.avatarUri, userId) : null;

  try {
    return await createChannel({
      title: input.title.trim(),
      username: input.username.trim(),
      description: input.description.trim() || null,
      avatarUrl: avatar?.url ?? null,
    });
  } catch (error) {
    if (avatar) await removeUploadedMedia(avatar.path);
    throw error;
  }
}

/** Текст сбоя создания для формы. */
export function describeCreateChannelError(error: unknown): string {
  if (error instanceof ChannelUsernameTakenError) return 'Это имя уже занято';
  if (isNetworkError(error)) return 'Нет связи. Проверьте интернет и попробуйте ещё раз.';

  return 'Не удалось создать канал. Попробуйте ещё раз.';
}

export function useCreateChannel(
  userId: string | null,
  onCreated: (created: CreatedChannel) => void,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewChannel) => {
      if (!userId) throw new Error('Нет активной сессии');

      return createWithAvatar(input, userId);
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      onCreated(created);
    },
  });
}
