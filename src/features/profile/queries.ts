import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isOpaquePersonId } from '@/api/opaquePeople';
import {
  getMyProfile,
  getProfile,
  ProfileUnavailableError,
  updateMyProfile,
  type Profile,
  type ProfileUpdateInput,
} from '@/api/profile';
import { profileKeys } from '@/features/profile/keys';

export { profileKeys };

export function useMyProfile() {
  const api = useRequestClient();
  return useQuery({ queryKey: profileKeys.me(), queryFn: () => getMyProfile(api) });
}

export function useProfile(userId: string | undefined) {
  const api = useRequestClient();
  return useQuery({
    queryKey: profileKeys.byId(userId ?? ''),
    // Непрозрачный id подменённого в диалоге: профиля за ним нет — сразу
    // «недоступен», без запроса (и без вечной загрузки).
    queryFn: () =>
      isOpaquePersonId(userId)
        ? Promise.reject(new ProfileUnavailableError())
        : getProfile(userId as string, api),
    enabled: Boolean(userId),
  });
}

export function useUpdateMyProfile() {
  const api = useRequestClient();
  const queryClient = useQueryClient();

  return useMutation<Profile, Error, ProfileUpdateInput>({
    mutationFn: (input: ProfileUpdateInput) => updateMyProfile(input, api),
    onSuccess: (profile) => {
      // The same row backs both cache entries — seed them rather than
      // invalidating, so returning to the profile screen shows no spinner.
      queryClient.setQueryData(profileKeys.me(), profile);
      queryClient.setQueryData(profileKeys.byId(profile.id), profile);
    },
  });
}
