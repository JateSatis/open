import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  getMyPrivacySettings,
  regenerateIdentityAlias,
  setBirthDate,
  setPrivacySetting,
  type EditablePrivacySetting,
  type PrivacySettings,
  type Visibility,
} from '@/api/privacy';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { friendKeys } from '@/features/friends/queries';

/** Поле состояния экрана у каждой настройки, которую клиент меняет. */
const SETTING_FIELDS: Record<EditablePrivacySetting, keyof Omit<PrivacySettings, 'birthDate' | 'identityAlias'>> = {
  friends_list_visibility: 'friendsListVisibility',
  activity_status_visibility: 'activityStatusVisibility',
  message_activity_metadata_visibility: 'messageTimeVisibility',
  account_search_visibility: 'searchVisibility',
  profile_identity_masking: 'identityVisibility',
  dialogue_participant_name_masking: 'dialogueNameVisibility',
  avatar_visibility: 'avatarVisibility',
  dialogue_media_visibility: 'mediaVisibility',
};

import { isBirthDateKnown, rememberBirthDateKnown } from './birthDateKnown';

export const privacyKeys = {
  mine: (userId: string | null) => ['privacy', 'mine', userId] as const,
  birthDateKnown: (userId: string | null) => ['privacy', 'birthDateKnown', userId] as const,
};

export function useMyPrivacySettings() {
  const userId = useCurrentUserId();

  return useQuery({
    queryKey: privacyKeys.mine(userId),
    queryFn: getMyPrivacySettings,
    enabled: userId !== null,
  });
}

export function useSetBirthDate() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation<void, Error, string>({
    mutationFn: (birthDate) => setBirthDate(birthDate),
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
    { setting: EditablePrivacySetting; value: Visibility },
    { previous: PrivacySettings | null | undefined }
  >({
    mutationFn: ({ setting, value }) => setPrivacySetting(setting, value),
    networkMode: 'always',
    onMutate: async ({ setting, value }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PrivacySettings | null>(key);

      if (previous) {
        queryClient.setQueryData<PrivacySettings>(key, { ...previous, [SETTING_FIELDS[setting]]: value });
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
      if (setting === 'dialogue_participant_name_masking') {
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

      if (previous) queryClient.setQueryData<PrivacySettings>(key, { ...previous, identityAlias: alias });
    },
  });
}

export type BirthDateGate = 'loading' | 'required' | 'ok';

/**
 * Нужно ли сейчас показать экран даты. Ответ сервера главнее всего. Пока его
 * нет: аккаунт, у которого дата уже была, проходит сразу; новый — ждёт, но
 * только пока запрос реально идёт. Без сети (запрос на паузе) или при сбое
 * приложение не запирается: значения на сервере и так защитные, а ворота
 * сработают, когда запрос пройдёт.
 */
export function useBirthDateGate(): BirthDateGate {
  const userId = useCurrentUserId();
  const { data, fetchStatus } = useMyPrivacySettings();
  const known = useQuery({
    queryKey: privacyKeys.birthDateKnown(userId),
    queryFn: () => isBirthDateKnown(userId as string),
    enabled: userId !== null,
    networkMode: 'always',
    staleTime: Infinity,
  });
  const hasDate = Boolean(data?.birthDate);

  useEffect(() => {
    if (userId && hasDate) void rememberBirthDateKnown(userId);
  }, [userId, hasDate]);

  if (userId === null) return 'ok';
  if (data) return data.birthDate === null ? 'required' : 'ok';
  if (known.isPending) return 'loading';
  if (known.data) return 'ok';
  if (fetchStatus === 'fetching') return 'loading';

  return 'ok';
}
