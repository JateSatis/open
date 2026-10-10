import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { Pop } from '@/api/pops';
import { openPopViewer } from '@/features/pops/openPopViewer';
import { PopGrid } from '@/features/pops/PopGrid';
import { useCanPublish } from '@/features/pops/queries';
import { usePopCountersSync } from '@/features/pops/usePopCountersSync';

export type PopsSectionProps = { channelId: string };

/**
 * Раздел «Попсы» экрана канала: сетка попсов. У того, кто может публиковать,
 * первая плитка «+» ведёт в редактор попа. Тап по попу — просмотр попсов
 * канала с него. Просмотры на плитках — живые.
 */
export function PopsSection({ channelId }: PopsSectionProps) {
  const router = useRouter();
  const canPublish = useCanPublish(channelId);

  usePopCountersSync(channelId);

  const openEditor = useCallback(
    () =>
      router.push({
        pathname: '/pop-editor/[channelId]',
        params: { channelId, from: 'pops' },
      }),
    [channelId, router],
  );

  const openPop = useCallback((pop: Pop) => openPopViewer(channelId, pop.id), [channelId]);

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
