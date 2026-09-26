import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { listInvites, type ChatInvite } from '@/api/invites';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { describeLoadError } from '@/lib/network';

export const invitesQueryKey = ['invites'] as const;

export type InvitesState = {
  incoming: ChatInvite[];
  declined: ChatInvite[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => void;
};

/** Мои непринятые заявки, разложенные на ждущие ответа и отклонённые. */
export function useInvites(): InvitesState {
  const connection = useConnectionStatus();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isPending, fetchStatus, error, refetch } = useQuery({
    queryKey: invitesQueryKey,
    queryFn: listInvites,
  });

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void refetch().finally(() => setIsRefreshing(false));
  }, [refetch]);

  const invites = data ?? [];

  return {
    incoming: invites.filter((invite) => invite.status === 'pending'),
    declined: invites.filter((invite) => invite.status === 'declined'),
    isLoading: isPending && fetchStatus !== 'paused',
    isRefreshing,
    error:
      data !== undefined || connection !== 'online'
        ? null
        : describeLoadError(error, 'Не удалось загрузить заявки'),
    refresh,
  };
}
