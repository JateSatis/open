import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { Pop } from '@/api/pops';
import { useMarkChannelSectionRead } from '@/features/channels/useMarkChannelSectionRead';
import { openPopViewer } from '@/features/pops/openPopViewer';
import { PopGrid } from '@/features/pops/PopGrid';
import { useCanPublish, usePops } from '@/features/pops/queries';
import { usePopCountersSync } from '@/features/pops/usePopCountersSync';

export type PopsSectionProps = {
  channelId: string;
  /** Раздел открыт и экран наверху: подписчику его попсы прочитаны. */
  active?: boolean;
};

/**
 * Раздел «Попсы» экрана канала: сетка попсов. У того, кто может публиковать,
 * первая плитка «+» ведёт в редактор попа. Тап по попу — просмотр попсов
 * канала с него. Просмотры на плитках — живые.
 */
export function PopsSection({ channelId, active = true }: PopsSectionProps) {
  const router = useRouter();
  const canPublish = useCanPublish(channelId);
  // Тот же кеш, что у сетки: свежий поп — сигнал «пришло новое».
  const newestPopId = usePops(channelId).data?.pages[0]?.[0]?.id ?? null;

  usePopCountersSync(channelId);
  useMarkChannelSectionRead(channelId, 'pops', newestPopId, active && !canPublish);

  const openEditor = useCallback(
    () =>
      router.push({
        pathname: '/pop-editor/[channelId]',
        params: { channelId, from: 'pops' },
      }),
    [channelId, router],
  );

  const openPop = useCallback(
    (pop: Pop) => openPopViewer({ source: 'channel', channelId, startId: pop.id }),
    [channelId],
  );

  return (
    <PopGrid
      testID="pops-section"
      channelId={channelId}
      canAdd={canPublish}
      onAdd={openEditor}
      onPop={openPop}
      showViews
    />
  );
}
