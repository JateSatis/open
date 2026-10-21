import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getMyProfile,
  getProfile,
  updateMyProfile,
  type Profile,
  type ProfileUpdateInput,
} from '@/api/profile';
import { ProfileUnavailableError } from '@/api/profileErrors';

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
  byId: (userId: string) => [...profileKeys.all, 'byId', userId] as const,
};

export function useMyProfile() {
  return useQuery({ queryKey: profileKeys.me(), queryFn: getMyProfile });
}

/** Сколько повторов разрешают общие настройки клиента запросов. */
function allowsRetry(retry: unknown, failures: number, error: Error): boolean {
  if (typeof retry === 'function') return Boolean(retry(failures, error));
  if (typeof retry === 'number') return failures < retry;
  if (typeof retry === 'boolean') return retry;

  // Без настройки React Query повторяет трижды.
  return failures < 3;
}

export function useProfile(userId: string | undefined) {
  const queryClient = useQueryClient();
  const defaultRetry = queryClient.getDefaultOptions().queries?.retry;

  return useQuery({
    queryKey: profileKeys.byId(userId ?? ''),
    queryFn: () => getProfile(userId as string),
    enabled: Boolean(userId),
    // Недоступный профиль повтором не появится; остальное — как везде.
    retry: (failures, error) =>
      !(error instanceof ProfileUnavailableError) && allowsRetry(defaultRetry, failures, error),
  });
}

export function useUpdateMyProfile() {
  const queryClient = useQueryClient();

  return useMutation<Profile, Error, ProfileUpdateInput>({
    mutationFn: updateMyProfile,
    onSuccess: (profile) => {
      // The same row backs both cache entries — seed them rather than
      // invalidating, so returning to the profile screen shows no spinner.
      queryClient.setQueryData(profileKeys.me(), profile);
      queryClient.setQueryData(profileKeys.byId(profile.id), profile);
    },
  });
}
