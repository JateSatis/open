import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  BirthDateTooYoungError,
  getMyPrivacySettings,
  regenerateIdentityAlias,
  setBirthDate,
  setPrivacySetting,
  type EditablePrivacySetting,
  type PrivacySettingValues,
  type PrivacySettings,
} from '@/api/privacy';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { friendKeys } from '@/features/friends/queries';
import { rememberBirthDate, useLocalBirthDateDecision } from './useLocalBirthDateDecision';

/** Поле состояния экрана у каждой настройки, которую клиент меняет. */
const SETTING_FIELDS: Record<
  EditablePrivacySetting,
  keyof Omit<PrivacySettings, 'birthDate' | 'identityAlias'>
> = {
  friends_list_visibility: 'friendsListVisibility',
  activity_status_visibility: 'activityStatusVisibility',
  message_activity_metadata_visibility: 'messageTimeVisibility',
  account_search_visibility: 'searchVisibility',
  profile_identity_masking: 'identityVisibility',
  dialogue_participant_name_masking: 'dialogueNameVisibility',
  avatar_visibility: 'avatarVisibility',
  dialogue_media_visibility: 'mediaVisibility',
  public_message_visibility_delay: 'publicDelay',
};

export const privacyKeys = {
  mine: (userId: string | null) => ['privacy', 'mine', userId] as const,
};

// Сохранение или более свежее чтение отменяет запись запоздавшего ответа для того же ID.
const settingsReads = new Map<string, Promise<PrivacySettings | null>>();

export function useMyPrivacySettings() {
  const userId = useCurrentUserId();
  const client = useQueryClient();

  return useQuery({
    queryKey: privacyKeys.mine(userId),
    queryFn: async () => {
      if (!userId) return null;
      const read = getMyPrivacySettings();
      settingsReads.set(userId, read);
      try {
        const settings = await read;
        if (settings?.birthDate != null && settingsReads.get(userId) === read) {
          await rememberBirthDate(client, userId, settings.birthDate);
        }
        return settings;
      } finally {
        if (settingsReads.get(userId) === read) settingsReads.delete(userId);
      }
    },
    enabled: userId !== null,
  });
}

export function useSetBirthDate(mode: 'initial' | 'edit') {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation<void, Error, string>({
    mutationKey: ['privacy', 'setBirthDate', userId, mode],
    mutationFn: async (birthDate) => {
      if (!userId) throw new Error('Требуется вход в аккаунт');
      try {
        await setBirthDate(birthDate);
      } catch (error) {
        if (mode === 'initial' && error instanceof BirthDateTooYoungError) {
          settingsReads.delete(userId);
          await rememberBirthDate(queryClient, userId, birthDate, 'tooYoung');
        }
        throw error;
      }
      settingsReads.delete(userId);
      await rememberBirthDate(queryClient, userId, birthDate, 'ok');
    },
    // Без сети мутация не встаёт на паузу, а честно падает — человек видит ошибку.
    networkMode: 'always',
    onSuccess: () => queryClient.invalidateQueries({ queryKey: privacyKeys.mine(userId) }),
  });
}

/** Смена настройки — сразу на экране, откат, если сервер не принял. */
export function useSetPrivacySetting() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const key = privacyKeys.mine(userId);

  return useMutation<
    void,
    Error,
    { setting: EditablePrivacySetting; value: PrivacySettingValues[EditablePrivacySetting] },
    { previous: PrivacySettings | null | undefined }
  >({
    mutationFn: ({ setting, value }) =>
      setPrivacySetting(setting, value as PrivacySettingValues[typeof setting]),
    networkMode: 'always',
    onMutate: async ({ setting, value }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PrivacySettings | null>(key);

      if (previous) {
        queryClient.setQueryData<PrivacySettings>(key, {
          ...previous,
          [SETTING_FIELDS[setting]]: value,
        });
      }

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: (_data, _error, { setting }) => {
      void queryClient.invalidateQueries({ queryKey: key });
      // Строка «Друзья» в своём профиле зависит от настройки.
      if (userId) void queryClient.invalidateQueries({ queryKey: friendKeys.summary(userId) });
      // Куда слать мои «печатает» — по настройке активности: старый ответ
      // слал бы туда, куда я уже не хочу. Время у других перечитывается по
      // сигналу базы в топики моих чатов.
      if (setting === 'activity_status_visibility') {
        void queryClient.invalidateQueries({ queryKey: ['typingAudience'] });
      }
      // Прочтение взаимно: скрыв время, я сам не вижу чужих отметок. Сообщения
      // открытых чатов перечитает сигнал базы в их топики, здесь — участники.
      if (setting === 'message_activity_metadata_visibility') {
        void queryClient.invalidateQueries({ queryKey: ['chat'] });
      }
      // Имя в диалогах решает, куда слать «печатает»: всем или только участникам.
      if (
        setting === 'dialogue_participant_name_masking' ||
        // Задержка решает и «печатает»: в чате с ней — только участникам.
        setting === 'public_message_visibility_delay'
      ) {
        void queryClient.invalidateQueries({ queryKey: ['typingAudience'] });
      }
    },
  });
}

/** «Другой псевдоним»: новый сразу в строке настроек. */
export function useRegenerateIdentityAlias() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const key = privacyKeys.mine(userId);

  return useMutation<string, Error, void>({
    mutationFn: regenerateIdentityAlias,
    networkMode: 'always',
    onSuccess: (alias) => {
      const previous = queryClient.getQueryData<PrivacySettings | null>(key);

      if (previous)
        queryClient.setQueryData<PrivacySettings>(key, { ...previous, identityAlias: alias });
    },
  });
}

export type BirthDateGate = 'loading' | 'required' | 'ok';

/** Оба состояния формы используют существующий маршрут BirthDate. */
export function useBirthDateGate(): BirthDateGate {
  const userId = useCurrentUserId();
  const { data, fetchStatus } = useMyPrivacySettings();
  const decision = useLocalBirthDateDecision(userId);
  if (userId === null) return 'ok';
  if (decision === 'tooYoung') return 'required';
  if (decision === 'required' && !data && fetchStatus === 'fetching') return 'loading';
  return decision;
}
