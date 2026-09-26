import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { updateMyProfile, type Profile } from '@/api/profile';
import { removeOwnAvatar, uploadAvatar } from '@/features/media';
import { profileKeys } from '@/features/profile/queries';

function seedProfile(queryClient: QueryClient, profile: Profile) {
  queryClient.setQueryData(profileKeys.me(), profile);
  queryClient.setQueryData(profileKeys.byId(profile.id), profile);
}

export type AvatarChange =
  /** Новый аватар — файл уже квадратный и сжатый (`pickAvatar`). */
  | { kind: 'set'; uri: string; profile: Profile }
  | { kind: 'remove'; profile: Profile };

export function useChangeAvatar() {
  const queryClient = useQueryClient();

  return useMutation<Profile, Error, AvatarChange>({
    mutationFn: async (change) => {
      const { profile } = change;

      if (change.kind === 'remove') {
        const updated = await updateMyProfile({ avatarUrl: null });
        await removeOwnAvatar(profile.avatarUrl, profile.id);
        return updated;
      }

      const url = await uploadAvatar(change.uri, profile.id);
      let updated: Profile;

      try {
        updated = await updateMyProfile({ avatarUrl: url });
      } catch (error) {
        // Профиль на новый файл так и не сослался — файл никому не нужен.
        await removeOwnAvatar(url, profile.id);
        throw error;
      }

      await removeOwnAvatar(profile.avatarUrl, profile.id);
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
