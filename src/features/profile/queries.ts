import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getMyProfile,
  getProfile,
  updateMyProfile,
  type Profile,
  type ProfileUpdateInput,
} from '@/api/profile';

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
  byId: (userId: string) => [...profileKeys.all, 'byId', userId] as const,
};

export function useMyProfile() {
  return useQuery({ queryKey: profileKeys.me(), queryFn: getMyProfile });
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.byId(userId ?? ''),
    queryFn: () => getProfile(userId as string),
    enabled: Boolean(userId),
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
