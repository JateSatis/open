import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { PopGrid } from '@/features/pops/PopGrid';
import { useCanPublish } from '@/features/pops/queries';

export type PopsSectionProps = { channelId: string };

/**
 * Раздел «Попсы» экрана канала: сетка попсов. У того, кто может публиковать,
 * первая плитка «+» ведёт в редактор попа. Тап по попу пока ничего не делает:
 * просмотр — следующий этап.
 */
export function PopsSection({ channelId }: PopsSectionProps) {
  const router = useRouter();
  const canPublish = useCanPublish(channelId);

  const openEditor = useCallback(
    () =>
      router.push({
        pathname: '/pop-editor/[channelId]',
        params: { channelId, from: 'pops' },
      }),
    [channelId, router],
  );

  return (
    <PopGrid testID="pops-section" channelId={channelId} canAdd={canPublish} onAdd={openEditor} />
  );
}
