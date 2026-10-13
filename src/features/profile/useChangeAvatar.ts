import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { updateMyProfile, type Profile } from '@/api/profile';
import { removeOwnAvatar, uploadAvatar } from '@/features/media';
import { profileKeys } from '@/features/profile/queries';
import { DeadlineError, withDeadline } from '@/lib/deadline';

/** Дольше этого смену фото не ждём — дальше это потеря связи. */
const SAVE_DEADLINE_MS = 30_000;

function seedProfile(queryClient: QueryClient, profile: Profile) {
  queryClient.setQueryData(profileKeys.me(), profile);
  queryClient.setQueryData(profileKeys.byId(profile.id), profile);
}

export type AvatarChange =
  /** Новый аватар — файл уже квадратный и сжатый (`prepareAvatar`). */
  { kind: 'set'; uri: string; profile: Profile } | { kind: 'remove'; profile: Profile };

export function useChangeAvatar() {
  const queryClient = useQueryClient();

  return useMutation<Profile, Error, AvatarChange>({
    // Без связи React Query ставит мутацию на паузу до её возвращения, и
    // крутилка на аватаре висела бы молча. Смена пробуется сразу и честно падает.
    networkMode: 'always',
    mutationFn: async (change) => {
      const { profile } = change;

      if (change.kind === 'remove') {
        const updated = await withDeadline(updateMyProfile({ avatarUrl: null }), SAVE_DEADLINE_MS);
        // Профиль уже без фото; файл убирается без ожидания — без связи
        // удаление в Storage висело бы вместе с крутилкой.
        void removeOwnAvatar(profile.avatarUrl, profile.id);
        return updated;
      }

      // Загрузка в Storage без связи не падает, а висит: срок превращает её в
      // ошибку. Файл, доехавший после срока, никому не нужен.
      const url = await withDeadline(
        uploadAvatar(change.uri, profile.id),
        SAVE_DEADLINE_MS,
        (late) => {
          void removeOwnAvatar(late, profile.id);
        },
      );
      let updated: Profile;

      try {
        updated = await withDeadline(updateMyProfile({ avatarUrl: url }), SAVE_DEADLINE_MS);
      } catch (error) {
        // Профиль на новый файл так и не сослался — файл никому не нужен. Кроме
        // запроса, оборванного по сроку: он мог дойти, и файл тогда — аватар.
        // Без ожидания: без связи удаление висело бы так же, как загрузка.
        if (!(error instanceof DeadlineError)) void removeOwnAvatar(url, profile.id);
        throw error;
      }

      // Профиль уже на новом файле — прежний убирается без ожидания.
      void removeOwnAvatar(profile.avatarUrl, profile.id);
      return updated;
    },
    onSuccess: (profile) => {
      seedProfile(queryClient, profile);
      // Аватар показан в списке чатов, шапках, облачках и списке людей —
      // перечитываем всё, чтобы он сменился везде без перезапуска.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== profileKeys.all[0],
      });
    },
  });
}
